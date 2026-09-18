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
import { readKey, KEY_ENV } from './settings.mjs';

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

const PROVIDERS = {
  anthropic: {
    label: 'Anthropic',
    env: 'ANTHROPIC_API_KEY',
    modelEnv: 'GITALIA_ANTHROPIC_MODEL',
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
    modelEnv: 'GITALIA_OPENAI_MODEL',
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
    modelEnv: 'GITALIA_LMSTUDIO_MODEL',
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
    modelEnv: 'GITALIA_OLLAMA_MODEL',
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

/** The two local providers are offered only when they are actually running. */
const LOCAL_PROBE = {
  ollama: {
    url: () => PROVIDERS.ollama.url.replace('/api/chat', '/api/tags'),
    // { models: [{ name: 'llama3.2' }] }
    models: (json) => (json?.models ?? []).map((m) => m?.name).filter(Boolean)
  },
  lmstudio: {
    url: () => PROVIDERS.lmstudio.url.replace('/chat/completions', '/models'),
    // { data: [{ id: 'google/gemma-4-e4b' }] }
    models: (json) => (json?.data ?? []).map((m) => m?.id).filter(Boolean)
  }
};

/**
 * Ask a local server what it has loaded.
 *
 * Returns the model names, or null when nothing is listening. The names matter
 * because a local server runs whichever model the user chose, so the one to
 * ask for cannot be known in advance.
 */
async function localModels(name) {
  const probe = LOCAL_PROBE[name];
  if (!probe) return null;
  try {
    const res = await fetch(probe.url(), { signal: AbortSignal.timeout(600) });
    if (!res.ok) return null;
    return probe.models(await res.json());
  } catch {
    return null;
  }
}

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
      const chosen = process.env[PROVIDERS[name].modelEnv] || loaded[0] || PROVIDERS[name].model;
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

  return {
    available,
    // Whichever is configured wins; the order of PROVIDERS breaks a tie, which
    // puts a hosted key ahead of a local server only because it has to be
    // broken somehow.
    preferred: available[0] ?? null,
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
        '{"subject": "...", "groups": [{"reason": "...", "files": ["path", ...]}]}',
        '"subject" is the commit subject line for the whole change.',
        'Describe what the change does and why, not which files moved.',
        'Use the imperative mood, as in "add", "fix", "remove".',
        '',
        '"groups" is for when the change holds work that serves different',
        'purposes and would read better as separate commits. Examples: a',
        'feature alongside an unrelated config or tooling change; a bug fix',
        'alongside unrelated documentation; two features touching different',
        'parts of the app.',
        'Give a group per commit, each with a short "reason" naming the work',
        'and the exact file paths from the diff that belong to it.',
        'Every file in the diff must appear in exactly one group.',
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

  if (rules?.source === 'commitlint') {
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

async function askProvider(name, system, user) {
  const provider = PROVIDERS[name];
  const apiKey = await key(name);
  if (!apiKey) {
    throw new Error(`No ${provider.label} key. Add one in Settings, or set ${provider.env}.`);
  }
  let model = process.env[provider.modelEnv] || provider.model;
  if (LOCAL_PROBE[name] && !process.env[provider.modelEnv]) {
    const loaded = await localModels(name);
    model = loaded?.[0] || model;
    if (!model) throw new Error(`${provider.label} has no model loaded.`);
  }

  // A hung request should not leave the button spinning forever.
  const abort = AbortSignal.timeout(30_000);

  let res;
  try {
    res = await fetch(provider.url, {
      method: 'POST',
      headers: provider.headers(apiKey),
      body: JSON.stringify(
        provider.body(model, system, user, LOCAL_PROBE[name] ? MAX_TOKENS_LOCAL : MAX_TOKENS)
      ),
      signal: abort
    });
  } catch (err) {
    if (err?.name === 'TimeoutError') throw new Error(`${provider.label} did not answer within 30 seconds.`);
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

  const raw = provider.read(json);
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
    if (files.length > 0) cleaned.push({ reason: group.reason, files });
  }

  // Fewer than two groups is not a split, and a grouping that misses files
  // would have the user commit less than they ticked without saying so.
  if (cleaned.length < 2 || seen.size !== wanted.size) return [];
  return cleaned;
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

  const { text, clipped } = clipDiff(diff, stat, LOCAL_PROBE[chosen] ? MAX_DIFF_LOCAL : MAX_DIFF);

  // Asking about a split is only worth it with enough files to split, and only
  // when the whole diff was seen: a grouping drawn from a clipped diff would
  // quietly leave out the files that did not fit.
  const askSplit = paths.length >= 3 && !clipped;

  const system = systemPrompt(rules, { split: askSplit });
  let { subject, raw, model } = await askProvider(chosen, system, `<diff>\n${text}\n</diff>`);

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
      subject = retry.subject;
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
    groups: usableGroups(groups, paths)
  };
}
