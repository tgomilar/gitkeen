/**
 * Suggesting a commit subject from the change about to be committed.
 *
 * A hosted model means the contents of the open repository go on the network,
 * so this is off unless a key is configured, it is never reached by opening a
 * repository, and it runs only when the user asks for a suggestion. No key
 * ever reaches the browser: the request is made here and only the resulting
 * line is returned.
 *
 * Four providers are supported: two hosted, because people already have one
 * key or the other, and two that run on the machine and so send nothing
 * anywhere. They differ only in URL, headers and response shape, so each is a
 * small record and the rest of the file is shared.
 */
import { readKey, readProvider, readModel, KEY_ENV } from './settings.mjs';
import { ollamaModels, lmstudioModels } from './local-ai.mjs';

/**
 * How much of a diff is worth sending.
 *
 * A subject line describes the shape of a change, which is legible from the
 * first few hunks; a lockfile refresh would otherwise spend a fortune saying
 * "update dependencies". What is dropped is replaced by a note, so the model
 * is told the diff was clipped rather than being left to infer a small change.
 *
 * A locally served model is usually loaded with a far smaller context than a
 * hosted one: 4096 tokens is a common default, which a two-file diff passes
 * easily. Sending the hosted budget to one of those fails the whole request,
 * so local providers get a budget that fits the common case instead.
 */
const MAX_DIFF = 40_000;
// Measured against a model loaded at 4096 tokens, the common default: about
// 5000 characters of real diff fits alongside the prompt, where dense code
// tokenises far less efficiently than prose.
const MAX_DIFF_LOCAL = 4_500;

/**
 * How many tokens the answer may take.
 *
 * A subject line is a few dozen tokens, but a reasoning model spends its
 * budget thinking first and only then writes. Capping a local model at the
 * hosted figure leaves nothing for the answer: the reply stops mid-thought
 * and arrives empty. Local providers therefore get room to think.
 */
const MAX_TOKENS = 200;
const MAX_TOKENS_LOCAL = 1_500;
// A split names every file and writes a subject per commit, which a one-line
// budget cuts off half way: the reply then cannot be read and the split is
// lost without a word. Twenty paths and their subjects fit in this.
const MAX_TOKENS_SPLIT = 1_500;
const MAX_TOKENS_SPLIT_LOCAL = 3_000;

/**
 * How long to wait for an answer.
 *
 * A hosted API answers in seconds. A local server loads the model into memory
 * on the first request after a while idle, and a large model on a laptop then
 * writes slowly, so 30 seconds cut off answers that were on their way.
 */
const TIMEOUT = 30_000;
const TIMEOUT_LOCAL = 120_000;

const PROVIDERS = {
  anthropic: {
    label: 'Anthropic',
    env: 'ANTHROPIC_API_KEY',
    modelEnv: 'GITKEEN_ANTHROPIC_MODEL',
    // Haiku is fast and cheap, and one line about a diff does not need more.
    model: 'claude-haiku-4-5-20251001',
    url: 'https://api.anthropic.com/v1/messages',
    headers: (key) => ({
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01'
    }),
    body: (model, system, user, maxTokens) => ({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }]
    }),
    // { content: [{ type: 'text', text: '...' }] }
    read: (json) => json?.content?.find((b) => b?.type === 'text')?.text ?? '',
    error: (json) => json?.error?.message ?? null
  },

  openai: {
    label: 'OpenAI',
    env: 'OPENAI_API_KEY',
    modelEnv: 'GITKEEN_OPENAI_MODEL',
    model: 'gpt-4o-mini',
    url: 'https://api.openai.com/v1/chat/completions',
    headers: (key) => ({
      'content-type': 'application/json',
      authorization: `Bearer ${key}`
    }),
    // The system prompt is a message here rather than a field of its own.
    body: (model, system, user, maxTokens) => ({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    }),
    // { choices: [{ message: { content: '...' } }] }
    read: (json) => json?.choices?.[0]?.message?.content ?? '',
    error: (json) => json?.error?.message ?? null
  },

  /**
   * LM Studio, which serves an OpenAI-compatible API on the machine.
   *
   * Because the shape is OpenAI's, only the address and the missing key differ.
   * The model is whichever one the user has loaded, so it is asked for rather
   * than assumed: a name hardcoded here would be wrong for everyone who loaded
   * something else.
   */
  lmstudio: {
    label: 'LM Studio',
    env: null,
    modelEnv: 'GITKEEN_LMSTUDIO_MODEL',
    model: null,
    url: (process.env.LMSTUDIO_HOST || 'http://127.0.0.1:1234').replace(/\/$/, '') + '/v1/chat/completions',
    // It ignores the key, but sending one keeps the header shape identical.
    headers: () => ({ 'content-type': 'application/json', authorization: 'Bearer lm-studio' }),
    body: (model, system, user, maxTokens) => ({
      model,
      max_tokens: maxTokens,
      // Summarising a diff is not a reasoning task, and a model that thinks
      // about it at length tends to talk itself out of an answer. Servers that
      // do not understand these simply ignore them.
      reasoning: { effort: 'none' },
      chat_template_kwargs: { enable_thinking: false },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    }),
    // Only `content` is the answer. A reasoning model also returns its working
    // in `reasoning_content`, which is deliberately ignored: it is deliberation,
    // not a subject, and a model that talked itself out of answering has not
    // produced one however much of it there is.
    read: (json) => json?.choices?.[0]?.message?.content ?? '',
    error: (json) => json?.error?.message ?? json?.error ?? null
  },

  /**
   * A model running on this machine. Nothing is sent anywhere, which is the
   * whole point of offering it: a repository whose contents cannot go to a
   * hosted API can still have suggestions.
   *
   * It needs no key, so it counts as configured whenever the server answers.
   */
  ollama: {
    label: 'Ollama',
    env: null,
    modelEnv: 'GITKEEN_OLLAMA_MODEL',
    model: 'llama3.2',
    url: (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, '') + '/api/chat',
    headers: () => ({ 'content-type': 'application/json' }),
    body: (model, system, user, maxTokens) => ({
      model,
      stream: false,
      options: { num_predict: maxTokens },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    }),
    // { message: { content: '...' } }
    read: (json) => json?.message?.content ?? '',
    error: (json) => json?.error ?? null
  }
};

