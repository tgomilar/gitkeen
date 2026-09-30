/**
 * The operation log, and the recovery points that make it more than a diary.
 *
 * Before an operation rewrites or deletes history, the commit the affected
 * ref points at is saved as `refs/gitalia/recovery/<id>`. A ref is what keeps
 * a commit alive: Git's garbage collector never removes anything a ref can
 * reach, so a dropped commit, a squashed run or a deleted branch can be
 * brought back for as long as its recovery point exists. The reflog does the
 * same job, but it expires, it is per ref, and a deleted branch's reflog is
 * deleted with it.
 *
 * The log itself is one JSON object per line in `<git dir>/gitalia/
 * operations.log`, so it belongs to the repository (and to one worktree of
 * it), not to Gitalia's own settings. Only the newest `KEEP` entries are
 * kept, and a recovery point goes with its entry.
 */
import { runGit, git, GitError } from './git.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

const KEEP = 100;
export const RECOVERY_PREFIX = 'refs/gitalia/recovery/';

async function logFile(path) {
  const gitDir = (await git(path, ['rev-parse', '--absolute-git-dir'])).trim();
  const dir = join(gitDir, 'gitalia');
  await mkdir(dir, { recursive: true });
  return join(dir, 'operations.log');
}

async function readEntries(path) {
  try {
    const text = await readFile(await logFile(path), 'utf8');
    return text.split('\n').filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  } catch {
    return [];
  }
}

async function writeEntries(path, entries) {
  await writeFile(await logFile(path), entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''));
}

/** The commit (or tag object) a ref points at, or null when it does not exist. */
export async function resolveRef(path, ref) {
  const { stdout, code } = await runGit(path, ['rev-parse', '--verify', '--quiet', ref], { allowFailure: true });
  return code === 0 ? stdout.trim() : null;
}

/** The branch HEAD is on, or null when it is detached. */
export async function currentBranch(path) {
  const { stdout, code } = await runGit(path, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true });
  return code === 0 ? stdout.trim() : null;
}

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Save a recovery point and add an entry to the log.
 *
 * `target` names what the operation changed: a branch, a tag, a stash or a
 * remote branch, and `before` is where it pointed first. Nothing is written
 * when there was nothing to lose, or when the operation changed nothing.
 */
export async function record(path, { operation, label, target, before, after = null, detail = null }) {
  if (!before || before === after) return null;
  const id = newId();
  const ref = RECOVERY_PREFIX + id;
  await git(path, ['update-ref', '-m', `gitalia: ${label}`, ref, before]);

  const entries = await readEntries(path);
  entries.push({ id, time: Date.now(), operation, label, target, before, after, detail, ref });
  const dropped = entries.splice(0, Math.max(0, entries.length - KEEP));
  for (const old of dropped) await runGit(path, ['update-ref', '-d', old.ref], { allowFailure: true });
  await writeEntries(path, entries);
  return id;
}

/** The log, newest first, each entry saying whether it can still be restored. */
export async function list(path) {
  const entries = await readEntries(path);
  const out = [];
  for (const entry of entries.reverse()) {
    const kept = (await resolveRef(path, entry.ref)) !== null;
    out.push({ ...entry, restorable: kept });
  }
  return out;
}

/**
 * Put what an operation changed back where it was before it ran.
 *
 * A restore is itself recorded first, so it can be undone the same way. The
 * current branch is moved with `reset --keep`, which refuses rather than
 * overwrite a local change to a file the restore would touch. Another branch
 * is only a ref, so it is moved, or recreated if it was deleted. A deleted tag
 * comes back only under its own name, and a dropped stash goes back on the
 * stash list. A file rolled back gets its content back, exactly as it was. A
 * force push cannot be taken back from here, because that would mean pushing
 * again; its old remote tip is offered as a new local branch.
 */
export async function restore(path, id, operationInProgress) {
  const entry = (await readEntries(path)).find((e) => e.id === id);
  if (!entry) throw new GitError('That operation is no longer in the log.', { command: '', stderr: '', code: 1 });
  if ((await resolveRef(path, entry.ref)) === null) {
    throw new GitError('Its recovery point is gone, so it cannot be restored.', { command: '', stderr: '', code: 1 });
  }
  if (operationInProgress) {
    throw new GitError(
      `A ${operationInProgress} is in progress. Continue or abandon it before restoring anything.`,
      { command: '', stderr: '', code: 1 }
    );
  }

  const { kind, name } = entry.target;
  const label = `Restore: ${entry.label}`;

  if (kind === 'branch') {
    const ref = `refs/heads/${name}`;
    const now = await resolveRef(path, ref);
    await record(path, { operation: 'recovery.restore', label, target: entry.target, before: now, after: entry.before });
    if (name === (await currentBranch(path))) {
      await git(path, ['reset', '--keep', entry.before]);
    } else {
      await git(path, ['update-ref', '-m', `gitalia: ${label}`, ref, entry.before]);
    }
    return { ok: true, kind, name, at: entry.before, recreated: now === null };
  }

  if (kind === 'tag') {
    const ref = `refs/tags/${name}`;
    if ((await resolveRef(path, ref)) !== null) {
      throw new GitError(`A tag called ${name} exists again, so the old one was not put back.`, { command: '', stderr: '', code: 1 });
    }
    await git(path, ['update-ref', ref, entry.before]);
    return { ok: true, kind, name, at: entry.before, recreated: true };
  }

  if (kind === 'stash') {
    await git(path, ['stash', 'store', '-m', entry.detail || 'Restored by Gitalia', entry.before]);
    return { ok: true, kind, name, at: entry.before, recreated: true };
  }

  if (kind === 'file') {
    const target = resolve(path, name);
    if (!target.startsWith(resolve(path) + sep)) {
      throw new GitError(`${name} is not inside this repository.`, { command: '', stderr: '', code: 1 });
    }
    // What is there now is saved first, so this restore can be undone too.
    const { stdout: now, code } = await runGit(path, ['hash-object', '-w', '--', name], { allowFailure: true });
    await record(path, { operation: 'recovery.restore', label, target: entry.target, before: code === 0 ? now.trim() : null, after: entry.before });
    const { stdout: content } = await runGit(path, ['cat-file', 'blob', entry.before], { binary: true });
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, content);
    return { ok: true, kind, name, at: entry.before, recreated: code !== 0 };
  }

  if (kind === 'remote') {
    const base = `recovered/${name.replace(/^[^/]+\//, '')}`;
    let branch = base;
    for (let n = 2; (await resolveRef(path, `refs/heads/${branch}`)) !== null; n++) branch = `${base}-${n}`;
    await git(path, ['branch', branch, entry.before]);
    return { ok: true, kind: 'branch', name: branch, at: entry.before, recreated: true };
  }

  throw new GitError('Gitalia does not know how to restore that operation.', { command: '', stderr: '', code: 1 });
}
