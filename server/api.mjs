/**
 * Gitalia RPC surface.
 *
 * Every method is `(args) => Promise<result>`. The frontend never builds a
 * git command line; it calls these names. A Tauri build registers commands
 * with the same names and argument shapes, and the UI is unaffected.
 */
import { git, runGit, resolveRepository, gitVersion, GitError } from './git.mjs';
import { access, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const REBASE_HELPER = join(HERE, 'rebase-helper.mjs');

const US = '\x1f'; // field separator
const RS = '\x1e'; // record separator

const LOG_FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%cn', '%ct', '%D', '%s'].join(US) + RS;

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

/** Which multi-step git operation, if any, is half-finished right now. */
async function detectOperation(root) {
  const g = join(root, '.git');
  if (await exists(join(g, 'rebase-merge'))) return 'rebase';
  if (await exists(join(g, 'rebase-apply'))) return 'rebase';
  if (await exists(join(g, 'MERGE_HEAD'))) return 'merge';
  if (await exists(join(g, 'CHERRY_PICK_HEAD'))) return 'cherry-pick';
  if (await exists(join(g, 'REVERT_HEAD'))) return 'revert';
  if (await exists(join(g, 'BISECT_LOG'))) return 'bisect';
  return null;
}

/** Split `%D` decoration into structured refs attached to a commit. */
function parseRefs(decoration) {
  const refs = [];
  if (!decoration) return refs;
  for (const raw of decoration.split(', ')) {
    const part = raw.trim();
    if (!part) continue;
    if (part.startsWith('tag: ')) {
      refs.push({ kind: 'tag', name: part.slice(5), isHead: false });
    } else if (part.startsWith('HEAD -> ')) {
      refs.push({ kind: 'local', name: part.slice(8), isHead: true });
    } else if (part === 'HEAD') {
      refs.push({ kind: 'head', name: 'HEAD', isHead: true });
    } else if (part.includes('/') && !part.startsWith('refs/')) {
      refs.push({ kind: 'remote', name: part, isHead: false });
    } else {
      refs.push({ kind: 'local', name: part, isHead: false });
    }
  }
  return refs;
}

function parseLog(stdout) {
  const commits = [];
  for (const record of stdout.split(RS)) {
    const line = record.replace(/^\n/, '');
    if (!line.trim()) continue;
    const f = line.split(US);
    if (f.length < 9) continue;
    commits.push({
      hash: f[0],
      shortHash: f[0].slice(0, 7),
      parents: f[1] ? f[1].split(' ').filter(Boolean) : [],
      author: f[2],
      authorEmail: f[3],
      authorDate: Number(f[4]) * 1000,
      committer: f[5],
      commitDate: Number(f[6]) * 1000,
      refs: parseRefs(f[7]),
      subject: f.slice(8).join(US)
    });
  }
  return commits;
}

/** porcelain=v2 is the stable machine format; v1 is ambiguous with odd paths. */
function parseStatus(stdout) {
  const files = [];
  let branch = null, upstream = null, oid = null;
  let ahead = 0, behind = 0, detached = false;

  for (const line of stdout.split('\n')) {
    if (!line) continue;
    if (line.startsWith('# ')) {
      const [, key, ...rest] = line.split(' ');
      const value = rest.join(' ');
      if (key === 'branch.head') { branch = value === '(detached)' ? null : value; detached = value === '(detached)'; }
      else if (key === 'branch.upstream') upstream = value;
      else if (key === 'branch.oid') oid = value === '(initial)' ? null : value;
      else if (key === 'branch.ab') {
        const m = value.match(/\+(\d+)\s+-(\d+)/);
        if (m) { ahead = Number(m[1]); behind = Number(m[2]); }
      }
      continue;
    }
    const type = line[0];
    if (type === '1') {
      const p = line.split(' ');
      files.push({ path: p.slice(8).join(' '), index: p[1][0], worktree: p[1][1], state: 'tracked' });
    } else if (type === '2') {
      const p = line.split(' ');
      const [path, origPath] = p.slice(9).join(' ').split('\t');
      files.push({ path, origPath, index: p[1][0], worktree: p[1][1], state: 'renamed' });
    } else if (type === 'u') {
      const p = line.split(' ');
      files.push({ path: p.slice(10).join(' '), index: p[1][0], worktree: p[1][1], state: 'conflicted' });
    } else if (type === '?') {
      files.push({ path: line.slice(2), index: '?', worktree: '?', state: 'untracked' });
    }
  }
  return { branch, upstream, oid, ahead, behind, detached, files };
}

export const methods = {
  /** Validate a path and return everything needed to render the title bar. */
  async 'repo.open'({ path }) {
    const root = await resolveRepository(path);
    return {
      root,
      name: basename(root),
      gitVersion: await gitVersion()
    };
  },

  async 'repo.status'({ path }) {
    const status = parseStatus(await git(path, ['status', '--porcelain=v2', '--branch']));
    return { ...status, operation: await detectOperation(path) };
  },

  /**
   * `--date-order` keeps a commit below its children without the aggressive
   * reordering `--topo-order` does, which is what makes lanes look stable.
   */
  async 'log.list'({ path, limit = 2000, all = true }) {
    const args = ['log', `--pretty=format:${LOG_FORMAT}`, '--date-order', `--max-count=${limit}`];
    if (all) args.push('--all', 'HEAD');
    const { stdout, code } = await runGit(path, args, { allowFailure: true });
    // An empty repository has no HEAD to log; that is not an error.
    if (code !== 0) return { commits: [], truncated: false };
    const commits = parseLog(stdout);
    return { commits, truncated: commits.length >= limit };
  },

  async 'branches.list'({ path }) {
    const fmt = ['%(refname)', '%(refname:short)', '%(objectname)', '%(upstream:short)',
      '%(upstream:track)', '%(HEAD)', '%(committerdate:unix)'].join(US);
    const out = await git(path, ['for-each-ref', `--format=${fmt}`, 'refs/heads', 'refs/remotes', 'refs/tags']);

    const local = [], remote = [], tags = [];
    for (const line of out.split('\n')) {
      if (!line.trim()) continue;
      const [refname, short, oid, upstream, track, head, date] = line.split(US);
      const m = (track || '').match(/ahead (\d+)|behind (\d+)/g) || [];
      let ahead = 0, behind = 0;
      for (const t of m) {
        if (t.startsWith('ahead')) ahead = Number(t.slice(6));
        if (t.startsWith('behind')) behind = Number(t.slice(7));
      }
      const entry = {
        name: short, refname, oid, upstream: upstream || null,
        ahead, behind, isHead: head === '*', date: Number(date) * 1000
      };
      if (refname.startsWith('refs/heads/')) local.push(entry);
      else if (refname.startsWith('refs/remotes/')) {
        if (short.endsWith('/HEAD')) continue; // symbolic pointer, not a branch
        remote.push(entry);
      } else tags.push(entry);
    }
    const byName = (a, b) => a.name.localeCompare(b.name);
    return { local: local.sort(byName), remote: remote.sort(byName), tags: tags.sort(byName) };
  },

  async 'head.read'({ path }) {
    const { stdout: sym, code } = await runGit(path, ['symbolic-ref', '--short', 'HEAD'], { allowFailure: true });
    const { stdout: oid } = await runGit(path, ['rev-parse', 'HEAD'], { allowFailure: true });
    return {
      branch: code === 0 ? sym.trim() : null,
      detached: code !== 0,
      oid: oid.trim() || null
    };
  },

  async 'remotes.list'({ path }) {
    const out = await git(path, ['remote']);
    return { remotes: out.split('\n').map((s) => s.trim()).filter(Boolean) };
  },

  /** Full body plus per-file stats for the details pane. */
  async 'commit.details'({ path, hash }) {
    const body = await git(path, ['show', '-s', `--pretty=format:%B`, hash]);
    const stat = await git(path, ['show', '--numstat', '--pretty=format:', hash]);
    const files = [];
    for (const line of stat.split('\n')) {
      if (!line.trim()) continue;
      const [added, removed, ...rest] = line.split('\t');
      files.push({
        path: rest.join('\t'),
        added: added === '-' ? null : Number(added),
        removed: removed === '-' ? null : Number(removed),
        binary: added === '-'
      });
    }
    return { body: body.trim(), files };
  },

  async 'branch.checkout'({ path, name }) {
    await git(path, ['checkout', name]);
    return { ok: true };
  },

  async 'branch.create'({ path, name, from, checkout = true }) {
    const args = checkout ? ['checkout', '-b', name] : ['branch', name];
    if (from) args.push(from);
    await git(path, args);
    return { ok: true };
  },

  async 'branch.delete'({ path, name, force = false }) {
    await git(path, ['branch', force ? '-D' : '-d', name]);
    return { ok: true };
  },

  async 'branch.rename'({ path, from, to }) {
    await git(path, ['branch', '-m', from, to]);
    return { ok: true };
  },

  /** Detached checkout of a commit, used from the graph context menu. */
  async 'commit.checkout'({ path, hash }) {
    await git(path, ['checkout', hash]);
    return { ok: true };
  },

  async 'repo.fetch'({ path, remote = null, prune = true }) {
    const args = ['fetch'];
    if (remote) args.push(remote); else args.push('--all');
    if (prune) args.push('--prune');
    const { stderr } = await runGit(path, args);
    return { ok: true, output: stderr.trim() };
  },

  /** Full messages for several commits at once, used to seed a squash. */
  async 'commits.messages'({ path, hashes }) {
    const messages = [];
    for (const hash of hashes) {
      const body = await git(path, ['show', '-s', '--pretty=format:%B', hash]);
      messages.push({ hash, message: body.replace(/\s+$/, '') });
    }
    return { messages };
  },

  /**
   * Answers every question the squash dialog needs to ask, in one call.
   *
   * `hashes` arrives newest first, the same order the graph shows.
   */
  async 'commits.inspectSquash'({ path, hashes }) {
    const problems = [];

    if (!Array.isArray(hashes) || hashes.length < 2) {
      return { ok: false, problems: ['Select at least two commits to squash.'] };
    }

    // Read each commit's parents so contiguity can be checked exactly.
    const parents = new Map();
    for (const hash of hashes) {
      const { stdout, code } = await runGit(path, ['rev-list', '--parents', '-n', '1', hash], { allowFailure: true });
      if (code !== 0) return { ok: false, problems: [`Commit ${hash.slice(0, 7)} no longer exists.`] };
      const ids = stdout.trim().split(' ');
      parents.set(hash, ids.slice(1));
    }

    const merges = hashes.filter((h) => (parents.get(h) ?? []).length > 1);
    if (merges.length > 0) {
      problems.push(
        `The selection contains ${merges.length === 1 ? 'a merge commit' : `${merges.length} merge commits`}. Merge commits cannot be squashed.`
      );
    }

    // Contiguous means each commit's first parent is the next one down.
    for (let i = 0; i < hashes.length - 1; i++) {
      const firstParent = (parents.get(hashes[i]) ?? [])[0];
      if (firstParent !== hashes[i + 1]) {
        problems.push('The selected commits are not next to each other in history. Select a continuous run of commits.');
        break;
      }
    }

    const oldest = hashes[hashes.length - 1];
    const newest = hashes[0];
    const base = (parents.get(oldest) ?? [])[0] ?? null;
    if (!base) {
      problems.push('The oldest selected commit has no parent. The very first commit of a repository cannot be squashed this way.');
    }

    // Everything must be on the current branch, or rebase has nothing to move.
    const { code: ancestor } = await runGit(path, ['merge-base', '--is-ancestor', newest, 'HEAD'], { allowFailure: true });
    if (ancestor !== 0) {
      // Naming the branches that do hold these commits saves the user hunting
      // for them, which matters when a local branch was rebased and its old
      // commits still sit on the remote.
      const { stdout: holders } = await runGit(
        path,
        ['branch', '--all', '--contains', newest, '--format=%(refname:short)'],
        { allowFailure: true }
      );
      const containedIn = holders
        .split('\n')
        .map((r) => r.trim())
        .filter((r) => r && !r.endsWith('/HEAD'));

      problems.push(
        containedIn.length > 0
          ? `These commits are not in the history of the current branch. They are on ${containedIn.join(', ')}. Check out one of those branches first.`
          : 'These commits are not in the history of the current branch, and no branch points at them. They may be left over from a rebase.'
      );
    }

    const status = parseStatus(await git(path, ['status', '--porcelain=v2', '--branch']));
    const dirty = status.files.filter((f) => f.state !== 'untracked').length;
    if (dirty > 0) {
      problems.push(`You have ${dirty} uncommitted ${dirty === 1 ? 'change' : 'changes'}. Commit or stash them before squashing.`);
    }
    if (status.operation) {
      problems.push(`A ${status.operation} is already in progress. Finish or abort it first.`);
    }

    const { stdout: headOid } = await runGit(path, ['rev-parse', 'HEAD'], { allowFailure: true });
    const head = headOid.trim();
    const atHead = head === newest;

    // Commits that would be replayed on top of the squashed result.
    let replayed = 0;
    let replayedMerges = 0;
    if (ancestor === 0 && !atHead) {
      const { stdout: after } = await runGit(path, ['rev-list', '--count', `${newest}..HEAD`], { allowFailure: true });
      replayed = Number(after.trim() || 0);
      const { stdout: afterMerges } = await runGit(path, ['rev-list', '--count', '--merges', `${newest}..HEAD`], { allowFailure: true });
      replayedMerges = Number(afterMerges.trim() || 0);
      if (replayedMerges > 0) {
        problems.push(
          `${replayedMerges} merge ${replayedMerges === 1 ? 'commit sits' : 'commits sit'} between the selection and the branch tip. Squashing would flatten ${replayedMerges === 1 ? 'it' : 'them'}, so Gitalia will not do this.`
        );
      }
    }

    // Warn, but do not block, when the commits are already published.
    const published = [];
    const { stdout: remoteRefs } = await runGit(path, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes'], { allowFailure: true });
    for (const ref of remoteRefs.split('\n').map((r) => r.trim()).filter(Boolean)) {
      if (ref.endsWith('/HEAD')) continue;
      const { code } = await runGit(path, ['merge-base', '--is-ancestor', newest, ref], { allowFailure: true });
      if (code === 0) published.push(ref);
    }

    return {
      ok: problems.length === 0,
      problems,
      base,
      head,
      atHead,
      branch: status.branch,
      count: hashes.length,
      replayed,
      published
    };
  },

  /**
   * Combine the selected commits into one.
   *
   * Two routes. When the selection reaches the branch tip a soft reset is
   * enough, which touches nothing else and cannot conflict. Otherwise Git
   * replays the later commits with a scripted rebase. Squashing never
   * conflicts, because the combined commit leaves the same files behind as
   * the newest commit it replaces.
   */
  async 'commits.squash'({ path, hashes, message }) {
    if (!message || !message.trim()) {
      throw new GitError('A commit message is required.', { command: '', stderr: '', code: 1 });
    }

    const inspection = await methods['commits.inspectSquash']({ path, hashes });
    if (!inspection.ok) {
      throw new GitError(inspection.problems.join('\n'), { command: '', stderr: '', code: 1 });
    }

    const { base, head, atHead } = inspection;
    const text = message.trim() + '\n';

    if (atHead) {
      await git(path, ['reset', '--soft', base]);
      try {
        await git(path, ['commit', '-m', text]);
      } catch (err) {
        // A hook can refuse the commit. Put the branch back where it was.
        await runGit(path, ['reset', '--soft', head], { allowFailure: true });
        throw err;
      }
      const { stdout: created } = await runGit(path, ['rev-parse', 'HEAD'], { allowFailure: true });
      return { ok: true, commit: created.trim(), previousHead: head, replayed: 0 };
    }

    const dir = await mkdtemp(join(tmpdir(), 'gitalia-squash-'));
    const messageFile = join(dir, 'message.txt');
    await writeFile(messageFile, text, 'utf8');

    const editor = `"${process.execPath}" "${REBASE_HELPER}"`;
    const env = {
      GIT_SEQUENCE_EDITOR: `${editor} sequence`,
      GIT_EDITOR: `${editor} message`,
      GITALIA_SQUASH_COUNT: String(hashes.length),
      GITALIA_SQUASH_MESSAGE_FILE: messageFile
    };

    try {
      await runGit(path, ['rebase', '--interactive', base], { env });
    } catch (err) {
      // Leave no half-finished rebase behind.
      await runGit(path, ['rebase', '--abort'], { allowFailure: true });
      throw err;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }

    const { stdout: newHead } = await runGit(path, ['rev-parse', 'HEAD'], { allowFailure: true });
    return { ok: true, commit: newHead.trim(), previousHead: head, replayed: inspection.replayed };
  },

  /**
   * Safety probe used before a destructive branch action: does this branch
   * exist on any remote, and is it merged into HEAD?
   */
  async 'branch.inspect'({ path, name }) {
    const { stdout: merged } = await runGit(path, ['branch', '--merged', 'HEAD', '--format=%(refname:short)'], { allowFailure: true });
    const isMerged = merged.split('\n').map((s) => s.trim()).includes(name);
    const { stdout: remoteRefs } = await runGit(path, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes'], { allowFailure: true });
    const onRemote = remoteRefs.split('\n').map((s) => s.trim()).filter((r) => r.endsWith(`/${name}`));
    const { stdout: count } = await runGit(path, ['rev-list', '--count', `HEAD..${name}`], { allowFailure: true });
    return { isMerged, onRemote, unmergedCommits: Number(count.trim() || 0) };
  }
};

/** Single entry point, mirroring a Tauri `invoke(method, args)` call. */
export async function invokeMethod(method, args = {}) {
  const fn = methods[method];
  if (!fn) throw new GitError(`Unknown method: ${method}`, { command: '', stderr: '', code: 1 });
  return fn(args);
}

export { GitError };