/** Ollama needs no key; the hosted providers read theirs from settings. */
async function key(name) {
  if (!PROVIDERS[name].env) return 'local';
  return readKey(name);
}

/**
 * The two local providers are offered only when they are actually running.
 * Each answers with the names of the models it can use, or null when nothing
 * is listening; the names matter because a local server runs whichever model
 * the user chose, so the one to ask for cannot be known in advance.
 */
const LOCAL_PROBE = { ollama: ollamaModels, lmstudio: lmstudioModels };

const localModels = (name) => LOCAL_PROBE[name]?.() ?? null;

/**
 * The model a local server should be asked for.
 *
 * A variable wins, as it does for keys. Then the model chosen in Settings,
 * while the server still has it, and otherwise the first one it lists. With
 * nothing listed there is no model to ask for, so the answer is null rather
 * than a default name the server would reject.
 */
async function localModel(name, loaded) {
  const env = process.env[PROVIDERS[name].modelEnv];
  if (env) return env;
  const saved = await readModel(name);
  if (saved && loaded.includes(saved)) return saved;
  return loaded[0] ?? null;
}

/** True for a provider Gitkeen knows, so a choice can be checked before it is saved. */
export const isProvider = (name) => Object.hasOwn(PROVIDERS, name);

/**
 * Which providers have a key, and which is used when none is named.
 *
 * The UI asks this to decide whether to offer the button at all, so that a
 * user without a key is never shown an action that can only fail.
 */
export async function suggestionProviders() {
  const available = [];
  const models = {};

  for (const name of Object.keys(PROVIDERS)) {
    if (LOCAL_PROBE[name]) {
      const loaded = await localModels(name);
      if (loaded === null) continue;
      const chosen = await localModel(name, loaded);
      // A server that is running with nothing loaded cannot answer, so it is
      // not offered: the button would be there only to fail.
      if (!chosen) continue;
      available.push(name);
      models[name] = chosen;
    } else if (await key(name)) {
      available.push(name);
      models[name] = process.env[PROVIDERS[name].modelEnv] || PROVIDERS[name].model;
    }
  }

  // The provider chosen in Settings wins while it is available. Without a
  // choice, or when the chosen one is not running or has lost its key, the
  // order of PROVIDERS decides, so a suggestion still works.
  const saved = await readProvider();
  return {
    available,
    preferred: available.includes(saved) ? saved : available[0] ?? null,
    models
  };
}

/**
 * The rules of the open repository, written out as instructions.
 *
 * The same config that blocks the Commit button is what the model is told to
 * satisfy, so a suggestion is not held to a standard the repository does not
 * actually have, nor excused from one it does.
 */
