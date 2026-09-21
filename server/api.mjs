/**
 * Gitalia RPC surface.
 *
 * Every method is `(args) => Promise<result>`. The frontend never builds a
 * git command line; it calls these names. A Tauri build registers commands
 * with the same names and argument shapes, and the UI is unaffected.
 */
import { git, runGit, resolveRepository, gitVersion, GitError } from './git.mjs';
import { readCommitRules, validateMessage } from './commit-rules.mjs';
import { suggestSubject, suggestionProviders } from './suggest.mjs';
import { keyStatus, writeKey } from './settings.mjs';
import { access, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const REBASE_HELPER = join(HERE, 'rebase-helper.mjs');

// Git's empty tree object. Diffing the first commit against it shows every
// file as added, because there is no parent commit to compare with.
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

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

/**
 * porcelain=v2 is the stable machine format; v1 is ambiguous with odd paths.
 *
 * `-z` matters as much as the format does. Without it Git C-quotes any path
 * holding a space, a quote or a non-ASCII byte, so `üñî code.txt` arrives as
 * `"\303\274\303\261\303\256 code.txt"`. Those paths are handed straight back
 * to Git when a commit runs, so they have to survive the round trip intact.
 */
const STATUS_ARGS = [
  'status', '--porcelain=v2', '--branch', '-z',
  // Git collapses an untracked directory into one `?  .idea/` row. The commit
  // panel lists files, not folders, so ask for every one of them.
  '--untracked-files=all'
];

function parseStatus(stdout) {
  const files = [];
  let branch = null, upstream = null, oid = null;
  let ahead = 0, behind = 0, detached = false;

  // -z terminates every record with a NUL, so the last split piece is empty.
  const records = stdout.split('\0');
  if (records[records.length - 1] === '') records.pop();

  for (let i = 0; i < records.length; i++) {
    const line = records[i];
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
      // A rename spends two records: the fields, then the path it came from.
      const p = line.split(' ');
      files.push({
        path: p.slice(9).join(' '),
        origPath: records[++i] ?? undefined,
        index: p[1][0],
        worktree: p[1][1],
        state: 'renamed'
      });
    } else if (type === 'u') {
      const p = line.split(' ');
      files.push({ path: p.slice(10).join(' '), index: p[1][0], worktree: p[1][1], state: 'conflicted' });
    } else if (type === '?') {
      files.push({ path: line.slice(2), index: '?', worktree: '?', state: 'untracked' });
    }
  }
  return { branch, upstream, oid, ahead, behind, detached, files };
}

/**
 * A cap on how much of one file's diff is parsed.
 *
 * A generated file can produce a patch with hundreds of thousands of lines.
 * Nobody reads that, and sending it would stall the page, so the viewer is
 * told the diff was cut short instead.
 */
const MAX_DIFF_LINES = 20000;

/**
 * Turn one file's unified diff into structured hunks.
 *
 * Only the parts the viewer draws are kept. Git's own headers carry the same
 * paths that were passed in, so they are read for the file's status and then
 * thrown away.
 */
function parseFileDiff(patch) {
  const hunks = [];
  let status = 'modified';
  let binary = false;
  let truncated = false;
  let added = 0, removed = 0;
  let hunk = null;
  let oldNumber = 0, newNumber = 0;
  let total = 0;

  for (const line of patch.split('\n')) {
    if (line.startsWith('new file mode')) { status = 'added'; continue; }
    if (line.startsWith('deleted file mode')) { status = 'deleted'; continue; }
    if (line.startsWith('rename from') || line.startsWith('rename to')) { status = 'renamed'; continue; }
    if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) { binary = true; continue; }

    if (line.startsWith('@@')) {
      // @@ -oldStart,oldLines +newStart,newLines @@ optional context
      const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/);
      if (!m) continue;
      oldNumber = Number(m[1]);
      newNumber = Number(m[3]);
      hunk = {
        oldStart: oldNumber,
        oldLines: m[2] === undefined ? 1 : Number(m[2]),
        newStart: newNumber,
        newLines: m[4] === undefined ? 1 : Number(m[4]),
        heading: m[5] ?? '',
        lines: []
      };
      hunks.push(hunk);
      continue;
    }

    if (!hunk) continue; // still in the header

    if (total >= MAX_DIFF_LINES) { truncated = true; break; }

    const marker = line[0];
    if (marker === '+') {
      hunk.lines.push({ kind: 'add', oldNumber: null, newNumber: newNumber++, text: line.slice(1) });
      added++; total++;
    } else if (marker === '-') {
      hunk.lines.push({ kind: 'del', oldNumber: oldNumber++, newNumber: null, text: line.slice(1) });
      removed++; total++;
    } else if (marker === ' ') {
      hunk.lines.push({ kind: 'context', oldNumber: oldNumber++, newNumber: newNumber++, text: line.slice(1) });
      total++;
    } else if (marker === '\\') {
      // "\ No newline at end of file" describes the line above it.
      const last = hunk.lines[hunk.lines.length - 1];
      if (last) last.noNewline = true;
    }
  }

  if (truncated) {
    // A half-read hunk would draw with wrong line numbers below the cut.
    const last = hunks[hunks.length - 1];
    if (last && last.lines.length === 0) hunks.pop();
  }

  return { status, binary, truncated, added, removed, hunks };
}

/**
 * Make sure a stash reference still points at the change the user chose.
 *
 * `stash@{1}` is a position, not an identity. Dropping `stash@{0}` renumbers
 * everything below it, so a screen read a moment ago can name the wrong one.
 */
async function verifyStash(path, ref, sha) {
  if (!sha) return;
  const { stdout, code } = await runGit(path, ['rev-parse', ref], { allowFailure: true });
  if (code !== 0 || stdout.trim() !== sha) {
    throw new GitError(
      'The shelf has changed since this list was read. Refresh and try again.',
      { command: `git rev-parse ${ref}`, stderr: '', code: 1 }
    );
  }
}


/** True when the repository has no commits yet, so there is nothing to log. */
async function isUnbornHead(path) {
  const { code } = await runGit(path, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true });
  return code !== 0;
}

/**
 * Remote branches that already contain `commit`, so rewriting it would need a
 * force push.
 *
 * The remote-tracking refs under refs/remotes only move when something
 * fetches, so asking them straight away can report "not published" about a
 * commit that was pushed from another window, another tool, or the terminal.
 * A quiet fetch first costs a moment and is what makes the answer true; when
 * it fails (offline, no permission) the stale refs are still worth reading, so
 * the check carries on rather than claiming the commit is unpublished.
 */
async function publishedOn(path, commit) {
  if (!commit) return [];

  await runGit(path, ['fetch', '--all', '--quiet'], { allowFailure: true });

  // Both forms are read because refs/remotes/origin/HEAD shortens to plain
  // "origin", which no test on the short name can tell apart from a branch.
  // It is a symbolic pointer at another ref in this list, so listing it would
  // name the same remote twice.
  const published = [];
  const { stdout: remoteRefs } = await runGit(
    path,
    ['for-each-ref', '--format=%(refname:short)%09%(refname)', 'refs/remotes'],
    { allowFailure: true }
  );
  for (const line of remoteRefs.split('\n').map((r) => r.trim()).filter(Boolean)) {
    const [short, full] = line.split('\t');
    if (!short || !full || full.endsWith('/HEAD')) continue;
    const { code } = await runGit(path, ['merge-base', '--is-ancestor', commit, short], { allowFailure: true });
    if (code === 0) published.push(short);
  }
  return published;
}

