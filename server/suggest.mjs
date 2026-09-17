/**
 * Suggesting a commit subject from the change about to be committed.
 *
 * A hosted model means the contents of the open repository go on the network,
 * so this is off unless a key is configured, it is never reached by opening a
 * repository, and it runs only when the user asks for a suggestion. No key
 * ever reaches the browser: the request is made here and only the resulting
 * line is returned.
 *
 * Three providers are supported: two hosted, because people already have one
 * key or the other, and Ollama, which runs on the machine and so sends nothing
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
 */
const MAX_DIFF = 40_000;

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
    body: (model, system, user) => ({
      model,
      max_tokens: 200,
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
    body: (model, system, user) => ({
      model,
      max_tokens: 200,
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
    body: (model, system, user) => ({
      model,
      stream: false,
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

/** Is a local Ollama actually listening? Asked before offering it. */
async function ollamaReady() {
  try {
    const res = await fetch(PROVIDERS.ollama.url.replace('/api/chat', '/api/tags'), {
      signal: AbortSignal.timeout(400)
    });
    return res.ok;
  } catch {
    return false;
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
  for (const name of Object.keys(PROVIDERS)) {
    if (name === 'ollama') {
      if (await ollamaReady()) available.push(name);
    } else if (await key(name)) {
      available.push(name);
    }
  }
  return {
    available,
    // Whichever is configured wins; the order of PROVIDERS breaks a tie, which
    // puts a hosted key ahead of Ollama only because it has to be broken.
    preferred: available[0] ?? null,
    models: Object.fromEntries(
      available.map((name) => [name, process.env[PROVIDERS[name].modelEnv] || PROVIDERS[name].model])
    )
  };
}

/**
 * The rules of the open repository, written out as instructions.
 *
 * The same config that blocks the Commit button is what the model is told to
 * satisfy, so a suggestion is not held to a standard the repository does not
 * actually have, nor excused from one it does.
 */
function systemPrompt(rules) {
  const lines = [
    'You write the subject line of a Git commit message.',
    'You are given a diff. Reply with the subject line and nothing else:',
    'no body, no explanation, no quotation marks, no trailing full stop.',
    'Describe what the change does and why, not which files moved.',
    'Use the imperative mood, as in "add", "fix", "remove".'
  ];

  const enforced = rules?.enforced ? rules.rules ?? {} : {};

  if (rules?.source === 'commitlint') {
    lines.push('Follow Conventional Commits: type(scope): subject, where the scope is optional.');
  }

  const types = rules?.types;
  if (Array.isArray(types) && types.length > 0) {
    lines.push(`The type must be one of: ${types.join(', ')}.`);
  }

  const max = enforced['header-max-length']?.value ?? rules?.maxHeader;
  if (typeof max === 'number') {
    lines.push(`The whole line, type and scope included, must be at most ${max} characters.`);
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

  return lines.join('\n');
}

/**
 * Trim a diff to something worth paying for.
 *
 * Whole files are dropped rather than cut mid-hunk where possible, so what
 * survives still parses as a diff.
 */
function clipDiff(diff, stat) {
  if (diff.length <= MAX_DIFF) return { text: diff, clipped: false };

  const files = diff.split(/\n(?=diff --git )/);
  const kept = [];
  let size = 0;
  for (const file of files) {
    if (size + file.length > MAX_DIFF) break;
    kept.push(file);
    size += file.length + 1;
  }

  // A single file larger than the budget leaves nothing, so fall back to a
  // hard cut: a truncated hunk still says more than no diff at all.
  const text = kept.length > 0 ? kept.join('\n') : diff.slice(0, MAX_DIFF);
  const note = [
    '',
    '--- the diff was too large to send in full ---',
    'Only part of it is above. The full set of files changed:',
    stat.trim()
  ].join('\n');

  return { text: text + note, clipped: true };
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
  const model = process.env[provider.modelEnv] || provider.model;

  // A hung request should not leave the button spinning forever.
  const abort = AbortSignal.timeout(30_000);

  let res;
  try {
    res = await fetch(provider.url, {
      method: 'POST',
      headers: provider.headers(apiKey),
      body: JSON.stringify(provider.body(model, system, user)),
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
      throw new Error(`${provider.label} is rate limiting: ${detail}`);
    }
    throw new Error(`${provider.label} returned ${res.status}: ${detail}`);
  }

  return { subject: cleanSubject(provider.read(json)), model };
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
export async function suggestSubject({ diff, stat, rules, provider, validate }) {
  const chosen = provider || (await suggestionProviders()).preferred;
  if (!chosen) {
    throw new Error(
      'No AI provider is configured. Add a key in Settings, set ' +
        `${KEY_ENV.anthropic} or ${KEY_ENV.openai}, or run Ollama locally.`
    );
  }
  if (!PROVIDERS[chosen]) throw new Error(`Unknown provider "${chosen}".`);
  if (!diff.trim()) throw new Error('There is nothing staged to describe.');

  const system = systemPrompt(rules);
  const { text, clipped } = clipDiff(diff, stat);

  let { subject, model } = await askProvider(chosen, system, `<diff>\n${text}\n</diff>`);
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

    const retry = await askProvider(chosen, system, complaint);
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
    ok: check.blocking.length === 0
  };
}