function systemPrompt(rules, { split = false } = {}) {
  const lines = split
    ? [
        'You describe a Git change that is about to be committed.',
        'Reply with JSON and nothing else, in this exact shape:',
        '{"subject": "...", "groups": [{"reason": "...", "subject": "...", "files": ["path", ...]}]}',
        '"subject" is the commit subject line for the whole change.',
        'Describe what the change does and why, not which files moved.',
        'Use the imperative mood, as in "add", "fix", "remove".',
        '',
        '"groups" is for when the change holds work that serves different',
        'purposes and would read better as separate commits. Examples: a',
        'feature alongside an unrelated config or tooling change; a bug fix',
        'alongside unrelated documentation; two features touching different',
        'parts of the app.',
        'Give a group per commit, each with a short "reason" naming the work,',
        'a "subject" that is the commit subject line for that group alone and',
        'follows the same rules as the main one, and the exact file paths from',
        'the diff that belong to it.',
        'Every file listed under <files> must appear in exactly one group.',
        'Build each group around one task a reviewer would name, so it could',
        'be read or reverted on its own. A large change usually holds several',
        'tasks: do not merge unrelated ones to keep the list short, and do not',
        'make a group of files that only share a folder or a file type.',
        'A change and its tests, or a change and the files it forced, serve',
        'one purpose and belong in a single commit.',
        'When the whole change serves one purpose, return an empty groups array.'
      ]
    : [
        'You write the subject line of a Git commit message.',
        'You are given a diff. Reply with the subject line and nothing else:',
        'no body, no explanation, no quotation marks, no trailing full stop.',
        'Describe what the change does and why, not which files moved.',
        'Use the imperative mood, as in "add", "fix", "remove".'
      ];

  const enforced = rules?.enforced ? rules.rules ?? {} : {};

  const noScope = enforced['scope-empty']?.applicable === 'always';

  // Gitkeen's own rules are commitlint's rules by another source, unless
  // they ask for free text, which has no type to name.
  const conventional = (rules?.source === 'commitlint' || rules?.source === 'gitkeen') && rules?.format !== 'free';
  if (conventional) {
    lines.push(
      noScope
        ? 'Follow Conventional Commits, without a scope: type: subject.'
        : 'Follow Conventional Commits: type(scope): subject, where the scope is optional.'
    );
  }

  const types = rules?.types;
  if (Array.isArray(types) && types.length > 0) {
    lines.push(`The type must be one of: ${types.join(', ')}.`);
  }

  const max = enforced['header-max-length']?.value ?? rules?.maxHeader;
  if (typeof max === 'number') {
    lines.push(
      noScope
        ? `The whole line, the type included, must be at most ${max} characters.`
        : `The whole line, type and scope included, must be at most ${max} characters.`
    );
  }

  if (enforced['subject-full-stop']?.applicable === 'never') {
    lines.push('Do not end the line with a full stop.');
  }
  if (enforced['subject-case']?.value === 'lower-case') {
    lines.push('The subject, after the colon, must begin with a lower-case letter.');
  }
  if (enforced['type-case']?.value === 'lower-case') {
    lines.push('The type must be lower case.');
  }
  if (enforced['scope-empty']?.applicable === 'never') {
    lines.push('A scope is required, as in type(scope): subject.');
  }
  if (noScope) {
    lines.push('Never write a scope: "feat: add the thing", not "feat(api): add the thing".');
  }

  return lines.join('\n');
}

/**
 * Trim a diff to something worth paying for.
 *
 * Whole files are dropped rather than cut mid-hunk where possible, so what
 * survives still parses as a diff.
 */
function clipDiff(diff, stat, budget = MAX_DIFF) {
  if (diff.length <= budget) return { text: diff, clipped: false };

  const files = diff.split(/\n(?=diff --git )/);
  const kept = [];
  let size = 0;
  for (const file of files) {
    if (size + file.length > budget) break;
    kept.push(file);
    size += file.length + 1;
  }

  // A single file larger than the budget leaves nothing, so fall back to a
  // hard cut: a truncated hunk still says more than no diff at all.
  const text = kept.length > 0 ? kept.join('\n') : diff.slice(0, budget);
  // The summary is bounded too: it is an aid to the clipped diff, and a note
  // longer than the diff would undo the clipping it is explaining.
  const summary = stat.trim().slice(0, 600);
  const note = [
    '',
    '--- the diff was too large to send in full ---',
    'Only part of it is above. The full set of files changed:',
    summary
  ].join('\n');

  return { text: text + note, clipped: true };
}

/** Files whose diff is machine-written, so their lines say nothing about the work. */
const GENERATED = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|composer\.lock|Gemfile\.lock|poetry\.lock|go\.sum)$|\.min\.(js|css)$/;

/**
 * A diff too large to send, shortened so that every file still appears.
 *
 * Clipping keeps the first files whole and drops the rest, which is fine for
 * a subject but useless for a split: a file the model never saw cannot be put
 * in a group, so any grouping would leave it out and be thrown away. Here each
 * file keeps its name and its first changed lines, without context, within an
 * equal share of the budget; a file that needs less gives the rest to the
 * others. A lockfile is only counted, since its lines describe nothing.
 */
