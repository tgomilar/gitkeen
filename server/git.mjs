/**
 * Git process runner.
 *
 * This is the only place in the backend that knows how to spawn `git`.
 * When this app moves to Tauri, the Rust side reimplements exactly this
 * surface and nothing above it has to change.
 */
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const MAX_BUFFER = 64 * 1024 * 1024; // large histories produce large logs

export class GitError extends Error {
  constructor(message, { command, stderr, code }) {
    super(message);
    this.name = 'GitError';
    this.command = command;
    this.stderr = stderr;
    this.code = code;
  }
}

/** Run a git command inside `cwd` and resolve with its stdout. */
export function runGit(cwd, args, { allowFailure = false, env = null } = {}) {
  const options = {
    cwd,
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
    env: env ? { ...process.env, ...env } : process.env
  };
  return new Promise((res, rej) => {
    execFile('git', args, options, (err, stdout, stderr) => {
      if (err && !allowFailure) {
        const detail = (stderr || err.message || '').trim();
        rej(new GitError(detail || `git ${args[0]} failed`, {
          command: `git ${args.join(' ')}`,
          stderr: detail,
          code: typeof err.code === 'number' ? err.code : 1
        }));
        return;
      }
      res({ stdout, stderr, code: err ? err.code ?? 1 : 0 });
    });
  });
}

/** stdout only, for the common case. */
export async function git(cwd, args, opts) {
  const { stdout } = await runGit(cwd, args, opts);
  return stdout;
}

async function directoryAt(path) {
  try {
    return (await stat(path)).isDirectory() ? path : null;
  } catch {
    return null;
  }
}

/**
 * Paths a user might mean by what they typed, in order of likelihood.
 *
 * A relative path is resolved against the server's own directory, which is
 * rarely what someone wants. So when a path has no leading "/" we also try it
 * as an absolute path, because a pasted path that lost its first character is
 * a common slip.
 */
function candidatePaths(inputPath) {
  const text = inputPath.trim().replace(/\/+$/, '') || '/';
  if (text.startsWith('~')) {
    return [resolve(process.env.HOME ?? '', text.slice(1).replace(/^\/+/, ''))];
  }
  if (text.startsWith('/')) return [resolve(text)];
  return [resolve(text), resolve('/', text)];
}

/** Resolve a user-supplied path to the root of the repository containing it. */
export async function resolveRepository(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new GitError('No repository path was given.', { command: '', stderr: '', code: 1 });
  }

  const candidates = candidatePaths(inputPath);
  let directory = null;
  for (const candidate of candidates) {
    directory = await directoryAt(candidate);
    if (directory) break;
  }

  if (!directory) {
    const shown = candidates.join('\n  or  ');
    throw new GitError(
      `No folder found at:\n  ${shown}\n\nEnter a full path that starts with "/".`,
      { command: '', stderr: '', code: 1 }
    );
  }

  const top = (await git(directory, ['rev-parse', '--show-toplevel'])).trim();
  if (!top) {
    throw new GitError(`Not a Git repository: ${directory}`, { command: '', stderr: '', code: 1 });
  }
  return top;
}

export async function gitVersion() {
  const out = await git(process.cwd(), ['--version']);
  return out.trim().replace(/^git version\s*/, '');
}