/* ---------------------------------------------------------------- Statistics

   The Stats report is read-only: it runs `git log` and counts. Nothing here
   writes to the repository, so a report can never cost the user their work.
*/

const STATS_FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%cn', '%ce', '%ct', '%s'].join(US) + RS;

/** An hour of the day and a day of the week, in the repository reader's zone. */
function clockOf(ms) {
  const d = new Date(ms);
  return { hour: d.getHours(), weekday: d.getDay() };
}

/** The `YYYY-MM-DD` key a timestamp belongs to, in local time. */
function dayKey(ms) {
  const d = new Date(ms);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The `YYYY-MM` key a timestamp belongs to, in local time. */
function monthKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Split `git log --numstat -z` into commits and their file rows.
 *
 * The `-z` form is awkward but it is the only safe one: without it Git quotes
 * and escapes any path holding a space or a non-ASCII byte, and renames come
 * back as the unusable string "old.txt => new.txt". With it a rename leaves
 * the path field empty and spends the next two records on the old name and
 * the new one, the same shape `commit.details` already handles.
 *
 * Commit headers end with RS while numstat rows are NUL-separated, so one
 * record can hold the tail of a commit's last file row and the header of the
 * next commit at once. Flattening to a single record list first keeps that
 * from needing a special case.
 */
function parseStatsLog(stdout) {
  // Flatten to one list: every header its own entry, every file row its own.
  const records = [];
  for (const chunk of stdout.split('\0')) {
    if (!chunk) continue;
    const pieces = chunk.split(RS);
    for (let i = 0; i < pieces.length; i++) {
      const text = pieces[i].replace(/^\n+/, '');
      // Everything before an RS is a commit header; the last piece is a row.
      if (text) records.push({ header: i < pieces.length - 1, text });
    }
  }

  const commits = [];
  let current = null;

  for (let i = 0; i < records.length; i++) {
    const record = records[i];

    if (record.header) {
      const f = record.text.split(US);
      if (f.length < 9) continue;
      current = {
        hash: f[0],
        parents: f[1] ? f[1].split(' ').filter(Boolean) : [],
        author: f[2],
        authorEmail: f[3],
        authorDate: Number(f[4]) * 1000,
        committer: f[5],
        committerEmail: f[6],
        commitDate: Number(f[7]) * 1000,
        subject: f.slice(8).join(US),
        files: []
      };
      commits.push(current);
      continue;
    }

    if (!current) continue;
    const [added, removed, ...tail] = record.text.split('\t');
    const inline = tail.join('\t');
    // An empty path means a rename: the next two records are the old and new
    // names. Only the new name is counted, so the old one is read and dropped.
    const renamed = inline === '';
    const origPath = renamed ? records[++i]?.text ?? null : null;
    const filePath = renamed ? records[++i]?.text ?? null : inline;
    if (!filePath) continue;
    current.files.push({
      path: filePath,
      origPath,
      added: added === '-' ? null : Number(added),
      removed: removed === '-' ? null : Number(removed),
      binary: added === '-'
    });
  }

  return commits;
}

/** The identity a commit is counted under: email, lowercased. */
function identityOf(commit) {
  const email = (commit.authorEmail || '').trim().toLowerCase();
  return email || `name:${(commit.author || 'unknown').trim().toLowerCase()}`;
}

function emptyReport(limit) {
  return {
    generatedAt: Date.now(),
    limit,
    truncated: false,
    totals: {
      commits: 0, authors: 0, added: 0, removed: 0, filesTouched: 0,
      merges: 0, firstCommit: null, lastCommit: null, activeDays: 0
    },
    authors: [],
    days: [],
    months: [],
    hours: Array.from({ length: 24 }, () => 0),
    weekdays: Array.from({ length: 7 }, () => 0),
    files: [],
    extensions: [],
    recent: []
  };
}

/** Turn the parsed log into every number the report shows. */
function buildReport(commits, limit) {
  if (commits.length === 0) return emptyReport(limit);

  const report = emptyReport(limit);
  report.truncated = commits.length >= limit;

  const authors = new Map();
  const days = new Map();
  const months = new Map();
  const files = new Map();
  const extensions = new Map();
  const touched = new Set();

  let added = 0, removed = 0, merges = 0;
  let first = Infinity, last = -Infinity;

  for (const commit of commits) {
    // Commit date, not author date, and deliberately so: `--since` and
    // `--until` filter on the commit date, so counting by anything else would
    // put commits in the report that fall outside the period it claims to
    // cover. A rebase rewrites the commit date and keeps the author date, so
    // the two genuinely disagree, and only one of them can match the filter.
    const when = commit.commitDate;
    const isMerge = commit.parents.length > 1;
    if (isMerge) merges++;
    if (when < first) first = when;
    if (when > last) last = when;

    const { hour, weekday } = clockOf(when);
    report.hours[hour]++;
    report.weekdays[weekday]++;

    let commitAdded = 0, commitRemoved = 0;
    for (const file of commit.files) {
      if (file.binary) continue;
      commitAdded += file.added ?? 0;
      commitRemoved += file.removed ?? 0;

      touched.add(file.path);
      const stat = files.get(file.path) ?? { path: file.path, commits: 0, added: 0, removed: 0, authors: new Set(), last: 0 };
      stat.commits++;
      stat.added += file.added ?? 0;
      stat.removed += file.removed ?? 0;
      stat.authors.add(identityOf(commit));
      if (when > stat.last) stat.last = when;
      files.set(file.path, stat);

      const dot = file.path.lastIndexOf('.');
      const slash = file.path.lastIndexOf('/');
      const ext = dot > slash + 1 ? file.path.slice(dot + 1).toLowerCase() : '(none)';
      const bucket = extensions.get(ext) ?? { ext, files: new Set(), added: 0, removed: 0 };
      bucket.files.add(file.path);
      bucket.added += file.added ?? 0;
      bucket.removed += file.removed ?? 0;
      extensions.set(ext, bucket);
    }
    added += commitAdded;
    removed += commitRemoved;

    const key = identityOf(commit);
    const author = authors.get(key) ?? {
      key, name: commit.author, email: commit.authorEmail,
      names: new Set(), commits: 0, merges: 0, added: 0, removed: 0,
      files: new Set(), first: when, last: when, days: new Set(),
      hours: Array.from({ length: 24 }, () => 0),
      weekdays: Array.from({ length: 7 }, () => 0)
    };
    author.names.add(commit.author);
    author.commits++;
    if (isMerge) author.merges++;
    author.added += commitAdded;
    author.removed += commitRemoved;
    // Binary files are left out of `filesTouched`, so they are left out here
    // too: otherwise one contributor's file count can exceed the repository
    // total it is meant to be a share of.
    for (const file of commit.files) if (!file.binary) author.files.add(file.path);
    if (when < author.first) author.first = when;
    if (when > author.last) { author.last = when; author.name = commit.author; }
    author.days.add(dayKey(when));
    author.hours[hour]++;
    author.weekdays[weekday]++;
    authors.set(key, author);

    const dk = dayKey(when);
    const day = days.get(dk) ?? { date: dk, commits: 0, added: 0, removed: 0, authors: new Set() };
    day.commits++;
    day.added += commitAdded;
    day.removed += commitRemoved;
    day.authors.add(key);
    days.set(dk, day);

    const mk = monthKey(when);
    const month = months.get(mk) ?? { month: mk, commits: 0, added: 0, removed: 0, authors: new Set() };
    month.commits++;
    month.added += commitAdded;
    month.removed += commitRemoved;
    month.authors.add(key);
    months.set(mk, month);
  }

  report.totals = {
    commits: commits.length,
    authors: authors.size,
    added,
    removed,
    filesTouched: touched.size,
    merges,
    firstCommit: first === Infinity ? null : first,
    lastCommit: last === -Infinity ? null : last,
    activeDays: days.size
  };

  report.authors = [...authors.values()]
    .map((a) => ({
      key: a.key,
      name: a.name,
      email: a.email,
      /** Every spelling of the name seen for this address, so aliases show. */
      aliases: [...a.names].filter((n) => n !== a.name),
      commits: a.commits,
      merges: a.merges,
      added: a.added,
      removed: a.removed,
      files: a.files.size,
      first: a.first,
      last: a.last,
      activeDays: a.days.size,
      hours: a.hours,
      weekdays: a.weekdays
    }))
    .sort((x, y) => y.commits - x.commits);

  report.days = [...days.values()]
    .map((d) => ({ date: d.date, commits: d.commits, added: d.added, removed: d.removed, authors: d.authors.size }))
    .sort((a, b) => a.date.localeCompare(b.date));

  report.months = [...months.values()]
    .map((m) => ({ month: m.month, commits: m.commits, added: m.added, removed: m.removed, authors: m.authors.size }))
    .sort((a, b) => a.month.localeCompare(b.month));

  report.files = [...files.values()]
    .map((f) => ({ path: f.path, commits: f.commits, added: f.added, removed: f.removed, authors: f.authors.size, last: f.last }))
    .sort((a, b) => b.commits - a.commits)
    .slice(0, 50);

  report.extensions = [...extensions.values()]
    .map((e) => ({ ext: e.ext, files: e.files.size, added: e.added, removed: e.removed }))
    .sort((a, b) => b.added + b.removed - (a.added + a.removed))
    .slice(0, 15);

  report.recent = commits.slice(0, 12).map((c) => ({
    hash: c.hash,
    shortHash: c.hash.slice(0, 7),
    author: c.author,
    authorEmail: c.authorEmail,
    date: c.commitDate,
    subject: c.subject,
    added: c.files.reduce((n, f) => n + (f.added ?? 0), 0),
    removed: c.files.reduce((n, f) => n + (f.removed ?? 0), 0),
    files: c.files.length
  }));

  return report;
}

/**
 * The branch a push acts on: the one named, or the checked-out one.
 *
 * A branch can be pushed without being checked out, so every push path takes
 * an optional name. Without one, HEAD has to be on a branch, because a
 * detached HEAD names nothing the remote could hold.
 */
async function pushTarget(path, branch) {
  if (branch) {
    const { code } = await runGit(path, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { allowFailure: true });
    if (code !== 0) {
      throw new GitError(`There is no local branch called ${branch}.`, { command: '', stderr: '', code: 1 });
    }
    return branch;
  }
  const { stdout, code } = await runGit(path, ['symbolic-ref', '--short', 'HEAD'], { allowFailure: true });
  if (code !== 0) {
    throw new GitError(
      'HEAD is detached, so there is no branch to push. Create a branch here first.',
      { command: '', stderr: '', code: 1 }
    );
  }
  return stdout.trim();
}

export const methods = {
  /** Validate a path and return everything needed to render the title bar. */
  async 'repo.open'({ path }) {
    const root = await resolveRepository(path);
    return {
      root,
      name: basename(root),
      gitVersion: await gitVersion(),
      commitRules: await readCommitRules(root)
    };
  },

  /**
   * Re-read the commit rules. The config is part of the working tree, so it
   * can arrive with a branch switch or a pull after the repository was opened.
   */
  async 'repo.commitRules'({ path }) {
    return readCommitRules(path);
  },

  async 'repo.status'({ path }) {
    const status = parseStatus(await git(path, STATUS_ARGS));
    return { ...status, operation: await detectOperation(path) };
  },

  /**
   * `--date-order` keeps a commit below its children without the aggressive
   * reordering `--topo-order` does, which is what makes lanes look stable.
   */
  async 'log.list'({ path, limit = 2000, all = true, refs = null }) {
    const args = ['log', `--pretty=format:${LOG_FORMAT}`, '--date-order', `--max-count=${limit}`];
    const scoped = Array.isArray(refs) ? refs.filter((ref) => typeof ref === 'string' && ref.trim()) : [];
    if (scoped.length > 0) {
      // Only what is reachable from these refs, so the graph shows the history
      // of the branch the user picked rather than every branch in the repo.
      args.push(...scoped, '--');
    } else if (all) {
      // `--all` sweeps in everything under refs/, and that includes refs/stash.
      // A shelved change would then appear in the graph as two commits nobody
      // asked for, so it is excluded. `--exclude` only applies to the `--all`
      // that follows it.
      args.push('--exclude=refs/stash', '--all', 'HEAD');
    }
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

  /**
   * Full body plus per-file stats for the details pane.
   *
   * `-z` is needed for the same reason as in `git status`: without it a path
   * holding a space or a non-ASCII byte comes back quoted and escaped. It also
   * settles renames, which `--numstat` otherwise writes as the single
   * unusable string "old.txt => new.txt".
   */
  async 'commit.details'({ path, hash }) {
    const body = await git(path, ['show', '-s', `--pretty=format:%B`, hash]);
    const stat = await git(path, ['-c', 'core.quotepath=false', 'show', '--numstat', '-z', '--pretty=format:', hash]);

    const records = stat.split('\0');
    if (records[records.length - 1] === '') records.pop();

    const files = [];
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      if (!record.trim()) continue;
      const [added, removed, ...rest] = record.split('\t');
      // A rename leaves the path field empty and spends the next two records
      // on the old name and the new one.
      const inline = rest.join('\t');
      const renamed = inline === '';
      const origPath = renamed ? records[++i] : null;
      const filePath = renamed ? records[++i] : inline;
      files.push({
        path: filePath,
        origPath,
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

    const status = parseStatus(await git(path, STATUS_ARGS));
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
    //
    // The question is asked of the OLDEST selected commit, not the newest: a
    // squash rewrites history from there upwards, so any remote holding the
    // oldest one is affected even when the tip of the selection is local-only.
    const published = await publishedOn(path, oldest);

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
   * Everything the Stats report shows, from one pass over the log.
   *
   * A report is only as trustworthy as the question it answers, so the whole
   * of it comes from a single `git log` run against one range with one set of
   * filters. Aggregating several separate runs would let the headline numbers
   * and the per-author numbers drift apart whenever a commit landed between
   * them, and a report that contradicts itself is worse than no report.
   *
   * `--numstat` costs a diff per commit, which is the expensive part. `limit`
   * caps it, and the result says when it bit, so the UI can admit the report
   * is partial rather than quietly under-reporting.
   */
  async 'stats.report'({
    path,
    since = null,
    until = null,
    refs = null,
    limit = 20000,
    includeMerges = false,
    excludePaths = []
  }) {
    const args = [
      '-c', 'core.quotepath=false',
      'log', `--pretty=format:${STATS_FORMAT}`, '--numstat', '-z',
      '--date-order', `--max-count=${limit}`
    ];
    // A merge contributes no lines, and that is deliberate.
    //
    // `--numstat` prints no file rows for a merge unless it is given `-m`,
    // which emits one diff per parent and so counts the same lines twice, or
    // `--first-parent`, which stops the walk following side branches and drops
    // both the commits and the contributors that live on them. A report that
    // loses people when a filter is switched on is worse than one that counts
    // a merge as carrying no changes of its own, which is what a merge is. So
    // an included merge is counted as a commit and nothing more, and the
    // report says so.
    if (!includeMerges) args.push('--no-merges');
    if (since) args.push(`--since=${since}`);
    if (until) args.push(`--until=${until}`);

    const scoped = Array.isArray(refs) ? refs.filter((r) => typeof r === 'string' && r.trim()) : [];
    if (scoped.length > 0) args.push(...scoped);
    else args.push('--exclude=refs/stash', '--all', 'HEAD');

    // Pathspec exclusions keep generated files (lockfiles, bundles, vendored
    // trees) from drowning out hand-written work in the line counts.
    const excludes = Array.isArray(excludePaths)
      ? excludePaths.filter((p) => typeof p === 'string' && p.trim())
      : [];
    args.push('--');
    for (const p of excludes) args.push(`:(exclude,glob)${p.trim()}`);

    const { stdout, stderr, code } = await runGit(path, args, { allowFailure: true });
    if (code !== 0) {
      // A repository with no commits yet has no HEAD to log, and an empty
      // report is the honest answer. Anything else -- a ref that was deleted
      // while the panel still offered it, a bad pathspec -- is a real failure,
      // and reporting it as "no commits in this period" would hand the user a
      // wrong answer wearing the clothes of a right one.
      const unborn = await isUnbornHead(path);
      if (unborn) return emptyReport(limit);
      throw new GitError(
        (stderr || '').trim() || 'The history could not be read.',
        { command: `git ${args.join(' ')}`, stderr: (stderr || '').trim(), code }
      );
    }

    return buildReport(parseStatsLog(stdout), limit);
  },

  /**
   * The shelf.
   *
   * Shelving is Git's stash. Keeping the IntelliJ IDEA name for the action and
   * Git's own mechanism underneath means a shelf made here is a stash like any
   * other: `git stash list` shows it, and the command line can reach it.
   */
  async 'stash.list'({ path }) {
    const fmt = ['%gd', '%H', '%ct', '%gs'].join(US);
    const { stdout, code } = await runGit(path, ['stash', 'list', `--format=${fmt}`], { allowFailure: true });
    if (code !== 0) return { stashes: [] };

    const stashes = [];
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      const [ref, sha, date, subject] = line.split(US);
      // Git writes "On <branch>: <message>", or "WIP on <branch>: ..." when
      // no message was given.
      const match = (subject ?? '').match(/^(?:WIP on|On) ([^:]+): ?(.*)$/);
      // Three parents means Git also put untracked files in this stash.
      const { stdout: ids } = await runGit(path, ['rev-list', '--parents', '-n', '1', sha], { allowFailure: true });
      stashes.push({
        ref,
        sha,
        date: Number(date) * 1000,
        branch: match ? match[1] : null,
        message: match ? match[2] : (subject ?? ''),
        hasUntracked: ids.trim().split(' ').length > 3
      });
    }
    return { stashes };
  },

  /** The files one shelved change holds. */
  async 'stash.files'({ path, ref }) {
    const files = [];

    const read = async (args, untracked) => {
      const { stdout } = await runGit(path, args, { allowFailure: true });
      const records = stdout.split('\0');
      if (records[records.length - 1] === '') records.pop();
      for (let i = 0; i < records.length; i++) {
        if (!records[i].trim()) continue;
        const [added, removed, ...rest] = records[i].split('\t');
        const inline = rest.join('\t');
        const renamed = inline === '';
        const origPath = renamed ? records[++i] : null;
        const filePath = renamed ? records[++i] : inline;
        files.push({
          path: filePath,
          origPath,
          added: added === '-' ? null : Number(added),
          removed: removed === '-' ? null : Number(removed),
          binary: added === '-',
          untracked
        });
      }
    };

    await read(['-c', 'core.quotepath=false', 'stash', 'show', '--numstat', '-z', ref], false);

    // Untracked files are kept in a third parent of the stash commit, which
    // `git stash show` leaves out unless asked.
    const { stdout: ids } = await runGit(path, ['rev-list', '--parents', '-n', '1', ref], { allowFailure: true });
    if (ids.trim().split(' ').length > 3) {
      await read(
        ['-c', 'core.quotepath=false', 'diff', '--numstat', '-z', EMPTY_TREE, `${ref}^3`],
        true
      );
    }

    return { files };
  },

  /**
   * Put the chosen files on the shelf and take them out of the working tree.
   *
   * A pathspec keeps this to the files the user ticked, so the rest of their
   * work stays where it is.
   */
  async 'stash.create'({ path, message, paths, includeUntracked = false }) {
    const args = ['stash', 'push'];
    if (includeUntracked) args.push('--include-untracked');
    if (message && message.trim()) args.push('-m', message.trim());
    if (Array.isArray(paths) && paths.length > 0) args.push('--', ...paths);

    const { stdout, stderr } = await runGit(path, args);
    const output = `${stdout}${stderr}`;
    // Git says this rather than failing, so it has to be read from the output.
    if (/No local changes to save/i.test(output)) {
      return { ok: false, empty: true };
    }

    const { stdout: sha } = await runGit(path, ['rev-parse', 'stash@{0}'], { allowFailure: true });
    return { ok: true, empty: false, ref: 'stash@{0}', sha: sha.trim() };
  },

  /**
   * Take a shelved change back into the working tree.
   *
   * `sha` is checked against the ref first. Stash references shift whenever
   * one is removed, so acting on a stale `stash@{2}` would reach the wrong
   * change entirely.
   */
  async 'stash.apply'({ path, ref, sha, drop = false }) {
    await verifyStash(path, ref, sha);

    const { stderr, stdout, code } = await runGit(path, ['stash', 'apply', ref], { allowFailure: true });
    const conflicted = /conflict/i.test(`${stdout}${stderr}`) || code !== 0;

    if (conflicted) {
      const status = parseStatus(await git(path, STATUS_ARGS));
      const unmerged = status.files.filter((f) => f.state === 'conflicted');
      if (unmerged.length === 0 && code !== 0) {
        throw new GitError((stderr || stdout).trim() || 'The shelved change could not be applied.', {
          command: `git stash apply ${ref}`, stderr, code
        });
      }
      // Git keeps the stash when applying it conflicts, which is what makes
      // it safe to resolve: the shelved copy is still there to fall back on.
      return { ok: true, conflicted: true, dropped: false, conflicts: unmerged.length };
    }

    if (drop) await git(path, ['stash', 'drop', ref]);
    return { ok: true, conflicted: false, dropped: drop, conflicts: 0 };
  },

  async 'stash.drop'({ path, ref, sha }) {
    await verifyStash(path, ref, sha);
    await git(path, ['stash', 'drop', ref]);
    return { ok: true };
  },

  /**
   * Everything the cherry-pick and revert dialogs need to ask, in one call.
   *
   * `hashes` arrives newest first, the order the graph shows.
   */
  async 'commits.inspectApply'({ path, hashes, mode }) {
    const problems = [];
    const warnings = [];

    if (!Array.isArray(hashes) || hashes.length === 0) {
      return { ok: false, problems: ['Select at least one commit.'] };
    }

    const commits = [];
    for (const hash of hashes) {
      const { stdout, code } = await runGit(path, ['rev-list', '--parents', '-n', '1', hash], { allowFailure: true });
      if (code !== 0) return { ok: false, problems: [`Commit ${hash.slice(0, 7)} no longer exists.`] };
      const ids = stdout.trim().split(' ');
      const { stdout: subject } = await runGit(path, ['show', '-s', '--pretty=format:%s', hash], { allowFailure: true });
      const { code: present } = await runGit(path, ['merge-base', '--is-ancestor', hash, 'HEAD'], { allowFailure: true });
      commits.push({
        hash,
        shortHash: hash.slice(0, 7),
        subject: subject.trim(),
        parents: ids.slice(1),
        isMerge: ids.length > 2,
        inHistory: present === 0
      });
    }

    const status = parseStatus(await git(path, STATUS_ARGS));
    const operation = await detectOperation(path);
    const dirty = status.files.filter((f) => f.state !== 'untracked').length;

    if (operation) {
      problems.push(`A ${operation} is already in progress. Finish or abort it first.`);
    }
    if (dirty > 0) {
      // Both commands merge into the working tree, and Git refuses to start
      // when that would overwrite a change the user has not committed.
      problems.push(
        `You have ${dirty} uncommitted ${dirty === 1 ? 'change' : 'changes'}. Commit or stash them first.`
      );
    }

    const merges = commits.filter((c) => c.isMerge);
    if (merges.length > 0 && mode === 'cherry-pick') {
      problems.push(
        `${merges.length === 1 ? 'A merge commit is' : `${merges.length} merge commits are`} selected. Copying a merge needs a side of it to be chosen, which Gitalia cannot do yet.`
      );
    }

    if (mode === 'cherry-pick') {
      const already = commits.filter((c) => c.inHistory);
      if (already.length > 0) {
        warnings.push(
          `${already.length === 1 ? 'This commit is' : `${already.length} of these commits are`} already in the history of this branch. Copying again would repeat the change.`
        );
      }
    } else {
      const absent = commits.filter((c) => !c.inHistory);
      if (absent.length > 0) {
        warnings.push(
          `${absent.length === 1 ? 'This commit is' : `${absent.length} of these commits are`} not in the history of this branch, so there is nothing here to undo.`
        );
      }
    }

    return {
      ok: problems.length === 0,
      problems,
      warnings,
      commits,
      branch: status.branch,
      detached: status.detached,
      dirty,
      operation
    };
  },

  /**
   * Copy commits onto the current branch.
   *
   * `hashes` arrives newest first and is applied oldest first, so the commits
   * land in the order they were originally written.
   */
  async 'commits.cherryPick'({ path, hashes }) {
    const order = [...hashes].reverse();
    const { stdout: before } = await runGit(path, ['rev-parse', 'HEAD'], { allowFailure: true });
    try {
      await git(path, ['cherry-pick', ...order]);
    } catch (err) {
      // A conflict leaves the operation open on purpose: the user resolves it
      // and continues. The panel and the status bar both say it is running.
      const operation = await detectOperation(path);
      if (operation) return { ok: false, conflicted: true, operation, previousHead: before.trim() };
      throw err;
    }
    const { stdout: after } = await runGit(path, ['rev-parse', 'HEAD'], { allowFailure: true });
    return { ok: true, conflicted: false, applied: order.length, previousHead: before.trim(), head: after.trim() };
  },

  /**
   * Undo commits with new commits that reverse them.
   *
   * Applied newest first, which is the order that works: undoing an older
   * change before a newer one built on it would conflict.
   */
  async 'commits.revert'({ path, hashes, mainline = 1 }) {
    const { stdout: before } = await runGit(path, ['rev-parse', 'HEAD'], { allowFailure: true });
    const args = ['revert', '--no-edit'];
    // A merge has two sides, so Git needs to be told which one to keep. The
    // first parent is the branch the merge was made on.
    for (const hash of hashes) {
      const { stdout: ids } = await runGit(path, ['rev-list', '--parents', '-n', '1', hash], { allowFailure: true });
      if (ids.trim().split(' ').length > 2) args.push('-m', String(mainline));
      break;
    }
    try {
      await git(path, [...args, ...hashes]);
    } catch (err) {
      const operation = await detectOperation(path);
      if (operation) return { ok: false, conflicted: true, operation, previousHead: before.trim() };
      throw err;
    }
    const { stdout: after } = await runGit(path, ['rev-parse', 'HEAD'], { allowFailure: true });
    return { ok: true, conflicted: false, applied: hashes.length, previousHead: before.trim(), head: after.trim() };
  },

  /**
   * What a reset would cost, so the dialog can state it before anything moves.
   */
  async 'branch.inspectReset'({ path, target }) {
    const { stdout: resolved, code } = await runGit(path, ['rev-parse', '--verify', `${target}^{commit}`], { allowFailure: true });
    if (code !== 0) return { ok: false, problems: [`Cannot find ${target}.`] };
    const oid = resolved.trim();

    const { stdout: head } = await runGit(path, ['rev-parse', 'HEAD'], { allowFailure: true });
    const { stdout: dropped } = await runGit(path, ['rev-list', '--count', `${oid}..HEAD`], { allowFailure: true });
    const { stdout: gained } = await runGit(path, ['rev-list', '--count', `HEAD..${oid}`], { allowFailure: true });

    const status = parseStatus(await git(path, STATUS_ARGS));
    const operation = await detectOperation(path);

    // Commits that also sit on a remote are recoverable from there, which
    // changes how alarming the dialog needs to be.
    const published = Number(dropped.trim()) > 0 ? await publishedOn(path, head.trim()) : [];

    return {
      ok: !operation,
      problems: operation ? [`A ${operation} is in progress. Finish or abort it first.`] : [],
      target: oid,
      head: head.trim(),
      dropped: Number(dropped.trim() || 0),
      gained: Number(gained.trim() || 0),
      dirty: status.files.filter((f) => f.state !== 'untracked').length,
      untracked: status.files.filter((f) => f.state === 'untracked').length,
      branch: status.branch,
      detached: status.detached,
      published
    };
  },

  async 'branch.reset'({ path, target, mode = 'mixed' }) {
    const allowed = ['soft', 'mixed', 'hard'];
    if (!allowed.includes(mode)) {
      throw new GitError(`Unknown reset mode: ${mode}`, { command: '', stderr: '', code: 1 });
    }
    const { stdout: before } = await runGit(path, ['rev-parse', 'HEAD'], { allowFailure: true });
    await git(path, ['reset', `--${mode}`, target]);
    const { stdout: after } = await runGit(path, ['rev-parse', 'HEAD'], { allowFailure: true });
    return { ok: true, previousHead: before.trim(), head: after.trim(), mode };
  },

  /** Abandon the half-finished operation and put the branch back. */
  async 'repo.abortOperation'({ path }) {
    const operation = await detectOperation(path);
    if (!operation) return { ok: true, operation: null };
    const command = {
      rebase: ['rebase', '--abort'],
      merge: ['merge', '--abort'],
      'cherry-pick': ['cherry-pick', '--abort'],
      revert: ['revert', '--abort'],
      bisect: ['bisect', 'reset']
    }[operation];
    await git(path, command);
    return { ok: true, operation };
  },

  /**
   * Carry on once the conflicts are resolved.
   *
   * A merge has no continue of its own: resolving it and committing is what
   * finishes it. `GIT_EDITOR=true` keeps Git from trying to open an editor
   * for the message it already has.
   */
  async 'repo.continueOperation'({ path }) {
    const operation = await detectOperation(path);
    if (!operation) return { ok: true, operation: null };

    const status = parseStatus(await git(path, STATUS_ARGS));
    const unresolved = status.files.filter((f) => f.state === 'conflicted');
    if (unresolved.length > 0) {
      throw new GitError(
        `${unresolved.length} ${unresolved.length === 1 ? 'file still has' : 'files still have'} conflicts:\n  ${unresolved.map((f) => f.path).join('\n  ')}\n\nResolve them, then continue.`,
        { command: '', stderr: '', code: 1 }
      );
    }

    const command = {
      rebase: ['rebase', '--continue'],
      merge: ['commit', '--no-edit'],
      'cherry-pick': ['cherry-pick', '--continue'],
      revert: ['revert', '--continue'],
      bisect: ['bisect', 'reset']
    }[operation];
    await git(path, command, { env: { GIT_EDITOR: 'true' } });
    return { ok: true, operation, finished: (await detectOperation(path)) === null };
  },

  /**
   * The diff of one file, either as it sits in the working tree or as one
   * commit changed it.
   *
   * `hash` picks which: leave it out for the working tree (what the commit
   * panel would commit, so HEAD is the comparison), or name a commit to see
   * what that commit did to the file.
   */
  async 'diff.file'({ path, file, origPath = null, hash = null, base = null, context = 3 }) {
    if (!file) throw new GitError('No file was given.', { command: '', stderr: '', code: 1 });

    // core.quotepath escapes non-ASCII paths in the patch headers. The status
    // of the file is read from those headers, so keep them readable.
    const common = ['-c', 'core.quotepath=false', 'diff', `--unified=${context}`, '--find-renames'];
    let args;
    let untracked = false;

    if (hash && base) {
      // Both sides named outright. A shelved change needs this: its content
      // sits between two revisions that are not parent and child.
      args = [...common, base, hash, '--', ...(origPath ? [file, origPath] : [file])];
    } else if (hash) {
      const { stdout: ids } = await runGit(path, ['rev-list', '--parents', '-n', '1', hash], { allowFailure: true });
      const parents = ids.trim().split(' ').slice(1);
      // Naming only the new path would hide the rename from Git's detection,
      // and the file would read as newly added with its history cut off.
      const paths = origPath ? [file, origPath] : [file];
      args = parents.length === 0
        // The first commit has no parent, so compare against the empty tree.
        ? [...common, EMPTY_TREE, hash, '--', ...paths]
        // For a merge, show it against its first parent: that is the change
        // the branch received, which is what the file list already counted.
        : [...common, parents[0], hash, '--', ...paths];
    } else {
      const status = parseStatus(await git(path, STATUS_ARGS));
      const entry = status.files.find((f) => f.path === file);
      untracked = entry?.state === 'untracked';
      args = untracked
        // An untracked file is in no tree at all, so nothing can be compared
        // with it. Diffing against an empty file shows it as wholly added.
        ? ['-c', 'core.quotepath=false', 'diff', `--unified=${context}`, '--no-index', '--', '/dev/null', file]
        : [...common, 'HEAD', '--', file, ...(origPath ? [origPath] : [])];
    }

    // `--no-index` reports differences with exit code 1, and a plain diff can
    // fail when the file is gone; neither is an error worth showing.
    const { stdout } = await runGit(path, args, { allowFailure: true });
    const parsed = parseFileDiff(stdout);
    if (untracked) parsed.status = 'added';

    return {
      path: file,
      origPath,
      hash,
      ...parsed,
      /** No hunks and not binary means a change Git records outside the text. */
      empty: !parsed.binary && parsed.hunks.length === 0
    };
  },

  /**
   * What the commit panel needs to know about HEAD before offering "Amend".
   *
   * Amending a commit that is already on a remote means a force push later,
   * so the panel has to be able to say that before the box is ticked.
   */
  async 'commit.head'({ path }) {
    const { stdout: oid, code } = await runGit(path, ['rev-parse', 'HEAD'], { allowFailure: true });
    if (code !== 0) {
      return { exists: false, hash: null, message: '', subject: '', isMerge: false, pushed: null };
    }
    const hash = oid.trim();
    const message = (await git(path, ['show', '-s', '--pretty=format:%B', hash])).replace(/\s+$/, '');
    const { stdout: ids } = await runGit(path, ['rev-list', '--parents', '-n', '1', hash], { allowFailure: true });

    // Only the upstream of the current branch matters here. Scanning every
    // remote ref would cost one process per branch for an answer nobody reads.
    //
    // The upstream ref is fetched first for the same reason as in
    // publishedOn: a commit pushed from elsewhere leaves the local
    // remote-tracking ref behind, and a stale ref answers "not pushed" about
    // a commit that is.
    let pushed = null;
    const { stdout: up, code: upCode } = await runGit(
      path, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { allowFailure: true }
    );
    if (upCode === 0 && up.trim()) {
      const upstream = up.trim();
      const remote = upstream.split('/')[0];
      await runGit(path, ['fetch', '--quiet', remote], { allowFailure: true });
      const { code: contains } = await runGit(path, ['merge-base', '--is-ancestor', hash, upstream], { allowFailure: true });
      if (contains === 0) pushed = upstream;
    }

    return {
      exists: true,
      hash,
      message,
      subject: message.split('\n')[0],
      isMerge: ids.trim().split(' ').length > 2,
      pushed
    };
  },

  /**
   * Commit exactly the files the user ticked, the way IntelliJ IDEA does.
   *
   * Ticking a box stages nothing. Only here does anything reach Git, and the
   * commit carries a pathspec, so a file that was already staged but left
   * unticked stays staged and uncommitted instead of being swept in.
   *
   * Two cases break that rule and are handled as such:
   *  - An untracked file cannot be named in a pathspec until Git knows it, so
   *    those are added first.
   *  - Git refuses a partial commit while a merge is unfinished, so during any
   *    in-progress operation the ticked files are staged and the whole index
   *    is committed. The panel says so before the button is pressed.
   */
  async 'changes.commit'({ path, paths, message, amend = false }) {
    if (!message || !message.trim()) {
      throw new GitError('A commit message is required.', { command: '', stderr: '', code: 1 });
    }
    if (!Array.isArray(paths) || paths.length === 0) {
      throw new GitError('Select at least one file to commit.', { command: '', stderr: '', code: 1 });
    }

    const status = parseStatus(await git(path, STATUS_ARGS));
    const operation = await detectOperation(path);
    const wanted = new Set(paths);
    const known = status.files.filter((f) => wanted.has(f.path));

    const missing = paths.filter((p) => !status.files.some((f) => f.path === p));
    if (missing.length > 0) {
      throw new GitError(
        `These files have changed since the list was read:\n  ${missing.join('\n  ')}\n\nRefresh and try again.`,
        { command: '', stderr: '', code: 1 }
      );
    }

    // A rename is one row on screen but two paths to Git. A pathspec commit
    // that named only the new one would leave the deletion of the old name
    // staged and uncommitted, splitting the rename in two.
    const pathspec = [];
    for (const file of known) {
      pathspec.push(file.path);
      if (file.origPath) pathspec.push(file.origPath);
    }

    // `git add` cannot take that old name: it is gone from the working tree
    // and gone from the index, because the rename is already recorded there.
    const stageable = known.map((f) => f.path);

    const untracked = known.filter((f) => f.state === 'untracked').map((f) => f.path);
    if (untracked.length > 0) await git(path, ['add', '--', ...untracked]);

    const args = ['commit'];
    if (amend) args.push('--amend');
    args.push('-m', message.trim());

    if (operation) {
      // Partial commits are impossible mid-merge, so stage and commit it all.
      await git(path, ['add', '--', ...stageable]);
    } else {
      args.push('--', ...pathspec);
    }

    try {
      await git(path, args);
    } catch (err) {
      // Undo the staging done for untracked files, so a refused commit (a
      // failing hook, say) leaves the working tree exactly as it was found.
      if (untracked.length > 0 && !operation) {
        await runGit(path, ['reset', '-q', '--', ...untracked], { allowFailure: true });
      }
      throw err;
    }

    const { stdout: created } = await runGit(path, ['rev-parse', 'HEAD'], { allowFailure: true });
    return { ok: true, commit: created.trim(), files: known.length, partial: !operation };
  },

  /**
   * Which AI providers are configured, so the panel knows whether to offer a
   * suggestion at all. Reports only names and models, never a key.
   */
  async 'commit.suggestProviders'() {
    return suggestionProviders();
  },

  /**
   * Where each AI key comes from, for the settings panel. Reports presence
   * and origin only: a saved key is never sent back to the browser.
   */
  async 'settings.keyStatus'() {
    return keyStatus();
  },

  /**
   * Save or clear an AI key. An empty key removes it, which is "Disconnect".
   */
  async 'settings.setKey'({ provider, key }) {
    if (!provider) throw new GitError('No provider was given.', { command: '', stderr: '', code: 1 });
    try {
      return await writeKey(provider, key ?? '');
    } catch (err) {
      throw new GitError(`Could not save the key: ${err?.message ?? err}`, { command: '', stderr: '', code: 1 });
    }
  },

  /**
   * Suggest a commit subject for the ticked files.
   *
   * The diff is built from the same file set `changes.commit` would use, so
   * the suggestion describes the commit that is actually about to be made and
   * not the whole working tree. The repository's own rules are read here and
   * the answer is checked against them before it is returned, which keeps a
   * suggestion from arriving in a state the Commit button would refuse.
   */
  async 'commit.suggest'({ path, paths, provider = null, amend = false }) {
    if (!Array.isArray(paths) || paths.length === 0) {
      if (!amend) {
        throw new GitError('Tick at least one file to describe.', { command: '', stderr: '', code: 1 });
      }
    }

    const status = parseStatus(await git(path, STATUS_ARGS));
    const wanted = new Set(paths ?? []);
    const known = status.files.filter((f) => wanted.has(f.path));

    // A rename is two paths to Git, exactly as it is when committing: naming
    // only the new one would show the change as an unexplained whole-file add.
    const pathspec = [];
    const untracked = [];
    for (const file of known) {
      pathspec.push(file.path);
      if (file.origPath) pathspec.push(file.origPath);
      if (file.state === 'untracked') untracked.push(file.path);
    }

    const common = ['-c', 'core.quotepath=false', 'diff', '--unified=3', '--find-renames'];
    const parts = [];
    const stats = [];

    // Tracked changes, against HEAD, which is the state the commit starts from.
    const tracked = pathspec.filter((p) => !untracked.includes(p));
    if (tracked.length > 0) {
      const { stdout } = await runGit(path, [...common, 'HEAD', '--', ...tracked], { allowFailure: true });
      if (stdout.trim()) parts.push(stdout);
      // `--stat` must not inherit `--unified`, or Git prints the whole patch
      // again underneath the summary and the note dwarfs the diff it explains.
      const { stdout: stat } = await runGit(
        path,
        ['-c', 'core.quotepath=false', 'diff', '--stat', '--find-renames', 'HEAD', '--', ...tracked],
        { allowFailure: true }
      );
      if (stat.trim()) stats.push(stat);
    }

    // An untracked file is in no tree, so there is nothing to compare it with.
    // Diffing against an empty file shows it as wholly added, which is what it is.
    for (const file of untracked) {
      const { stdout } = await runGit(
        path,
        ['-c', 'core.quotepath=false', 'diff', '--unified=3', '--no-index', '--', '/dev/null', file],
        { allowFailure: true }
      );
      if (stdout.trim()) parts.push(stdout);
      stats.push(` ${file} | new file`);
    }

    // Amending with nothing ticked describes the commit being replaced.
    if (parts.length === 0 && amend) {
      const { stdout } = await runGit(path, [...common, 'HEAD~1', 'HEAD'], { allowFailure: true });
      if (stdout.trim()) parts.push(stdout);
      const { stdout: stat } = await runGit(
        path,
        ['-c', 'core.quotepath=false', 'diff', '--stat', '--find-renames', 'HEAD~1', 'HEAD'],
        { allowFailure: true }
      );
      if (stat.trim()) stats.push(stat);
    }

    const diff = parts.join('\n');
    if (!diff.trim()) {
      throw new GitError('There is no change to describe.', { command: '', stderr: '', code: 1 });
    }

    const rules = await readCommitRules(path);
    return suggestSubject({
      diff,
      stat: stats.join('\n'),
      rules,
      provider,
      // The paths actually going in, so a suggested split can be checked
      // against them rather than taken on trust.
      paths: known.map((f) => f.path),
      validate: (subject) => validateMessage(subject, rules)
    });
  },

  /**
   * Tell Git that a conflicted file is dealt with.
   *
   * Adding the file to the index is what marks a conflict resolved. Without
   * this the user would have to reach for a terminal in the middle of a
   * cherry-pick, which is the one moment they are least able to.
   */
  async 'changes.markResolved'({ path, paths }) {
    if (!Array.isArray(paths) || paths.length === 0) return { ok: true, resolved: 0 };

    const status = parseStatus(await git(path, STATUS_ARGS));
    const wanted = new Set(paths);
    const conflicted = status.files.filter((f) => wanted.has(f.path) && f.state === 'conflicted');
    if (conflicted.length === 0) return { ok: true, resolved: 0 };

    const markers = [];
    for (const file of conflicted) {
      // A file still holding Git's markers is almost certainly not resolved,
      // and staging it would commit "<<<<<<<" into the history.
      const { stdout } = await runGit(path, ['grep', '-c', '-e', '^<<<<<<< ', '--', file.path], { allowFailure: true });
      if (stdout.trim()) markers.push(file.path);
    }
    if (markers.length > 0) {
      throw new GitError(
        `These files still contain conflict markers:\n  ${markers.join('\n  ')}\n\nEdit them so the markers are gone, then mark them resolved again. If a file is meant to contain that text, stage it with "git add" instead.`,
        { command: '', stderr: '', code: 1 }
      );
    }

    await git(path, ['add', '--', ...conflicted.map((f) => f.path)]);
    return { ok: true, resolved: conflicted.length };
  },

  /**
   * Throw away the working-tree changes to these files.
   *
   * A file that exists in HEAD goes back to its committed content. A file that
   * was newly added to the index has no committed content to go back to, so it
   * is unstaged and left on disk as an untracked file, which is where it came
   * from. Nothing is ever deleted.
   */
  async 'changes.rollback'({ path, paths }) {
    if (!Array.isArray(paths) || paths.length === 0) return { ok: true, restored: 0, unstaged: 0 };

    const inHead = [], notInHead = [];
    for (const p of paths) {
      const { code } = await runGit(path, ['cat-file', '-e', `HEAD:${p}`], { allowFailure: true });
      (code === 0 ? inHead : notInHead).push(p);
    }

    // The old name of a rename has to come back too, or the file is duplicated.
    const status = parseStatus(await git(path, STATUS_ARGS));
    for (const file of status.files) {
      if (!file.origPath || !paths.includes(file.path)) continue;
      if (!inHead.includes(file.origPath)) inHead.push(file.origPath);
    }

    if (notInHead.length > 0) await git(path, ['reset', '-q', '--', ...notInHead]);
    if (inHead.length > 0) {
      await git(path, ['reset', '-q', '--', ...inHead]);
      await git(path, ['checkout', '--', ...inHead]);
    }
    return { ok: true, restored: inHead.length, unstaged: notInHead.length };
  },

  /**
   * What a force push would do, so the confirmation can state it as fact.
   *
   * Read-only. The remote-tracking refs only move when something fetches, so
   * they are refreshed first: deciding what would be overwritten from stale
   * refs is how a force push loses work nobody knew was there.
   *
   * `branch` names the branch to inspect. Without one it is the checked-out
   * branch, which is what the toolbar and the commit panel ask about.
   */
  async 'repo.inspectForcePush'({ path, branch: named = null }) {
    const branch = await pushTarget(path, named);

    const { stdout: up } = await runGit(
      path,
      ['for-each-ref', '--format=%(upstream:short)', `refs/heads/${branch}`],
      { allowFailure: true }
    );
    const upstream = up.trim() || null;
    if (!upstream) {
      // Nothing to overwrite: an ordinary push creates the branch.
      return { branch, upstream: null, dropped: [], gained: 0, behind: 0, staleRefs: false };
    }

    const fetched = await runGit(path, ['fetch', '--quiet'], { allowFailure: true });

    // Commits on the remote that this branch does not contain: exactly what a
    // force push would throw away.
    const { stdout: lost } = await runGit(
      path,
      ['log', '--format=' + ['%H', '%h', '%an', '%at', '%s'].join(US) + RS, `${branch}..${upstream}`],
      { allowFailure: true }
    );
    const dropped = lost
      .split(RS)
      .map((r) => r.trim())
      .filter(Boolean)
      .map((record) => {
        const [hash, shortHash, author, when, subject] = record.split(US);
        return { hash, shortHash, author, date: Number(when) * 1000, subject };
      });

    const { stdout: ahead } = await runGit(path, ['rev-list', '--count', `${upstream}..${branch}`], { allowFailure: true });

    return {
      branch,
      upstream,
      dropped,
      gained: Number(ahead.trim() || 0),
      behind: dropped.length,
      // A failed fetch means the picture may be out of date, which the user
      // should be told before they agree to overwrite anything.
      staleRefs: fetched.code !== 0
    };
  },

  /**
   * Push a branch, which need not be the one checked out.
   *
   * An ordinary push is never forced: Git rejects one that would lose commits,
   * and that rejection is the safety check. `force` replaces that check with
   * `--force-with-lease`, which still refuses if the remote moved since the
   * last fetch, so a force push can only discard commits the user was shown.
   */
  async 'repo.push'({ path, branch: named = null, remote = null, setUpstream = false, force = false }) {
    const branch = await pushTarget(path, named);
    const args = ['push'];
    if (force) {
      // Never a bare --force. The lease makes Git check that the remote is
      // still where the last fetch left it, so a push cannot silently discard
      // a commit that arrived after the user was shown what would be lost.
      //
      // The lease has to name the ref explicitly: with no argument Git checks
      // the ref being pushed against its own remote-tracking ref, which is
      // only the ref Git would guess when the branch is the one checked out.
      args.push(`--force-with-lease=${branch}`);
    }
    if (setUpstream || remote) {
      if (!remote) throw new GitError('No remote to push to.', { command: '', stderr: '', code: 1 });
      if (setUpstream) args.push('--set-upstream');
      args.push(remote, branch);
    } else if (named) {
      // Pushing a branch that is not checked out: name it, because Git's
      // default refspec would send HEAD instead.
      const { stdout: on } = await runGit(
        path,
        ['for-each-ref', '--format=%(upstream:remotename)', `refs/heads/${branch}`],
        { allowFailure: true }
      );
      const target = on.trim();
      if (!target) throw new GitError(`${branch} does not track a remote branch.`, { command: '', stderr: '', code: 1 });
      args.push(target, `${branch}:${branch}`);
    }

    const { stderr, code: pushCode } = await runGit(path, args, { allowFailure: true });
    if (pushCode !== 0) {
      // A refused lease is not a generic failure: it means the remote moved,
      // which is the one case a force push must not be retried blindly.
      if (/stale info|does not match any|rejected.*fetch first|non-fast-forward/i.test(stderr)) {
        throw new GitError(
          force
            ? 'The remote moved since the last fetch, so the push was refused. Fetch and look at what arrived before forcing again.'
            : 'The remote has commits you do not have. Pull first, or force push if you meant to replace them.',
          { command: `git ${args.join(' ')}`, stderr, code: pushCode }
        );
      }
      throw new GitError(stderr.trim() || 'The push failed.', { command: `git ${args.join(' ')}`, stderr, code: pushCode });
    }
    return { ok: true, branch, forced: force, output: stderr.trim() };
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