function digestDiff(diff, budget) {
  const files = diff.split(/\n(?=diff --git )/).filter((f) => f.startsWith('diff --git '));
  if (files.length === 0) return diff.slice(0, budget);

  const entries = files.map((file) => {
    const lines = file.split('\n');
    const header = lines[0].match(/^diff --git a\/(.+?) b\/(.+)$/);
    const path = header ? header[2] : lines[0].slice('diff --git '.length);
    const changed = lines.filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l));
    const added = changed.filter((l) => l[0] === '+').length;
    const removed = changed.length - added;
    const head = `${path} (+${added} -${removed})`;
    const body = GENERATED.test(path) ? '' : changed.join('\n');
    return { head, body };
  });

  // Names and counts always go in; what is left is shared out for the lines.
  let left = budget - entries.reduce((n, e) => n + e.head.length + 1, 0);
  const share = new Map();
  let open = entries.filter((e) => e.body);
  while (open.length && left > 0) {
    const each = Math.floor(left / open.length);
    if (each <= 0) break;
    const next = [];
    for (const e of open) {
      const need = e.body.length + 1 - (share.get(e) ?? 0);
      const give = Math.min(need, each);
      share.set(e, (share.get(e) ?? 0) + give);
      left -= give;
      if (give < need) next.push(e);
    }
    if (next.length === open.length) break;
    open = next;
  }

  const parts = entries.map((e) => {
    const room = share.get(e) ?? 0;
    // A share too small for a useful line is left out, unless it is the whole change.
    if (!e.body || room < Math.min(40, e.body.length + 1)) return e.head;
    const cut = e.body.length + 1 > room;
    return `${e.head}\n${cut ? e.body.slice(0, room).replace(/\n[^\n]*$/, '') + '\n…' : e.body}`;
  });
  return [
    'The diff was too large to send in full. Every file changed is below, each',
    'with its name, the lines added and removed, and its first changed lines.',
    '',
    parts.join('\n\n')
  ].join('\n');
}

/**
 * Pull just the "subject" out of a reply whose JSON could not be parsed.
 *
 * The subject is written before the groups, so a truncated or malformed reply
 * usually still holds a complete one. Returning it keeps a usable suggestion
 * out of a reply that would otherwise be discarded or, worse, passed on raw.
 */
function subjectField(text) {
  const field = text.match(/"subject"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!field) return null;
  try {
    return { subject: JSON.parse(`"${field[1]}"`), groups: [] };
  } catch {
    return null;
  }
}

/**
 * Read a JSON reply, when one was asked for.
 *
 * Returns null if it cannot be read, so the caller can fall back to treating
 * the answer as a plain subject line. A model that ignores the shape must not
 * cost the user the suggestion.
 */
function parseJsonReply(raw) {
  const text = (raw ?? '').trim();
  if (!text) return null;

  // Models often wrap JSON in a code fence, and sometimes add a line either
  // side of it. The first balanced object is the one that was asked for.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');

  // A reply that never closed its object cannot be parsed, but the subject is
  // written first and is usually complete. Reading it out beats returning the
  // raw fragment, which would otherwise be offered as the commit message.
  if (start < 0 || end <= start) return subjectField(text);

  let parsed = null;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    // Truncated or malformed JSON still usually holds a complete subject, and
    // that is the part worth keeping: without this the raw fragment would be
    // offered as the commit message.
    return subjectField(text);
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const subject = typeof parsed.subject === 'string' ? parsed.subject : '';
  if (!subject.trim()) return null;

  const groups = Array.isArray(parsed.groups)
    ? parsed.groups
        .map((g) => ({
          reason: typeof g?.reason === 'string' ? g.reason.trim() : '',
          subject: typeof g?.subject === 'string' ? g.subject : '',
          files: Array.isArray(g?.files) ? g.files.filter((f) => typeof f === 'string') : []
        }))
        .filter((g) => g.reason && g.files.length > 0)
    : [];

  return { subject, groups };
}

/**
 * Reduce whatever came back to one line.
 *
 * Models are asked for a bare subject and usually give one, but a stray code
 * fence or a "Subject:" label is common enough to be worth removing here
 * rather than letting it reach the message box.
 */
function cleanSubject(raw) {
  let text = (raw ?? '').trim();
  if (!text) return '';

  // ```\nfeat: thing\n```
  const fenced = text.match(/^```[a-z]*\n([\s\S]*?)\n?```$/i);
  if (fenced) text = fenced[1].trim();

  text = text.split('\n').map((l) => l.trim()).filter(Boolean)[0] ?? '';
  text = text.replace(/^(?:subject|commit message|message)\s*:\s*/i, '');
  // A line the model wrapped in quotes, but not a quote inside the subject.
  const quoted = text.match(/^"([^"]*)"$/) || text.match(/^'([^']*)'$/);
  if (quoted) text = quoted[1];

  return text.trim();
}

/**
 * One request to a provider, and the text it answered.
 *
 * Shared by the commit subject and the explanations: the key, the model, the
 * time limit and the errors a person can act on are the same for both. What
 * the answer should look like is the caller's business.
 */
