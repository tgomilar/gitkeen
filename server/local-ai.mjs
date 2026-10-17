/**
 * Ollama and LM Studio, run from inside Gitkeen.
 *
 * A local model is the private choice, since nothing leaves the machine, but
 * it used to ask for a terminal: `ollama serve`, then `ollama pull`, then a
 * variable to say which model; or LM Studio's Developer tab and its model
 * loader. This module does those steps for the settings panel, so a user can
 * go from "installed" to "writing commit subjects" without leaving the app.
 *
 * It only ever runs what the user installed, and only when asked. It never
 * installs either app itself: that is the user's decision, made on the app's
 * own download page.
 */
import { spawn, execFile } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

const HOST = () => (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, '');

/**
 * The model offered when none is downloaded yet. Small and quick: a commit
 * subject is one line, and a large model on a laptop would make every
 * suggestion slow for no visible gain.
 */
export const RECOMMENDED_MODEL = 'llama3.2:3b';

/** The same model under the names Ollama also gives it, so it is not offered twice. */
const RECOMMENDED_NAMES = [RECOMMENDED_MODEL, 'llama3.2:latest', 'llama3.2'];

/** Where the macOS app keeps its command, for an Ollama installed only as the app. */
const MAC_APPS = ['/Applications/Ollama.app', join(homedir(), 'Applications', 'Ollama.app')];

async function exists(path, mode = constants.F_OK) {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}

/** The Ollama app on macOS, or null. Opening it starts the server and its menu bar icon. */
async function findMacApp() {
  if (process.platform !== 'darwin') return null;
  for (const app of MAC_APPS) if (await exists(app)) return app;
  return null;
}

/** The `ollama` command, from PATH or from inside the macOS app, or null. */
async function findCommand() {
  const name = process.platform === 'win32' ? 'ollama.exe' : 'ollama';
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    dirs.push(join(process.env.LOCALAPPDATA, 'Programs', 'Ollama'));
  }
  for (const app of MAC_APPS) dirs.push(join(app, 'Contents', 'Resources'));
  for (const dir of dirs) {
    const path = join(dir, name);
    if (await exists(path, constants.X_OK)) return path;
  }
  return null;
}

/** The names of the downloaded models, or null when the server is not answering. */
export async function ollamaModels() {
  try {
    const res = await fetch(`${HOST()}/api/tags`, { signal: AbortSignal.timeout(600) });
    if (!res.ok) return null;
    const json = await res.json();
    return (json?.models ?? []).map((m) => m?.name).filter(Boolean);
  } catch {
    return null;
  }
}

/**
 * Everything the panel needs to show the next step: install it, start it,
 * download a model, or nothing at all.
 *
 * A server that answers counts as installed even when no command is found,
 * since it may run in a container or on another machine through OLLAMA_HOST.
 */
export async function ollamaStatus() {
  const models = await ollamaModels();
  const running = models !== null;
  const installed = running || Boolean((await findMacApp()) || (await findCommand()));
  return {
    installed,
    running,
    models: models ?? [],
    recommended: RECOMMENDED_MODEL,
    hasRecommended: (models ?? []).some((m) => RECOMMENDED_NAMES.includes(m)),
    pull: pull ? { ...pull } : null
  };
}

/**
 * Start Ollama and wait until it answers.
 *
 * On a Mac the app is opened when it is there, because that is how Ollama
 * expects to run: it keeps the server alive and shows it in the menu bar,
 * where the user can quit it. Otherwise `ollama serve` is started on its own,
 * detached, so it outlives Gitkeen the same way the app would.
 */
export async function startOllama() {
  if ((await ollamaModels()) !== null) return ollamaStatus();

  const app = await findMacApp();
  const command = app ? null : await findCommand();
  if (!app && !command) {
    throw new Error('Ollama is not installed. Download it from ollama.com, then try again.');
  }

  if (app) {
    await new Promise((ok, fail) => execFile('open', ['-a', app], (err) => (err ? fail(err) : ok())));
  } else {
    const child = spawn(command, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {});
    child.unref();
  }

  // The app takes a few seconds on first launch; a bare server is quicker.
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if ((await ollamaModels()) !== null) return ollamaStatus();
    await new Promise((ok) => setTimeout(ok, 500));
  }
  throw new Error('Ollama was started but is not answering yet. Wait a moment, then press Check again.');
}

/**
 * The one download in progress, or the last one to finish.
 *
 * A model is gigabytes, so the download runs on here while the panel asks how
 * far it has got. Only one runs at a time: two would share the same network
 * and both finish later.
 */
let pull = null;

/** Start downloading a model. Returns at once; ask `ollamaStatus` for progress. */
export function pullModel(model) {
  if (pull && !pull.done) throw new Error(`Already downloading ${pull.model}.`);
  if (!/^[\w.\-/:]+$/.test(model ?? '')) throw new Error(`"${model}" is not a model name.`);

  pull = { model, status: 'Starting', completed: 0, total: 0, done: false, error: null };
  const current = pull;
  download(current).catch((err) => {
    current.error = err?.message ?? String(err);
    current.done = true;
  });
  return { ...current };
}

/**
 * Read Ollama's progress stream: one JSON object per line, each with a status
 * and, while a layer downloads, the bytes so far and in all.
 */
