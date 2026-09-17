/**
 * Gitalia's own settings, which are about the user rather than a repository.
 *
 * Only the AI keys live here so far. They are kept outside every repository on
 * purpose: a key is not part of a project and must never be committed by the
 * tool whose job is committing things.
 *
 * The file is written with owner-only permissions, and the keys never leave
 * this process. Nothing here is sent to the browser: the UI is told which
 * providers are configured, never what with. That is also why a key can be set
 * and cleared but not read back.
 *
 * An environment variable always wins over the file. A key exported in a shell
 * is a deliberate act for that session, and silently preferring a stale saved
 * key over it would be the wrong way round.
 */
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

const FILE = process.env.GITALIA_CONFIG || join(homedir(), '.config', 'gitalia', 'config.json');

/** The providers a key can be stored for, and the variable that overrides it. */
export const KEY_ENV = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY'
};

async function readFileSettings() {
  try {
    const raw = await readFile(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // No file yet, or one we cannot parse. Either way there is nothing saved,
    // which is a normal state and not worth failing the call over.
    return {};
  }
}

/**
 * The key to use for a provider, or an empty string when there is none.
 *
 * This is the only function that hands a key out, and it is called only from
 * the server while making a request.
 */
export async function readKey(provider) {
  const env = (process.env[KEY_ENV[provider]] ?? '').trim();
  if (env) return env;
  const settings = await readFileSettings();
  return (settings.keys?.[provider] ?? '').trim();
}

/**
 * Where each provider's key comes from, for the settings panel.
 *
 * Reports presence and origin only. A saved key cannot be read back out, so
 * changing it means pasting a new one.
 */
export async function keyStatus() {
  const settings = await readFileSettings();
  const status = {};
  for (const [provider, variable] of Object.entries(KEY_ENV)) {
    const env = (process.env[variable] ?? '').trim();
    const saved = (settings.keys?.[provider] ?? '').trim();
    status[provider] = {
      configured: Boolean(env || saved),
      // Which one is actually in use, so the panel can explain why editing a
      // saved key changed nothing while a variable is set.
      source: env ? 'environment' : saved ? 'saved' : null,
      variable,
      saved: Boolean(saved)
    };
  }
  return { file: FILE, providers: status };
}

/**
 * Save or clear a provider's key.
 *
 * Passing an empty key removes it, which is how the panel offers "Disconnect".
 */
export async function writeKey(provider, key) {
  if (!KEY_ENV[provider]) throw new Error(`Unknown provider "${provider}".`);

  const settings = await readFileSettings();
  const keys = { ...(settings.keys ?? {}) };
  const trimmed = (key ?? '').trim();

  if (trimmed) keys[provider] = trimmed;
  else delete keys[provider];

  const next = { ...settings, keys };

  await mkdir(dirname(FILE), { recursive: true });
  // Written 0600 before anything is in it, so the key is never briefly
  // readable by other accounts on the machine.
  await writeFile(FILE, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  // writeFile only applies the mode when it creates the file, so an existing
  // one keeps whatever it had until it is set here.
  await chmod(FILE, 0o600).catch(() => {});

  return keyStatus();
}