async function requestProvider(name, system, user, maxTokens) {
  const provider = PROVIDERS[name];
  const apiKey = await key(name);
  if (!apiKey) {
    throw new Error(`No ${provider.label} key. Add one in Settings, or set ${provider.env}.`);
  }
  let model = process.env[provider.modelEnv] || provider.model;
  if (LOCAL_PROBE[name]) {
    model = await localModel(name, (await localModels(name)) ?? []);
    if (!model) throw new Error(`${provider.label} has no model loaded.`);
  }

  // A hung request should not leave the button spinning forever.
  const timeout = LOCAL_PROBE[name] ? TIMEOUT_LOCAL : TIMEOUT;
  const abort = AbortSignal.timeout(timeout);

  let res;
  try {
    res = await fetch(provider.url, {
      method: 'POST',
      headers: provider.headers(apiKey),
      body: JSON.stringify(
        provider.body(model, system, user, maxTokens)
      ),
      signal: abort
    });
  } catch (err) {
    if (err?.name === 'TimeoutError') {
      throw new Error(
        `${provider.label} did not answer within ${timeout / 1000} seconds.` +
          (LOCAL_PROBE[name] ? ' Load a smaller model, or choose another provider in Settings.' : '')
      );
    }
    throw new Error(`Could not reach ${provider.label}: ${err?.message ?? err}`);
  }

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Fall through: a non-JSON body is reported as the HTTP error below.
  }

  if (!res.ok) {
    const detail = provider.error(json) ?? text.slice(0, 200);
    if (res.status === 401 || res.status === 403) {
      throw new Error(`${provider.label} rejected the key: ${detail}`);
    }
    if (res.status === 429) {
      // OpenAI answers 429 both for throttling and for an account with no
      // credits left. Calling the second "rate limiting" would tell the user
      // to wait for something that will never clear on its own.
      const quota = json?.error?.code === 'insufficient_quota' || /quota|credit|billing/i.test(detail);
      throw new Error(
        quota
          ? `${provider.label} has no credits left on this account: ${detail}`
          : `${provider.label} is rate limiting, so try again shortly: ${detail}`
      );
    }
    // A local model loaded with a small context says so here. The fix is in
    // the user's hands, not ours, so name it rather than only relaying it.
    if (res.status === 400 && /context length|n_ctx|too long|exceeds/i.test(detail)) {
      throw new Error(
        `The change is too large for ${provider.label}'s loaded context. ` +
          'Load the model with a larger context length, or tick fewer files.'
      );
    }
    throw new Error(`${provider.label} returned ${res.status}: ${detail}`);
  }

  return { raw: provider.read(json) ?? '', model, json };
}

async function askProvider(name, system, user, { split = false } = {}) {
  const provider = PROVIDERS[name];
  const local = Boolean(LOCAL_PROBE[name]);
  const maxTokens = split
    ? (local ? MAX_TOKENS_SPLIT_LOCAL : MAX_TOKENS_SPLIT)
    : (local ? MAX_TOKENS_LOCAL : MAX_TOKENS);
  const { raw, model, json } = await requestProvider(name, system, user, maxTokens);
  const subject = cleanSubject(raw);

  // A model cut off mid-sentence has not written a subject, whatever text came
  // back: what it returns is the middle of its own thinking. Passing that on
  // would put a fragment in the message box as though it were a suggestion, so
  // it is refused whether or not it is empty.
  if (json?.choices?.[0]?.finish_reason === 'length') {
    throw new Error(
      `${provider.label} ran out of answer budget before writing a subject. ` +
        "Turn off the model's reasoning mode in the server settings, or load a smaller model."
    );
  }
  if (json?.choices?.[0]?.finish_reason === 'content_filter') {
    throw new Error(`${provider.label} refused to answer for this diff.`);
  }

  // A reasoning model can deliberate at length and stop without ever writing
  // the line. It reports success, so only the empty answer gives it away.
  if (!subject && json?.choices?.[0]?.message?.reasoning_content) {
    throw new Error(
      `${provider.label} thought about the change but never wrote a subject. ` +
        "Turn off the model's reasoning mode in the server settings, or tick fewer files."
    );
  }

  // `raw` is kept because a JSON reply must be read before it is reduced to
  // one line: cleaning it first would throw away everything after the brace.
  return { subject, raw, model };
}

/**
 * Keep only a grouping that is worth showing.
 *
 * A model can name files that are not in the commit, drop files that are, or
 * put everything in one group and call it a split. Advice like that is worse
 * than none, because acting on it would commit the wrong set. Anything that
 * does not describe a real division of exactly these files is discarded.
 */
function usableGroups(groups, paths) {
  if (!Array.isArray(groups) || groups.length < 2) return [];

  const wanted = new Set(paths);
  const seen = new Set();
  const cleaned = [];

  for (const group of groups) {
    // Only files in the commit, and only once each: a file in two groups is
    // not a division, and the first claim on it is as good as any.
    const files = group.files.filter((f) => wanted.has(f) && !seen.has(f));
    for (const f of files) seen.add(f);
    // A group without a subject is still a good division: the panel asks
    // for one rather than discarding the advice.
    if (files.length > 0) cleaned.push({ reason: group.reason, subject: cleanSubject(group.subject ?? ''), files });
  }

  // Fewer than two groups is not a split.
  if (cleaned.length < 2) return [];

  return cleaned;
}