async function download(current) {
  const res = await fetch(`${HOST()}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: current.model, stream: true })
  });
  if (!res.ok || !res.body) throw new Error(`Ollama refused the download: ${(await res.text()).slice(0, 200)}`);

  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event.error) throw new Error(event.error);
      current.status = event.status ?? current.status;
      if (event.total) {
        current.total = event.total;
        current.completed = event.completed ?? 0;
      }
    }
  }
  if (current.status !== 'success') throw new Error('The download stopped before it finished.');
  current.done = true;
}

/* ------------------------------------------------------------------ *
 * LM Studio
 * ------------------------------------------------------------------ */

const LMSTUDIO_HOST = () => (process.env.LMSTUDIO_HOST || 'http://127.0.0.1:1234').replace(/\/$/, '');

const LMSTUDIO_APPS = ['/Applications/LM Studio.app', join(homedir(), 'Applications', 'LM Studio.app')];

/** LM Studio adds its `lms` command here the first time the app opens. */
async function findLms() {
  const name = process.platform === 'win32' ? 'lms.exe' : 'lms';
  const dirs = [join(homedir(), '.lmstudio', 'bin'), join(homedir(), '.cache', 'lm-studio', 'bin')];
  dirs.push(...(process.env.PATH ?? '').split(delimiter).filter(Boolean));
  for (const dir of dirs) {
    const path = join(dir, name);
    if (await exists(path, constants.X_OK)) return path;
  }
  return null;
}

async function findLmstudioApp() {
  if (process.platform === 'darwin') {
    for (const app of LMSTUDIO_APPS) if (await exists(app)) return app;
  } else if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const app = join(process.env.LOCALAPPDATA, 'Programs', 'LM Studio');
    if (await exists(app)) return app;
  }
  return null;
}

/** Run `lms`, and turn a failure into its own message without the terminal colours. */
function runLms(lms, args, timeout) {
  return new Promise((ok, fail) => {
    execFile(lms, args, { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) return ok(stdout);
      const said = `${stderr || stdout}`.replace(/\x1b\[[0-9;]*m/g, '').trim().split('\n').filter(Boolean).at(-1);
      fail(new Error(err.killed ? 'LM Studio took too long to answer.' : said || err.message));
    });
  });
}

/**
 * The models the server can answer with, or null when it is not running.
 *
 * LM Studio's own listing says which are chat models, so an embedding model,
 * which cannot write a subject, is left out. An older LM Studio without that
 * listing answers the OpenAI-shaped one instead, which says only the names.
 */
export async function lmstudioModels() {
  const get = async (path) => {
    const res = await fetch(`${LMSTUDIO_HOST()}${path}`, { signal: AbortSignal.timeout(600) });
    return res.ok ? res.json() : null;
  };
  try {
    const rich = await get('/api/v0/models').catch(() => null);
    if (rich?.data) return rich.data.filter((m) => m?.type !== 'embeddings').map((m) => m.id).filter(Boolean);
    const plain = await get('/v1/models');
    return plain ? (plain.data ?? []).map((m) => m?.id).filter(Boolean) : null;
  } catch {
    return null;
  }
}

/**
 * What the LM Studio row needs: installed, its server running, and the models
 * it serves. Asking `lms` anything wakes LM Studio's background service, so
 * this looks only at files and the port, and `lms` runs only when asked to.
 */
export async function lmstudioStatus() {
  const models = await lmstudioModels();
  const running = models !== null;
  const lms = await findLms();
  return {
    installed: running || Boolean(lms || (await findLmstudioApp())),
    running,
    cli: Boolean(lms),
    models: models ?? []
  };
}

/** Start LM Studio's server on the port Gitkeen talks to, and wait until it answers. */
export async function startLmstudio() {
  if ((await lmstudioModels()) !== null) return lmstudioStatus();
  const lms = await findLms();
  if (!lms) {
    throw new Error(
      "LM Studio's lms command was not found. Open LM Studio once so it adds it, or start the server in its Developer tab."
    );
  }
  const port = new URL(LMSTUDIO_HOST()).port || '1234';
  await runLms(lms, ['server', 'start', '--port', port], 60_000);

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if ((await lmstudioModels()) !== null) return lmstudioStatus();
    await new Promise((ok) => setTimeout(ok, 500));
  }
  throw new Error('The LM Studio server was started but is not answering yet. Wait a moment, then press Check again.');
}

/** The chat models downloaded in LM Studio, to offer when none is loaded. */
export async function lmstudioDownloaded() {
  const lms = await findLms();
  if (!lms) return [];
  const listed = JSON.parse(await runLms(lms, ['ls', '--json'], 30_000));
  return (Array.isArray(listed) ? listed : [])
    .filter((m) => m?.type === 'llm' && m.modelKey)
    .map((m) => ({ key: m.modelKey, name: m.displayName ?? m.modelKey, size: m.sizeBytes ?? 0 }));
}

/**
 * Load a downloaded model into memory. A large one takes a minute or more on
 * a laptop, so the wait is generous; the panel shows it is busy meanwhile.
 */
export async function loadLmstudio(key) {
  if (!/^[\w.\-/@:]+$/.test(key ?? '')) throw new Error(`"${key}" is not a model name.`);
  const lms = await findLms();
  if (!lms) throw new Error("LM Studio's lms command was not found. Load the model in LM Studio instead.");
  await runLms(lms, ['load', key, '--yes'], 5 * 60_000);
  return lmstudioStatus();
}