/** The files of `paths` that no group holds. */
const unplaced = (groups, paths) => {
  const seen = new Set(groups.flatMap((g) => g.files));
  return paths.filter((p) => !seen.has(p));
};

/**
 * Ask once more where the files the split left out belong.
 *
 * A model given many files nearly always forgets some, and the more files the
 * more it forgets. Asked again about only those, next to the commits it
 * already proposed, it places most of them: a short question is far easier
 * than the long one. It may also start a new commit for files that fit none.
 */
async function placeMissed(chosen, groups, missed, { diff, budget, rules }) {
  const wanted = new Set(missed);
  const theirs = diff.split(/\n(?=diff --git )/).filter((part) => {
    const header = part.match(/^diff --git a\/.+? b\/(.+)$/m);
    return header && wanted.has(header[1]);
  }).join('\n');
  const material = theirs.length > budget ? digestDiff(theirs, budget) : theirs;

  const system = [
    'You sort files into Git commits that have already been planned.',
    'Reply with JSON and nothing else, in this exact shape:',
    '{"placements": [{"file": "path", "commit": 1}], "new": [{"commit": 4, "reason": "...", "subject": "..."}]}',
    'Give every file listed under <files> a placement, with the number of the',
    'planned commit it belongs to. When it fits none of them, give it a new',
    'number and describe that commit under "new", with a short "reason" and a',
    'commit "subject". Several files can share a new commit.',
    'Each new subject is one line, and follows these rules:',
    // The plain prompt's own lines after its first four say how to word a
    // subject and what this repository's rules are; its reply shape does not apply.
    ...systemPrompt(rules).split('\n').slice(4)
  ].join('\n');
  const planned = groups
    .map((g, i) => `${i + 1}. ${g.subject || g.reason} (${g.reason})\n   ${g.files.join(', ')}`)
    .join('\n');
  const user = `<commits>\n${planned}\n</commits>\n<files>\n${missed.join('\n')}\n</files>\n<diff>\n${material}\n</diff>`;

  let reply;
  try {
    ({ raw: reply } = await askProvider(chosen, system, user, { split: true }));
  } catch {
    return groups;
  }
  const text = reply ?? '';
  let parsed = null;
  try {
    parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  } catch {
    return groups;
  }

  const result = groups.map((g) => ({ ...g, files: [...g.files] }));
  const extra = new Map();
  for (const n of Array.isArray(parsed?.new) ? parsed.new : []) {
    const number = Number(n?.commit);
    if (Number.isInteger(number) && number > groups.length && typeof n.reason === 'string') {
      extra.set(number, { reason: n.reason.trim() || 'More changes', subject: cleanSubject(n.subject ?? ''), files: [] });
    }
  }
  const placed = new Set();
  for (const p of Array.isArray(parsed?.placements) ? parsed.placements : []) {
    const file = p?.file;
    const number = Number(p?.commit);
    if (!wanted.has(file) || placed.has(file)) continue;
    const target = number >= 1 && number <= groups.length ? result[number - 1] : extra.get(number);
    if (!target) continue;
    target.files.push(file);
    placed.add(file);
  }
  return [...result, ...[...extra.values()].filter((g) => g.files.length)];
}

/**
 * A split with every file in it: the model's groups, then a second pass for
 * what it left out, then whatever is still unplaced as a group of its own.
 *
 * Dropping a split for a few forgotten files would hide good advice, and
 * acting on it as it is would commit less than was ticked without saying so.
 * So the files that are left are shown, with no subject, for the user to place.
 */
async function completeGroups(chosen, groups, paths, context) {
  if (groups.length < 2) return [];
  let done = groups;
  if (unplaced(done, paths).length > 0) done = await placeMissed(chosen, done, unplaced(done, paths), context);
  const missed = unplaced(done, paths);
  if (missed.length > 0) done = [...done, { reason: 'Not placed by the AI', subject: '', files: missed, leftover: true }];
  return done;
}

/** The opening verb of a subject without a type, and the type it usually means. */
const VERB_TYPES = {
  add: 'feat', implement: 'feat', introduce: 'feat', support: 'feat', allow: 'feat', create: 'feat',
  fix: 'fix', correct: 'fix', resolve: 'fix', repair: 'fix', prevent: 'fix',
  update: 'refactor', improve: 'refactor', refactor: 'refactor', simplify: 'refactor', clean: 'refactor',
  rename: 'refactor', move: 'refactor', restructure: 'refactor', reorganize: 'refactor',
  remove: 'chore', bump: 'chore', upgrade: 'chore',
  document: 'docs', test: 'test'
};

/**
 * Put right the mistakes a model makes most with a commit format, before the
 * rules are checked: a type with no colon ("fix api imports"), no type at all
 * ("update settings panel"), a capital in the type, a scope where none is
 * allowed, a full stop at the end.
 *
 * Small local models ignore the format often, and asking them again works
 * only some of the time. These fixes are mechanical and need no model; what
 * they cannot settle, such as a line too long, is still sent back. The type,
 * when there was none, comes from the files where they all say the same
 * (only docs, only tests), else from the opening verb, else from the type the
 * whole change was given.
 */
export function repairSubject(subject, rules, { files = [], fallbackType = null } = {}) {
  let text = (subject ?? '').trim();
  const conventional = (rules?.source === 'commitlint' || rules?.source === 'gitkeen') && rules?.format !== 'free';
  if (!text || !conventional || !rules?.enforced) return text;

  const enforced = rules.rules ?? {};
  const types = Array.isArray(rules.types) && rules.types.length ? rules.types : null;
  const allowed = (t) => (types ? types.includes(t) : /^[a-z]+$/.test(t));
  const noScope = enforced['scope-empty']?.applicable === 'always';

  let match = text.match(/^([A-Za-z]+)(\([^)]*\))?(!)?:\s*(.*)$/);
  if (match && allowed(match[1].toLowerCase())) {
    const [, type, scope = '', bang = '', rest] = match;
    text = `${type.toLowerCase()}${noScope ? '' : scope}${bang}: ${rest}`;
  } else if (!match) {
    const [first, ...others] = text.split(/\s+/);
    const word = first.toLowerCase().replace(/[^a-z]/g, '');
    if (allowed(word) && others.length) {
      // "fix api imports": the type is there, only the colon is missing.
      text = `${word}: ${others.join(' ')}`;
    } else {
      const byFiles = files.length && files.every((f) => /\.(md|mdx|txt)$|(^|\/)docs\//i.test(f)) ? 'docs'
        : files.length && files.every((f) => /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[a-z]+$/i.test(f)) ? 'test'
        : null;
      const type = [byFiles, VERB_TYPES[word], fallbackType, 'chore'].find((t) => t && allowed(t));
      if (type) text = `${type}: ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
    }
  }

  if (enforced['subject-full-stop']?.applicable === 'never') text = text.replace(/\.+$/, '');
  return text;
}

/**
 * Hold each group's subject to the rules, as the main one is.
 *
 * Each becomes a commit of its own, so each is checked by what the Commit
 * button would check it by. One that breaks a blocking rule is sent back once,
 * without the diff: the usual fault is a line too long, which needs only the
 * line and the complaint to fix.
 */
async function checkGroups(groups, { chosen, rules, validate, fallbackType }) {
  const checked = [];
  for (const group of groups) {
    let subject = group.leftover ? '' : repairSubject(group.subject, rules, { files: group.files, fallbackType });
    let check = subject ? validate(subject) : null;
    if (check && check.blocking.length > 0 && !group.leftover) {
      const complaint = [
        `You suggested this subject for a commit of ${group.files.join(', ')}: ${subject}`,
        'That breaks the rules of this repository:',
        ...check.blocking.map((p) => `- ${p.message}`),
        '',
        'Reply with a corrected subject line, and nothing else.'
      ].join('\n');
      const retry = await askProvider(chosen, systemPrompt(rules), complaint).catch(() => null);
      if (retry?.subject) {
        const again = repairSubject(retry.subject, rules, { files: group.files, fallbackType });
        // A retry that is no better is not taken: the first answer was at least the model's own.
        if (validate(again).blocking.length < check.blocking.length) subject = again;
        check = validate(subject);
      }
    }
    checked.push({
      ...group,
      subject,
      problems: check?.problems ?? [],
      ok: Boolean(check) && check.blocking.length === 0
    });
  }
  return checked;
}

/**
 * Ask for a subject line describing this diff.
 *
 * `validate` is the repository's own checker, passed in so the suggestion is
 * held to exactly what the Commit button will hold it to. A first answer that
 * breaks a blocking rule is sent back once with the complaint attached, which
 * fixes the usual case of a line a few characters too long. If the second
 * answer still breaks a rule it is returned anyway, with its problems, so the
 * user sees the suggestion and the reason it is not acceptable rather than an
 * error with nothing in it.
 */
export async function suggestSubject({ diff, stat, rules, provider, validate, paths = [] }) {
  const chosen = provider || (await suggestionProviders()).preferred;
  if (!chosen) {
    throw new Error(
      'No AI provider is configured. Add a key in Settings, set ' +
        `${KEY_ENV.anthropic} or ${KEY_ENV.openai}, or run Ollama locally.`
    );
  }
  if (!PROVIDERS[chosen]) throw new Error(`Unknown provider "${chosen}".`);
  if (!diff.trim()) throw new Error('There is nothing staged to describe.');

  // Too large to send whole, every file still goes in, shortened, so that a
  // split can place each of them: that is when a split matters most.
  const budget = LOCAL_PROBE[chosen] ? MAX_DIFF_LOCAL : MAX_DIFF;
  const clipped = diff.length > budget;
  const text = clipped ? digestDiff(diff, budget) : diff;

  // Asking about a split is only worth it with two files or more.
  const askSplit = paths.length >= 2;

  const system = systemPrompt(rules, { split: askSplit });
  // The paths are listed on their own as well: in a long or shortened diff
  // they are easy to lose, and a file the model forgets cannot be placed.
  const files = askSplit ? `<files>\n${paths.join('\n')}\n</files>\n` : '';
  let { subject, raw, model } = await askProvider(chosen, system, `${files}<diff>\n${text}\n</diff>`, { split: askSplit });

  let groups = [];
  if (askSplit) {
    const parsed = parseJsonReply(raw);
    if (parsed) {
      subject = cleanSubject(parsed.subject);
      groups = parsed.groups;
    }
    // If it could not be read, `subject` is left as it came back and treated
    // as a plain line: a model that ignored the shape still gives a subject.
  }

  if (!subject) throw new Error(`${PROVIDERS[chosen].label} returned an empty subject.`);

  subject = repairSubject(subject, rules, { files: paths });
  let check = validate(subject);
  if (check.blocking.length > 0) {
    const complaint = [
      `<diff>\n${text}\n</diff>`,
      '',
      `You suggested: ${subject}`,
      'That breaks the rules of this repository:',
      ...check.blocking.map((p) => `- ${p.message}`),
      '',
      'Reply with a corrected subject line, and nothing else.'
    ].join('\n');

    // The retry is about the subject alone, so it asks for a plain line
    // whatever the first request asked for. Any grouping already stands.
    const retry = await askProvider(chosen, systemPrompt(rules), complaint);
    if (retry.subject) {
      subject = repairSubject(retry.subject, rules, { files: paths });
      check = validate(subject);
    }
  }

  return {
    subject,
    provider: chosen,
    model,
    clipped,
    problems: check.problems,
    ok: check.blocking.length === 0,
    groups: await checkGroups(await completeGroups(chosen, usableGroups(groups, paths), paths, { diff, budget, rules }), {
      chosen, rules, validate, fallbackType: subject.match(/^([a-z]+)[(!:]/)?.[1] ?? null
    })
  };
}


/* ------------------------------------------------------------------ *
 * Explanations
 * ------------------------------------------------------------------ */

const EXPLAIN_TOKENS = 700;
const EXPLAIN_TOKENS_LOCAL = 2_000;

const EXPLAIN_SYSTEM = [
  'You explain Git history to a developer who is looking at it in a Git client.',
  'Write plain English for a reader whose first language may not be English: short sentences, common words, no idioms.',
  'Start with the answer, in one or two sentences. Then give the detail as a few short points, each on its own line starting with "- ".',
  'Stay under 150 words. Use only what is in the material given; if something cannot be known from it, say so rather than guess.',
  'Name files, functions and branches exactly as they appear. Do not repeat the question, and do not add a greeting or a closing line.'
].join(' ');

const QUESTIONS = {
  commit: 'Explain what this commit changed, and why it probably matters.',
  conflict: 'Explain why these two changes conflict, what each side was trying to do, and what a good resolution would keep.',
  branches: 'Explain how these two branches differ and why they diverged: what each side did after they split.',
  operation: 'Explain in plain words what this Git operation will do, what could be lost, and how it could be undone.',
  error: 'Explain in plain words why this Git command failed, and what to type or do to fix it.'
};

/**
 * Explain a commit, a conflict, two diverged branches, an operation or a failed command.
 *
 * `material` is what the caller gathered from the repository, as text. It is
 * clipped to what the provider can read, the same way a diff for a subject
 * is, so a large commit is explained from its beginning and its file list.
 */
export async function explain({ kind, material, stat = '', provider = null }) {
  const question = QUESTIONS[kind];
  if (!question) throw new Error(`Gitkeen cannot explain "${kind}".`);
  const chosen = provider || (await suggestionProviders()).preferred;
  if (!chosen) {
    throw new Error('No AI provider is configured. Add a key in Settings, or run Ollama or LM Studio locally.');
  }
  if (!PROVIDERS[chosen]) throw new Error(`Unknown provider "${chosen}".`);
  const local = !!LOCAL_PROBE[chosen];
  const { text, clipped } = clipDiff(material, stat, local ? MAX_DIFF_LOCAL : MAX_DIFF);
  const { raw, model, json } = await requestProvider(
    chosen, EXPLAIN_SYSTEM, `${question}\n\n<material>\n${text}\n</material>`,
    local ? EXPLAIN_TOKENS_LOCAL : EXPLAIN_TOKENS
  );
  // A reasoning model can wrap its thinking in <think> tags before the answer.
  const answer = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (!answer) {
    const cut = json?.choices?.[0]?.finish_reason === 'length';
    throw new Error(`${PROVIDERS[chosen].label} ${cut ? 'ran out of answer budget before' : 'returned nothing when'} explaining it.`);
  }
  return { text: answer, provider: chosen, model, clipped };
}
