/**
 * Gitalia RPC surface.
 *
 * Every method is `(args) => Promise<result>`. The frontend never builds a
 * git command line; it calls these names. A Tauri build registers commands
 * with the same names and argument shapes, and the UI is unaffected.
 */
import { git, runGit, resolveRepository, gitVersion, GitError } from './git.mjs';
import { readCommitRules, validateMessage } from './commit-rules.mjs';
import { suggestSubject, suggestionProviders, explain } from './suggest.mjs';
import { keyStatus, writeKey } from './settings.mjs';
import * as recovery from './recovery.mjs';
import { githubToken, githubRepo, github, shapePull, commitChecks } from './github.mjs';
import * as consoleRules from './console.mjs';
import { execFile } from 'node:child_process';
import { access, mkdtemp, writeFile, rm, readFile, lstat, realpath } from 'node:fs/promises';
import { basename, join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const REBASE_HELPER = join(HERE, 'rebase-helper.mjs');

/**
 * How Git runs the rebase helper as its editor. Normally that is Node with
 * the helper script. The desktop app's backend is one executable with no
 * script beside it, so it sets GITALIA_REBASE_EDITOR to call itself instead.
 */
const rebaseEditor = () => process.env.GITALIA_REBASE_EDITOR || `"${process.execPath}" "${REBASE_HELPER}"`;

// Git's empty tree object. Diffing the first commit against it shows every
// file as added, because there is no parent commit to compare with.
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

const US = '\x1f'; // field separator
const RS = '\x1e'; // record separator

const LOG_FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%cn', '%ct', '%D', '%s'].join(US) + RS;

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

/**
 * The directory Git keeps this working tree's state in.
 *
 * Usually `<root>/.git`, but in a linked worktree `.git` is a file pointing at
 * `.git/worktrees/<name>`, and that is where a rebase, merge or cherry-pick in
 * progress leaves its state.
 */
async function gitDir(root) {
  const { stdout, code } = await runGit(root, ['rev-parse', '--absolute-git-dir'], { allowFailure: true });
  return code === 0 && stdout.trim() ? stdout.trim() : join(root, '.git');
}

/** Which multi-step git operation, if any, is half-finished right now. */
async function detectOperation(root) {
  const g = await gitDir(root);
  if (await exists(join(g, 'rebase-merge'))) return 'rebase';
  if (await exists(join(g, 'rebase-apply'))) return 'rebase';
  if (await exists(join(g, 'MERGE_HEAD'))) return 'merge';
  if (await exists(join(g, 'CHERRY_PICK_HEAD'))) return 'cherry-pick';
  if (await exists(join(g, 'REVERT_HEAD'))) return 'revert';
  if (await exists(join(g, 'BISECT_LOG'))) return 'bisect';
  return null;
}

/**
 * Split `%D` decoration into structured refs attached to a commit.
 *
 * The log is read with `--decorate=full`, so every name carries its
 * namespace and says what it is. A short name cannot: `feature/login` could
 * be a local branch or a branch on a remote called `feature`.
 */
function parseRefs(decoration) {
  const refs = [];
  if (!decoration) return refs;
  for (const raw of decoration.split(', ')) {
    let part = raw.trim();
    if (!part) continue;
    let isHead = false;
    if (part === 'HEAD') {
      refs.push({ kind: 'head', name: 'HEAD', isHead: true });
      continue;
    }
    if (part.startsWith('HEAD -> ')) {
      isHead = true;
      part = part.slice(8);
    }
    if (part.startsWith('tag: ')) part = part.slice(5);
    if (part.startsWith('refs/heads/')) {
      refs.push({ kind: 'local', name: part.slice(11), isHead });
    } else if (part.startsWith('refs/remotes/')) {
      const name = part.slice(13);
      // `origin/HEAD` only says which branch the remote calls its default.
      if (!name.endsWith('/HEAD')) refs.push({ kind: 'remote', name, isHead: false });
    } else if (part.startsWith('refs/tags/')) {
      refs.push({ kind: 'tag', name: part.slice(10), isHead: false });
    } else if (part.startsWith('refs/bisect/')) {
      // A bisect marks the commits it was told about: `bad`, `good-<hash>`
      // and `skip-<hash>`. They are shown as what they are, not as branches.
      refs.push({ kind: 'bisect', name: part.slice(12).replace(/-.*$/, ''), isHead: false });
    }
    // Anything else (refs/stash, notes, recovery points) is not drawn.
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
 * Split text into lines that keep their own terminator, so a set of slices
 * can later be joined back into exactly the original bytes.
 *
 * Every element ends with `\n` except the last, which carries the rest of the
 * file without any terminator when the file does not end with a newline.
 */
function splitKeptLines(text) {
  const lines = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      lines.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}

/**
 * Cut a conflicted file into its regions.
 *
 * Code before a `<<<<<<<` marker, then each conflict in turn. Git wrote the
 * alignment when it built the working-tree file, so the markers are trusted
 * rather than a third merge being reimplemented. A `|||||||` base block under
 * `merge.conflictstyle=diff3` is skipped, because its content is not one of
 * the two sides being chosen between.
 */
// A marker is exactly seven characters, then a space and a label or the end
// of the line. A longer run, such as a Markdown heading's `==========`
// underline, is file content.
const MARK_START = /^<{7}(?: |\r?\n?$)/;
const MARK_BASE = /^\|{7}(?: |\r?\n?$)/;
const MARK_SPLIT = /^={7}\r?\n?$/;
const MARK_END = /^>{7}(?: |\r?\n?$)/;

function parseConflictFile(text) {
  const lines = splitKeptLines(text);
  const sections = [];
  let i = 0;

  while (i < lines.length) {
    if (!MARK_START.test(lines[i])) {
      const start = i;
      while (i < lines.length && !MARK_START.test(lines[i])) i++;
      sections.push({ type: 'text', lines: lines.slice(start, i) });
      continue;
    }

    const start = i;
    const ours = [], theirs = [];
    const labels = { ours: lines[i].slice(7).trim(), theirs: '' };
    i++;
    let inTheirs = false;
    while (i < lines.length) {
      const line = lines[i];
      if (MARK_END.test(line)) { labels.theirs = line.slice(7).trim(); i++; break; }
      if (MARK_BASE.test(line)) {
        // The `|||||||` diff3 block runs to its own `=======`, and the
        // following `=======` marks the start of the theirs half.
        i++;
        while (i < lines.length && !MARK_SPLIT.test(lines[i]) && !MARK_END.test(lines[i])) i++;
        continue;
      }
      if (MARK_SPLIT.test(line)) { inTheirs = true; i++; continue; }
      (inTheirs ? theirs : ours).push(line);
      i++;
    }
    sections.push({ type: 'conflict', lines: lines.slice(start, i), ours, theirs, labels });
  }
  return { lines, sections };
}

/**
 * The three index stages a conflict is recorded into, in one read.
 *
 * Stage 1 is the common ancestor, stage 2 the side standing in the current
 * branch ("ours"), stage 3 the side being brought in ("theirs"). Each stage
 * is either absent (an add/add or modify/delete makes one of them empty),
 * binary, or text content. Ours and theirs are also inside the working-tree
 * file's markers, so only the base, the one side a two-pane view cannot show
 * on its own, is fetched in full.
 */
async function readUnmerged(path, file) {
  const out = { base: null, ours: null, theirs: null };
  const kinds = [null, 'base', 'ours', 'theirs'];
  const { stdout } = await runGit(path, ['ls-files', '-u', '-z', '--', file], { allowFailure: true });
  for (const record of stdout.split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    if (tab === -1) continue;
    const fields = record.slice(0, tab).split(' ');
    const stage = Number(fields[2]);
    if (stage < 1 || stage > 3) continue;
    const { stdout: blob, code } = await runGit(path, ['cat-file', 'blob', fields[1]], { allowFailure: true });
    const stageInfo = out[kinds[stage]] = { present: true, binary: code !== 0 || blob.includes('\0'), lines: 0 };
    if (!stageInfo.binary) {
      stageInfo.lines = splitKeptLines(blob).length;
      out[kinds[stage]].content = blob;
    }
  }
  return out;
}

/** The path inside the working tree a file name points at, or nothing escapes. */
function workPath(path, file) {
  if (!file || typeof file !== 'string') throw new GitError('No file was given.', { command: '', stderr: '', code: 1 });
  if (file.includes('\0') || file.startsWith('/') || file.includes('\n') || /(^|\/)\.\.(\/|$)/.test(file)) {
    throw new GitError(`Unsafe file path: ${file}`, { command: '', stderr: '', code: 1 });
  }
  const target = resolve(path, file);
  if (target !== path && !target.startsWith(`${path}${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new GitError(`Unsafe file path: ${file}`, { command: '', stderr: '', code: 1 });
  }
  return target;
}

/**
 * A working-tree file that is safe to read and write for the merge editor.
 *
 * `workPath` only checks the name. A branch can commit a symbolic link, or a
 * directory that is one, pointing anywhere on disk, and reading or writing
 * through it would reach outside the repository. The file itself must not be
 * a link, and the directory it sits in must resolve to somewhere inside the
 * working tree.
 */
async function conflictFilePath(path, file) {
  const target = workPath(path, file);
  const refuse = () => {
    throw new GitError(
      `${file} is a symbolic link, or sits inside one, so the merge editor will not open it. Resolve it from a terminal.`,
      { command: '', stderr: '', code: 1 }
    );
  };
  const info = await lstat(target).catch(() => null);
  if (info && !info.isFile()) refuse();
  const root = await realpath(path);
  const parent = await realpath(dirname(target)).catch(() => null);
  const sep = process.platform === 'win32' ? '\\' : '/';
  if (!parent || (parent !== root && !parent.startsWith(root + sep))) refuse();
  return target;
}

/**
 * Mark conflicted files as dealt with, so an operation can continue.
 *
 * Adding a file to the index is what tells Git its conflict is resolved. The
 * marker check is the guard against a file half-fixed in a text editor: a
 * `<<<<<<<` line staged by accident would become history, and this refuses to
 * let that happen.
 */
async function resolveConflicts(path, paths) {
  const status = parseStatus(await git(path, STATUS_ARGS));
  const wanted = new Set(paths);
  const conflicted = status.files.filter((f) => wanted.has(f.path) && f.state === 'conflicted');
  if (conflicted.length === 0) return { ok: true, resolved: 0 };

  const markers = [];
  for (const file of conflicted) {
    // A file still holding Git's markers is almost certainly not resolved.
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
}

/**
 * A path as Git writes it in a patch header.
 *
 * A name holding a tab, a quote, a backslash or another control character is
 * written in C-style quotes, or `git apply` reads a different name and the
 * hunk lands nowhere.
 */
function patchPath(prefix, file) {
  const name = prefix + file;
  if (!/[\x00-\x1f"\\\x7f]/.test(name)) return name;
  const escapes = { '\t': '\\t', '\n': '\\n', '\r': '\\r', '"': '\\"', '\\': '\\\\' };
  const quoted = [...name].map((c) =>
    escapes[c] ?? (c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f
      ? '\\' + c.charCodeAt(0).toString(8).padStart(3, '0')
      : c)
  ).join('');
  return `"${quoted}"`;
}

/**
 * Rebuild one hunk as a self-contained patch Git can apply.
 *
 * `parseFileDiff` kept each line's content after its kind marker, so writing
 * the marker back reproduces the original patch line for line, the no-newline
 * marker included. The heading sits on the header line, so a hostile newline
 * in it is stripped rather than trusted.
 *
 * A line marked `skip` is left out of the stage (or unstage). Staging applies
 * the patch to the index: a skipped addition is dropped, and a skipped
 * removal becomes context, because the index still holds that line.
 * Unstaging applies the patch in reverse, so the roles swap: a skipped
 * addition stays in the index as context, and a skipped removal is dropped.
 * `--recount` then corrects the line counts in the `@@` header.
 *
 * Returns null when every change in the hunk is skipped.
 */
function buildHunkPatch(file, hunk, side = 'unstaged') {
  const line = (n, len) => (len === 1 ? String(n) : `${n},${len}`);
  const heading = (hunk.heading ?? '').replace(/[\r\n]/g, '');
  const a = patchPath('a/', file), b = patchPath('b/', file);
  const out = [
    `diff --git ${a} ${b}`,
    `--- ${a}`,
    `+++ ${b}`,
    `@@ -${line(hunk.oldStart, hunk.oldLines)} +${line(hunk.newStart, hunk.newLines)} @@${heading ? ' ' + heading : ''}`
  ];
  let changes = 0;
  for (const diffLine of hunk.lines ?? []) {
    // One patch line per diff line. A newline inside one would start a line
    // of its own, and could name another file for the patch to touch.
    if (typeof diffLine.text !== 'string' || diffLine.text.includes('\n')) {
      throw new GitError('A hunk line is malformed.', { command: '', stderr: '', code: 1 });
    }
    let kind = diffLine.kind === 'add' || diffLine.kind === 'del' ? diffLine.kind : 'context';
    if (kind !== 'context' && diffLine.skip) {
      const keptAsContext = side === 'staged' ? 'add' : 'del';
      if (kind !== keptAsContext) continue;
      kind = 'context';
    }
    if (kind !== 'context') changes++;
    out.push((kind === 'add' ? '+' : kind === 'del' ? '-' : ' ') + diffLine.text);
    if (diffLine.noNewline) out.push('\\ No newline at end of file');
  }
  return changes > 0 ? out.join('\n') + '\n' : null;
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
      'The stash list has changed since it was read. Refresh and try again.',
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

/**
 * Turn the parsed log into every number the report shows.
 *
 * The log is read one commit past the limit, so that one extra commit is
 * what says the history goes further than the report.
 */
function buildReport(commits, limit) {
  const truncated = commits.length > limit;
  if (truncated) commits = commits.slice(0, limit);
  if (commits.length === 0) return emptyReport(limit);

  const report = emptyReport(limit);
  report.truncated = truncated;

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

/** The first parent of a commit, which is where a rebase over it starts. */
async function firstParentOf(path, hash) {
  const { stdout } = await runGit(path, ['rev-list', '--parents', '-n', '1', hash], { allowFailure: true });
  const ids = stdout.trim().split(' ');
  return ids[1] ?? hash;
}

/**
 * Run `git rebase -i` with an exact todo list, leaving nothing half-finished.
 *
 * The helper writes the plan verbatim, so this is where reorder and drop
 * actually happen. A failure aborts the rebase rather than leaving the
 * repository stopped in the middle of one, because a user who asked to move
 * a commit did not ask to be handed a rebase to finish by hand.
 */
async function runRebasePlan(path, base, todo) {
  const editor = rebaseEditor();
  const env = {
    GIT_SEQUENCE_EDITOR: `${editor} sequence`,
    GITALIA_TODO: todo
  };
  try {
    await runGit(path, ['rebase', '--interactive', base], { env });
  } catch (err) {
    await runGit(path, ['rebase', '--abort'], { allowFailure: true });

    // A conflict here is not something the user can resolve and continue:
    // the rebase has already been abandoned, so say what happened and what
    // the branch looks like now, rather than passing Git's progress output
    // on as if it were an error message.
    const text = `${err?.stderr ?? ''}\n${err?.message ?? ''}`;
    if (/could not apply|CONFLICT|Merge conflict/i.test(text)) {
      throw new GitError(
        'The commits could not be replayed in that order: one of them depends on a change another makes. Nothing was altered, and the branch is as it was.',
        { command: 'git rebase --interactive', stderr: err?.stderr ?? '', code: 1 }
      );
    }
    throw err;
  }
}

/**
 * Where, if anywhere, an interactive rebase has paused, and why.
 *
 * Git leaves `stopped-sha` whenever the rebase stops part-way, whether to
 * amend an `edit` or because a commit would not apply. The `amend` file is
 * what tells the two apart: Git writes it only for a pause that is meant to
 * end with `git commit --amend`. A conflict stops the rebase with the working
 * tree in the middle of the 3-way merge, and no `amend` file.
 */
async function rebaseStopInfo(root) {
  const dir = join(await gitDir(root), 'rebase-merge');
  const read = async (name) =>
    (await exists(join(dir, name))) ? (await readFile(join(dir, name), 'utf8')).trim() : null;
  const sha = await read('stopped-sha');
  // `amend` holds the commit HEAD pointed at when the rebase paused, which is
  // how a continue can tell whether the user has since moved HEAD themselves.
  const amendHead = await read('amend');
  return { dir, sha, amend: amendHead !== null, amendHead };
}

/**
 * The plan a paused rebase was started with, kept beside Git's own state.
 *
 * The rest of the plan (messages for a reword or squash past the stop) must
 * survive a reload of the app. Git deletes `rebase-merge` when the rebase
 * finishes or is abandoned, so the saved plan goes with it.
 */
const PLAN_FILE = 'gitalia-plan.json';

async function savePlan(root, plan) {
  const dir = join(await gitDir(root), 'rebase-merge');
  if (await exists(dir)) await writeFile(join(dir, PLAN_FILE), JSON.stringify(plan));
}

/** How many files a stopped operation left in conflict. */
async function conflictCount(path) {
  const status = parseStatus(await git(path, STATUS_ARGS));
  return status.files.filter((f) => f.state === 'conflicted').length;
}

async function savedPlan(dir) {
  try {
    const plan = JSON.parse(await readFile(join(dir, PLAN_FILE), 'utf8'));
    return Array.isArray(plan) ? plan : null;
  } catch {
    return null;
  }
}

/**
 * The messages a rebase will write, each matched by the message the commit
 * has right now.
 *
 * Git gives the message editor no way to tell which commit it is for, so the
 * only thing identifying it is the message already in the file. A reword
 * expects the commit's current message and replaces it; a squash expects the
 * message of the commit it folds into, which is the pick holding a message.
 */
async function messageRewrites(path, plan) {
  const rewords = [];
  for (const entry of plan) {
    if (entry.command === 'reword' && entry.message) {
      const { stdout: existing } = await runGit(path, ['show', '-s', '--format=%B', entry.hash], { allowFailure: true });
      rewords.push({ from: existing.trim(), to: entry.message.trim() });
    }
  }
  const squashTarget = plan.find((e) => e.command === 'pick' && e.message);
  if (squashTarget) {
    const { stdout: existing } = await runGit(path, ['show', '-s', '--format=%B', squashTarget.hash], { allowFailure: true });
    rewords.push({ from: existing.trim(), to: squashTarget.message.trim() });
  }
  return rewords;
}

/**
 * Continue a rebase that paused at an `edit`, or once a conflict is resolved.
 *
 * An `edit` stop wants the commit amended with whatever the user changed since
 * the stop, plus a message they may have written for it in the plan, and only
 * then does the rest of the plan apply. The `amend` file is what marks that
 * kind of pause, so a pause left over from a conflict is continued untouched.
 *
 * What goes into the amend is the index plus every change to a tracked file:
 * Git will not continue over unstaged changes, so leaving them out would only
 * stop the rebase again. An untracked file stays out unless it was staged,
 * the same rule a commit follows.
 *
 * If HEAD is no longer the commit Git stopped at, the user has already made
 * commits of their own at the stop (splitting it, say). Amending would rewrite
 * the last of those, so the stop is continued as it is.
 *
 * `plan` travels with the continue so the messages still to be written in a
 * reword or squash past the stop can be offered to the helper, exactly as they
 * were on the first pass. Without one, the plan saved when the rebase started
 * is used, so a reload of the app loses nothing.
 */
async function continueRebase(path, plan, status) {
  const editor = rebaseEditor();
  const stop = await rebaseStopInfo(path);
  if (!Array.isArray(plan) || plan.length === 0) plan = await savedPlan(stop.dir);

  const { stdout: head } = await runGit(path, ['rev-parse', 'HEAD'], { allowFailure: true });
  if (stop.amend && head.trim() === stop.amendHead) {
    const stoppedRow = Array.isArray(plan)
      ? plan.find((entry) => stop.sha && (entry.hash === stop.sha || entry.hash?.startsWith(stop.sha)))
      : null;
    const message = stoppedRow?.message?.trim();
    const changed = status.files.some((f) => f.state === 'tracked' || f.state === 'renamed');
    if (message || changed) {
      if (changed) await git(path, ['add', '-u']);
      const args = ['commit', '--amend', '--allow-empty'];
      const file = join(stop.dir, 'gitalia-message');
      if (message) {
        await writeFile(file, message);
        args.push('-F', file);
      } else {
        args.push('--no-edit');
      }
      try {
        await git(path, args);
      } finally {
        await rm(file, { force: true });
      }
      // The message is written; a second continue must not write it again.
      if (message) {
        stoppedRow.message = undefined;
        await savePlan(path, plan);
      }
    }
  }

  let env = { GIT_EDITOR: 'true' };
  if (Array.isArray(plan) && plan.length > 0) {
    const rewords = await messageRewrites(path, plan);
    if (rewords.length > 0) {
      env = { GIT_EDITOR: `${editor} message`, GITALIA_REWORDS: JSON.stringify(rewords) };
    }
  }

  try {
    await git(path, ['rebase', '--continue'], { env });
  } catch (err) {
    // A later commit conflicting is a stop like any other, with files to
    // resolve before continuing again.
    if ((await detectOperation(path)) !== 'rebase' || (await conflictCount(path)) === 0) throw err;
    const next = await rebaseStopInfo(path);
    return { ok: true, operation: 'rebase', finished: false, stoppedAt: next.sha, conflicted: true };
  }
  const next = await rebaseStopInfo(path);
  return { ok: true, operation: 'rebase', finished: next.sha === null, stoppedAt: next.sha, conflicted: false };
}

const BLAME_LINE_CAP = 20000;

/**
 * Read `git blame --porcelain`.
 *
 * Each line starts with a header naming its commit and line numbers. The
 * first time a commit appears, lines describing it follow (author, time,
 * summary, previous); then the file line itself, after a tab.
 */
function parseBlame(stdout) {
  const commits = {};
  const lines = [];
  let current = null;
  let truncated = false;
  for (const raw of stdout.split('\n')) {
    if (current === null) {
      const head = /^([0-9a-f]{40}) (\d+) (\d+)/.exec(raw);
      if (!head) continue;
      current = { hash: head[1], origLine: Number(head[2]), line: Number(head[3]) };
      if (!commits[current.hash]) commits[current.hash] = { author: '', email: '', time: 0, summary: '', previous: null };
      continue;
    }
    if (raw.startsWith('\t')) {
      if (lines.length < BLAME_LINE_CAP) lines.push({ ...current, text: raw.slice(1) });
      else truncated = true;
      current = null;
      continue;
    }
    const space = raw.indexOf(' ');
    const key = space === -1 ? raw : raw.slice(0, space);
    const value = space === -1 ? '' : raw.slice(space + 1);
    const info = commits[current.hash];
    if (key === 'author') info.author = value;
    else if (key === 'author-mail') info.email = value.replace(/^<|>$/g, '');
    else if (key === 'author-time') info.time = Number(value) * 1000;
    else if (key === 'summary') info.summary = value;
    else if (key === 'previous') {
      const cut = value.indexOf(' ');
      info.previous = { hash: value.slice(0, cut), file: value.slice(cut + 1) };
    }
  }
  return { lines, commits, truncated };
}

/**
 * Split a search box query into Git log filters.
 *
 * `author:ann path:src since:"2 weeks ago" fix login` gives an author, a
 * path, a date and two words the message must contain. A value with spaces
 * is quoted. An unknown qualifier is searched for as an ordinary word.
 */
function parseSearch(query) {
  const out = { words: [], author: [], paths: [], since: null, until: null };
  const unquote = (v) => v.replace(/^"(.*)"$/, '$1');
  for (const match of String(query).matchAll(/(\w+):("[^"]*"|\S+)|"([^"]*)"|(\S+)/g)) {
    const [, key, value, quoted, word] = match;
    if (key) {
      const v = unquote(value).trim();
      if (!v) continue;
      const name = key.toLowerCase();
      if (name === 'author') out.author.push(v);
      else if (name === 'path' || name === 'file') out.paths.push(v);
      else if (name === 'since' || name === 'after') out.since = v;
      else if (name === 'until' || name === 'before') out.until = v;
      else out.words.push(`${key}:${v}`);
    } else if (quoted !== undefined) {
      if (quoted.trim()) out.words.push(quoted.trim());
    } else if (word) {
      out.words.push(word);
    }
  }
  return out;
}

/** Files and line counts from `--numstat -z`, renames included. */
function parseNumstat(stat) {
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
  return files;
}

/**
 * Whether a commit is signed, and whether the signature checks out.
 *
 * `%G?` is Git's verdict: G good, U good but the key is not trusted, X or Y
 * expired, R revoked key, B bad, E cannot be checked (usually the key is not
 * known here), N not signed. Checking a signature runs gpg or ssh-keygen, so
 * it is done for one commit at a time, when its details are opened.
 */
const SIGNATURE_STATES = {
  G: 'good', U: 'untrusted', X: 'expired', Y: 'expired-key', R: 'revoked', B: 'bad', E: 'unknown', N: 'none'
};

async function readSignature(path, hash) {
  const { stdout, code } = await runGit(path, ['log', '-1', `--format=%G?${US}%GS${US}%GK${US}%GF`, hash, '--'], { allowFailure: true });
  if (code !== 0) return { status: 'none', signer: null, key: null };
  const [mark, signer, key, fingerprint] = stdout.trim().split(US);
  const { stdout: raw } = await runGit(path, ['cat-file', 'commit', hash], { allowFailure: true });
  const format = /^gpgsig(?:-sha256)? -----BEGIN SSH SIGNATURE/m.test(raw) ? 'ssh'
    : /^gpgsig(?:-sha256)? -----BEGIN SIGNED MESSAGE/m.test(raw) ? 'x509'
    : /^gpgsig/m.test(raw) ? 'openpgp' : null;
  // Without an allowed-signers file Git says N for an SSH signature it cannot
  // check. The commit is still signed, so that is "cannot be checked".
  let status = SIGNATURE_STATES[mark] ?? 'unknown';
  if (status === 'none' && format) status = 'unknown';
  return {
    status,
    format,
    signer: signer || null,
    key: fingerprint || key || null
  };
}

/**
 * The two sides of a change to a Git LFS file, or null for any other diff.
 *
 * Git stores an LFS file as a three line pointer naming the real content by
 * its hash and size, and a diff of one shows those lines changing. That says
 * nothing a person can read, so the viewer shows what the pointers mean.
 */
function lfsPointerChange(parsed) {
  if (parsed.binary || parsed.hunks.length === 0) return null;
  const lines = parsed.hunks.flatMap((h) => h.lines);
  const pointer = /^(version https:\/\/git-lfs\.github\.com\/spec\/v1|oid sha256:[0-9a-f]{64}|size \d+)$/;
  if (!lines.every((l) => pointer.test(l.text) || l.text === '')) return null;
  const side = (kinds) => {
    const text = lines.filter((l) => kinds.includes(l.kind)).map((l) => l.text);
    const oid = text.map((t) => /^oid sha256:([0-9a-f]{64})$/.exec(t)?.[1]).find(Boolean) ?? null;
    const size = text.map((t) => /^size (\d+)$/.exec(t)?.[1]).find(Boolean);
    return oid ? { oid, size: size === undefined ? null : Number(size) } : null;
  };
  const before = side(['del', 'context']);
  const after = side(['add', 'context']);
  if (!before && !after) return null;
  return { before: parsed.status === 'added' ? null : before, after: parsed.status === 'deleted' ? null : after };
}

/**
 * Keep a copy of a working-tree file in Git's object store, and return its
 * hash, or null when there is no such file. A rollback throws the content
 * away, and this is what lets the Undo panel bring it back.
 */
async function saveWorkingFile(path, file) {
  const { stdout, code } = await runGit(path, ['hash-object', '-w', '--', file], { allowFailure: true });
  return code === 0 ? stdout.trim() : null;
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
    const operation = await detectOperation(path);
    // Why a rebase is paused: an `edit` waiting to be amended, or a commit
    // that would not apply. Only an edit stop leaves Git's `amend` file.
    let rebaseStop = null;
    if (operation === 'rebase') {
      const stop = await rebaseStopInfo(path);
      rebaseStop = stop.amend ? 'edit' : stop.sha ? 'conflict' : null;
    }
    return { ...status, operation, rebaseStop };
  },

  /**
   * Who last changed each line of a file, and in which commit.
   *
   * `rev` names the commit to read the file at; without it the working tree
   * is read, and lines not committed yet carry the all-zero hash. Each commit
   * is described once, and each line points at its commit, so a long file of
   * few commits stays small. `previous` is where the line was before that
   * commit, which is what "Before this" in the viewer opens next.
   */
  async 'blame.file'({ path, file, rev = null }) {
    if (!file || typeof file !== 'string' || file.startsWith('-') || file.includes('\0')) {
      throw new GitError('A file inside the repository is required.', { command: '', stderr: '', code: 1 });
    }
    workPath(path, file);
    if (rev !== null && (typeof rev !== 'string' || !/^[\w./^~@{}-]+$/.test(rev) || rev.startsWith('-'))) {
      throw new GitError('That is not a commit Gitalia can read.', { command: '', stderr: '', code: 1 });
    }
    const args = ['blame', '--porcelain', ...(rev ? [rev] : []), '--', file];
    const { stdout, stderr, code } = await runGit(path, args, { allowFailure: true });
    if (code !== 0) {
      throw new GitError(stderr.trim() || `Git could not blame ${file}.`, { command: `git ${args.join(' ')}`, stderr, code });
    }
    return { file, rev, ...parseBlame(stdout) };
  },

  /**
   * Search the whole history, not only the commits the graph has loaded.
   *
   * The query is words and qualifiers: `author:`, `path:`, `since:` and
   * `until:` (also `after:` and `before:`), each taking a value that may be
   * quoted. The other words must all appear in the commit message, whatever
   * their case. A word that is a commit hash, or the start of one, also finds
   * that commit. Every value reaches Git as part of an option or after `--`,
   * so none can be read as an option of its own.
   */
  async 'log.search'({ path, query = '', refs = null, limit = 1000 }) {
    const parsed = parseSearch(query);
    const args = [
      'log', `--pretty=format:${LOG_FORMAT}`, '--decorate=full', '--date-order', `--max-count=${limit + 1}`,
      `--decorate-refs-exclude=${recovery.RECOVERY_PREFIX}*`, '--regexp-ignore-case', '--fixed-strings', '--all-match'
    ];
    for (const author of parsed.author) args.push(`--author=${author}`);
    for (const word of parsed.words) args.push(`--grep=${word}`);
    if (parsed.since) args.push(`--since=${parsed.since}`);
    if (parsed.until) args.push(`--until=${parsed.until}`);
    const scoped = Array.isArray(refs) ? refs.filter((ref) => typeof ref === 'string' && ref.trim()) : [];
    if (scoped.length > 0) args.push(...scoped);
    else args.push('--exclude=refs/stash', `--exclude=${recovery.RECOVERY_PREFIX}*`, '--all', 'HEAD');
    args.push('--', ...parsed.paths);

    const nothing = parsed.words.length + parsed.author.length + parsed.paths.length === 0 && !parsed.since && !parsed.until;
    if (nothing) return { commits: [], truncated: false, query: parsed };

    const { stdout, code } = await runGit(path, args, { allowFailure: true });
    let commits = code === 0 ? parseLog(stdout) : [];

    // One lone word may be a hash rather than message text.
    if (parsed.words.length === 1 && /^[0-9a-f]{4,40}$/i.test(parsed.words[0]) && !parsed.author.length && !parsed.paths.length) {
      const { stdout: found, code: ok } = await runGit(
        path, ['log', '-1', `--pretty=format:${LOG_FORMAT}`, '--decorate=full', `--decorate-refs-exclude=${recovery.RECOVERY_PREFIX}*`, `${parsed.words[0]}^{commit}`, '--'],
        { allowFailure: true }
      );
      const byHash = ok === 0 ? parseLog(found) : [];
      if (byHash.length && !commits.some((c) => c.hash === byHash[0].hash)) commits = [byHash[0], ...commits];
    }
    return { commits: commits.slice(0, limit), truncated: commits.length > limit, query: parsed };
  },

  /**
   * One page of the log.
   *
   * `limit` caps the page and `skip` jumps past commits already shown, so the
   * graph can be walked deeper without ever holding the whole history. Both
   * count the same `--date-order` sequence the client is drawing from.
   */
  async 'log.list'({ path, limit = 2000, all = true, refs = null, skip = 0 }) {
    // One commit past the page says whether there is another page. Asking
    // for exactly `limit` could not tell a history of exactly that length
    // from a longer one.
    // Recovery points are refs, and must not be drawn as branches. Options go
    // before the refs and the `--` that ends them.
    const args = [
      'log', `--pretty=format:${LOG_FORMAT}`, '--decorate=full', '--date-order', `--max-count=${limit + 1}`,
      `--decorate-refs-exclude=${recovery.RECOVERY_PREFIX}*`
    ];
    if (skip > 0) args.push(`--skip=${skip}`);
    const scoped = Array.isArray(refs) ? refs.filter((ref) => typeof ref === 'string' && ref.trim()) : [];
    if (scoped.length > 0) {
      // Only what is reachable from these refs, so the graph shows the history
      // of the branch the user picked rather than every branch in the repo.
      args.push(...scoped, '--');
    } else if (all) {
      // `--all` sweeps in everything under refs/, and that includes refs/stash.
      // A stash would then appear in the graph as two commits nobody
      // asked for, so it is excluded. `--exclude` only applies to the `--all`
      // that follows it.
      args.push('--exclude=refs/stash', `--exclude=${recovery.RECOVERY_PREFIX}*`, '--all', 'HEAD');
    }
    const { stdout, code } = await runGit(path, args, { allowFailure: true });
    // An empty repository has no HEAD to log; that is not an error.
    if (code !== 0) return { commits: [], truncated: false };
    const commits = parseLog(stdout);
    return { commits: commits.slice(0, limit), truncated: commits.length > limit };
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
        // The full refname, not the short one: refs/remotes/origin/HEAD
        // shortens to plain "origin", which no test on the short name can
        // tell apart from a branch. It points at another ref already in this
        // list, so listing it would show a phantom branch named after the
        // remote itself.
        if (refname.endsWith('/HEAD')) continue;
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
    return { body: body.trim(), files: parseNumstat(stat), signature: await readSignature(path, hash) };
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

  /**
   * Create a tag at a commit.
   *
   * A message makes it annotated, which records who tagged it and when; with
   * none it is a lightweight tag, a plain name pointing at the commit. Git
   * decides that by whether `-m` is present, so the dialog's optional message
   * field is all that separates the two.
   */
  async 'tag.create'({ path, name, at = null, message = '' }) {
    const args = ['tag'];
    const annotated = typeof message === 'string' && message.trim().length > 0;
    if (annotated) args.push('-m', message.trim());
    args.push(name);
    if (at) args.push(at);
    await git(path, args);
    return { ok: true, name, annotated };
  },

  /**
   * What deleting a tag would cost, read before the confirmation is shown.
   *
   * A tag that has been pushed is the case worth knowing about: deleting it
   * here leaves it on the remote, so the dialog has to say so rather than
   * implying the tag is gone everywhere.
   */
  async 'tag.inspect'({ path, name }) {
    const { stdout: oid } = await runGit(path, ['rev-parse', `${name}^{commit}`], { allowFailure: true });
    const { stdout: subject } = await runGit(path, ['log', '-1', '--format=%s', `${name}^{commit}`], { allowFailure: true });
    const { stdout: kind } = await runGit(path, ['cat-file', '-t', name], { allowFailure: true });

    // `git tag` alone cannot say where a tag was pushed, so the remotes are
    // asked. A remote that cannot be reached is skipped rather than guessed
    // at: claiming a tag is only local when it is not would be the worse
    // mistake of the two.
    const onRemote = [];
    let unreachable = false;
    const { stdout: remotes } = await runGit(path, ['remote'], { allowFailure: true });
    for (const remote of remotes.split('\n').map((r) => r.trim()).filter(Boolean)) {
      const { stdout: ls, code } = await runGit(
        path,
        ['ls-remote', '--tags', remote, `refs/tags/${name}`],
        { allowFailure: true }
      );
      if (code !== 0) { unreachable = true; continue; }
      if (ls.trim()) onRemote.push(remote);
    }

    return {
      name,
      oid: oid.trim(),
      shortHash: oid.trim().slice(0, 7),
      subject: subject.trim(),
      /** 'tag' for an annotated tag, 'commit' for a lightweight one. */
      annotated: kind.trim() === 'tag',
      onRemote,
      unreachable
    };
  },

  /** Delete a tag locally. A copy on a remote is left where it is. */
  async 'tag.delete'({ path, name }) {
    await git(path, ['tag', '-d', name]);
    return { ok: true, name };
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

  /**
   * What a pull would bring in, so the confirmation can state it as fact.
   *
   * Read-only, but it fetches first: deciding what to merge from stale
   * remote-tracking refs would describe the wrong thing. A failed fetch is
   * reported rather than thrown, because the commits already fetched are
   * still worth showing.
   */
  async 'repo.inspectPull'({ path }) {
    const problems = [];

    const { stdout: sym, code } = await runGit(path, ['symbolic-ref', '--short', 'HEAD'], { allowFailure: true });
    if (code !== 0) {
      return { ok: false, problems: ['HEAD is detached, so there is no branch to pull into.'] };
    }
    const branch = sym.trim();

    const fetched = await runGit(path, ['fetch', '--prune'], { allowFailure: true });

    const { stdout: up } = await runGit(
      path,
      ['for-each-ref', '--format=%(upstream:short)', `refs/heads/${branch}`],
      { allowFailure: true }
    );
    const upstream = up.trim() || null;
    if (!upstream) {
      return {
        ok: false,
        branch,
        upstream: null,
        problems: [`${branch} does not track a remote branch, so there is nothing to pull from.`]
      };
    }

    // A pull merges into the working tree, so Git refuses to start one that
    // would overwrite an uncommitted change.
    const status = parseStatus(await git(path, STATUS_ARGS));
    const dirty = status.files.filter((f) => f.state !== 'untracked').length;
    const operation = await detectOperation(path);
    if (operation) {
      problems.push(`A ${operation} is already in progress. Finish or abort it first.`);
    }
    if (dirty > 0) {
      problems.push(
        dirty === 1
          ? 'You have 1 uncommitted change. Commit or stash it before pulling.'
          : `You have ${dirty} uncommitted changes. Commit or stash them before pulling.`
      );
    }

    // What is coming in, newest first, and how far the branch has gone its
    // own way. Both are needed to say whether this is a fast-forward.
    const { stdout: incoming } = await runGit(
      path,
      ['log', '--format=' + ['%H', '%h', '%an', '%at', '%s'].join(US) + RS, `HEAD..${upstream}`],
      { allowFailure: true }
    );
    const commits = incoming
      .split(RS)
      .map((r) => r.trim())
      .filter(Boolean)
      .map((record) => {
        const [hash, shortHash, author, when, subject] = record.split(US);
        return { hash, shortHash, author, date: Number(when) * 1000, subject };
      });

    const { stdout: ahead } = await runGit(path, ['rev-list', '--count', `${upstream}..HEAD`], { allowFailure: true });
    const localOnly = Number(ahead.trim() || 0);

    // Which files the merge would touch, so the dialog can warn before Git
    // does. Only meaningful when there is something to merge.
    let changedFiles = 0;
    if (commits.length > 0) {
      const { stdout: names } = await runGit(
        path,
        ['diff', '--name-only', `HEAD...${upstream}`],
        { allowFailure: true }
      );
      changedFiles = names.split('\n').filter((l) => l.trim()).length;
    }

    return {
      ok: problems.length === 0,
      problems,
      branch,
      upstream,
      commits,
      behind: commits.length,
      ahead: localOnly,
      /** True when the merge is a straight fast-forward, with no merge commit. */
      fastForward: localOnly === 0,
      changedFiles,
      /** True when the fetch failed, so this picture may be out of date. */
      staleRefs: fetched.code !== 0
    };
  },

  /**
   * What merging `source` into the current branch would do.
   *
   * Read-only. Nothing is fetched: unlike a pull, the source is a ref the
   * user already has, so refreshing it would change what they asked about.
   */
  async 'repo.inspectMerge'({ path, source }) {
    const problems = [];

    if (!source) return { ok: false, problems: ['No branch was given to merge.'] };

    const { stdout: sym, code } = await runGit(path, ['symbolic-ref', '--short', 'HEAD'], { allowFailure: true });
    if (code !== 0) {
      return { ok: false, problems: ['HEAD is detached, so there is no branch to merge into.'] };
    }
    const target = sym.trim();

    if (source === target) {
      return { ok: false, source, target, problems: [`${source} is the branch you are on.`] };
    }

    const { code: exists } = await runGit(path, ['rev-parse', '--verify', '--quiet', `${source}^{commit}`], { allowFailure: true });
    if (exists !== 0) {
      return { ok: false, source, target, problems: [`${source} does not name a commit.`] };
    }

    const status = parseStatus(await git(path, STATUS_ARGS));
    const dirty = status.files.filter((f) => f.state !== 'untracked').length;
    const operation = await detectOperation(path);
    if (operation) {
      problems.push(`A ${operation} is already in progress. Finish or abort it first.`);
    }
    if (dirty > 0) {
      problems.push(
        dirty === 1
          ? 'You have 1 uncommitted change. Commit or stash it before merging.'
          : `You have ${dirty} uncommitted changes. Commit or stash them before merging.`
      );
    }

    // Already merged: every commit on the source is reachable from HEAD.
    const { code: contained } = await runGit(path, ['merge-base', '--is-ancestor', source, 'HEAD'], { allowFailure: true });
    const alreadyMerged = contained === 0;

    // A fast-forward is possible when HEAD is an ancestor of the source, so
    // the current branch has nothing of its own to keep.
    const { code: ancestor } = await runGit(path, ['merge-base', '--is-ancestor', 'HEAD', source], { allowFailure: true });
    const fastForward = ancestor === 0 && !alreadyMerged;

    const { stdout: incoming } = await runGit(
      path,
      ['log', '--format=' + ['%H', '%h', '%an', '%at', '%s'].join(US) + RS, `HEAD..${source}`],
      { allowFailure: true }
    );
    const commits = incoming
      .split(RS)
      .map((r) => r.trim())
      .filter(Boolean)
      .map((record) => {
        const [hash, shortHash, author, when, subject] = record.split(US);
        return { hash, shortHash, author, date: Number(when) * 1000, subject };
      });

    let changedFiles = 0;
    let conflicts = [];
    if (commits.length > 0) {
      const { stdout: names } = await runGit(path, ['diff', '--name-only', `HEAD...${source}`], { allowFailure: true });
      changedFiles = names.split('\n').filter((l) => l.trim()).length;

      // Ask Git what would conflict, without touching the working tree or
      // the index. Knowing this before the dialog is what lets it warn
      // instead of leaving the user to discover it mid-merge.
      const { stdout: base } = await runGit(path, ['merge-base', 'HEAD', source], { allowFailure: true });
      if (base.trim()) {
        const { stdout: tree, code: treeCode } = await runGit(
          path,
          ['merge-tree', '--write-tree', '--name-only', 'HEAD', source],
          { allowFailure: true }
        );
        // `--write-tree` exits non-zero when the merge conflicts. It prints
        // the resulting tree's id, then the conflicted paths, then a blank
        // line, then Git's own messages about them. Only the paths are
        // wanted, so everything from the blank line on is dropped.
        //
        // Older Git does not support this form and fails differently, in
        // which case nothing is claimed rather than guessed.
        if (treeCode !== 0) {
          const [head] = tree.split('\n\n');
          conflicts = head
            .split('\n')
            .slice(1) // the tree id
            .map((l) => l.trim())
            .filter(Boolean);
        }
      }
    }

    return {
      ok: problems.length === 0,
      problems,
      source,
      target,
      commits,
      incoming: commits.length,
      alreadyMerged,
      fastForward,
      changedFiles,
      conflicts
    };
  },

  /**
   * Merge a branch into the one checked out.
   *
   * A fast-forward is allowed, so a branch with nothing of its own moves up
   * rather than growing a merge commit that records nothing. `--no-edit`
   * keeps Git from opening an editor for the message it already wrote.
   *
   * A conflict leaves the merge open, exactly as a pull does: the status bar
   * offers to resolve and continue, or to abandon it.
   */
  async 'repo.merge'({ path, source }) {
    const { stdout: before } = await runGit(path, ['rev-parse', 'HEAD'], { allowFailure: true });
    const previousHead = before.trim();

    const args = ['merge', '--no-edit', source];
    const { stderr, stdout, code } = await runGit(path, args, { allowFailure: true });

    if (code !== 0) {
      const operation = await detectOperation(path);
      if (operation) {
        return { ok: false, conflicted: true, operation, previousHead };
      }
      throw new GitError(
        (stderr || stdout).trim() || 'The merge failed.',
        { command: `git ${args.join(' ')}`, stderr, code }
      );
    }

    const { stdout: after } = await runGit(path, ['rev-parse', 'HEAD'], { allowFailure: true });
    const head = after.trim();
    const { stdout: count } = await runGit(path, ['rev-list', '--count', `${previousHead}..${head}`], { allowFailure: true });
    // A merge commit was made when the new HEAD has two parents and the first
    // is where the branch stood. A fast-forward over a branch that already
    // held merges moves straight up and makes none.
    const { stdout: parents } = await runGit(path, ['rev-list', '--parents', '-n', '1', head], { allowFailure: true });
    const [, first, ...others] = parents.trim().split(' ');
    const mergeCommit = previousHead !== head && first === previousHead && others.length > 0;

    return {
      ok: true,
      conflicted: false,
      /** The commits the other branch brought, not counting the merge commit. */
      applied: Math.max(0, Number(count.trim() || 0) - (mergeCommit ? 1 : 0)),
      previousHead,
      head,
      upToDate: previousHead === head,
      /** False when the branch simply moved up, so no merge commit was made. */
      mergeCommit,
      output: (stdout || stderr).trim()
    };
  },

  /**
   * Bring the upstream branch in.
   *
   * Always a merge: `--no-rebase` makes that explicit rather than leaving it
   * to whatever `pull.rebase` happens to be configured as, so what the
   * confirmation described is what runs. Nothing local is rewritten.
   *
   * A conflict leaves the merge open on purpose, exactly as a cherry-pick
   * does: the status bar already offers resolve, continue and abort.
   */
  async 'repo.pull'({ path }) {
    const { stdout: before } = await runGit(path, ['rev-parse', 'HEAD'], { allowFailure: true });
    const previousHead = before.trim();

    const args = ['pull', '--no-rebase', '--no-edit'];
    const { stderr, stdout, code } = await runGit(path, args, { allowFailure: true });

    if (code !== 0) {
      const operation = await detectOperation(path);
      if (operation) {
        return { ok: false, conflicted: true, operation, previousHead };
      }
      throw new GitError(
        (stderr || stdout).trim() || 'The pull failed.',
        { command: `git ${args.join(' ')}`, stderr, code }
      );
    }

    const { stdout: after } = await runGit(path, ['rev-parse', 'HEAD'], { allowFailure: true });
    const head = after.trim();
    // How many commits actually arrived, counted after the fact rather than
    // trusting the count the dialog was built from.
    const { stdout: count } = await runGit(
      path,
      ['rev-list', '--count', `${previousHead}..${head}`],
      { allowFailure: true }
    );

    return {
      ok: true,
      conflicted: false,
      applied: Number(count.trim() || 0),
      previousHead,
      head,
      upToDate: previousHead === head,
      output: (stdout || stderr).trim()
    };
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

    const newestHash = hashes[0];
    const dir = await mkdtemp(join(tmpdir(), 'gitalia-squash-'));
    const messageFile = join(dir, 'message.txt');
    await writeFile(messageFile, text, 'utf8');

    // The plan, oldest first: the oldest selected commit keeps its pick and
    // the rest fold into it, then everything after it is replayed untouched.
    const selected = [...hashes].reverse();
    const { stdout: after } = await runGit(
      path,
      ['rev-list', '--reverse', `${newestHash}..HEAD`],
      { allowFailure: true }
    );
    const replayedHashes = after.split('\n').map((h) => h.trim()).filter(Boolean);

    const todo = [
      ...selected.map((sha, i) => `${i === 0 ? 'pick' : 'squash'} ${sha}`),
      ...replayedHashes.map((sha) => `pick ${sha}`)
    ].join('\n');

    const editor = rebaseEditor();
    const env = {
      GIT_SEQUENCE_EDITOR: `${editor} sequence`,
      GIT_EDITOR: `${editor} message`,
      GITALIA_TODO: todo,
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
   * Shared groundwork for the rewrites that move or remove commits.
   *
   * Both run `git rebase -i` over the same span, so both need the same
   * answers: is the working tree clean, is the commit on this branch, what
   * would be rewritten, and has any of it been published. Read-only.
   */
  async 'commits.inspectRewrite'({ path, hashes, mode }) {
    const problems = [];

    if (!Array.isArray(hashes) || hashes.length === 0) {
      return { ok: false, problems: ['Select at least one commit.'] };
    }

    const parents = new Map();
    for (const hash of hashes) {
      const { stdout, code } = await runGit(path, ['rev-list', '--parents', '-n', '1', hash], { allowFailure: true });
      if (code !== 0) return { ok: false, problems: [`Commit ${hash.slice(0, 7)} no longer exists.`] };
      parents.set(hash, stdout.trim().split(' ').slice(1));
    }

    const merges = hashes.filter((h) => (parents.get(h) ?? []).length > 1);
    if (merges.length > 0) {
      problems.push(
        `The selection contains ${merges.length === 1 ? 'a merge commit' : `${merges.length} merge commits`}. Rewriting history across a merge is not supported.`
      );
    }

    const { stdout: headOid } = await runGit(path, ['rev-parse', 'HEAD'], { allowFailure: true });
    const head = headOid.trim();

    // Everything must be on the current branch, or rebase has nothing to move.
    for (const hash of hashes) {
      const { code } = await runGit(path, ['merge-base', '--is-ancestor', hash, 'HEAD'], { allowFailure: true });
      if (code !== 0) {
        problems.push(`${hash.slice(0, 7)} is not in the history of the current branch.`);
        break;
      }
    }

    const status = parseStatus(await git(path, STATUS_ARGS));
    const dirty = status.files.filter((f) => f.state !== 'untracked').length;
    if (dirty > 0) {
      problems.push(
        dirty === 1
          ? 'You have 1 uncommitted change. Commit or stash it first.'
          : `You have ${dirty} uncommitted changes. Commit or stash them first.`
      );
    }
    if (status.operation) {
      problems.push(`A ${status.operation} is already in progress. Finish or abort it first.`);
    }

    // The oldest commit involved decides where the rebase starts.
    const oldest = hashes[hashes.length - 1];
    const base = (parents.get(oldest) ?? [])[0] ?? null;
    if (!base) {
      problems.push('This reaches the first commit of the repository, which cannot be rewritten this way.');
    }

    // Everything from the base up is rewritten and gets a new hash.
    //
    // `--first-parent` is what makes this match the todo list Git builds: an
    // interactive rebase walks the branch, not both sides of every merge, so
    // a plain `base..HEAD` would count the commits a merge brought in as well
    // and the plan would name more commits than Git offers.
    let rewritten = [];
    let spanMerges = 0;
    if (base) {
      const { stdout: span } = await runGit(
        path,
        ['log', '--first-parent', '--format=' + ['%H', '%h', '%P', '%s'].join(US) + RS, `${base}..HEAD`],
        { allowFailure: true }
      );
      rewritten = span
        .split(RS)
        .map((r) => r.trim())
        .filter(Boolean)
        .map((record) => {
          const [hash, shortHash, parentIds, subject] = record.split(US);
          const isMerge = parentIds.trim().split(' ').filter(Boolean).length > 1;
          if (isMerge) spanMerges++;
          return { hash, shortHash, subject, isMerge };
        });
    }

    // A merge anywhere in the span, not only in the selection. `rebase -i`
    // flattens what it replays, so rewriting across a merge would quietly
    // discard the branch structure the merge records. Refusing is the only
    // honest answer: there is no todo list that preserves it.
    if (spanMerges > 0) {
      problems.push(
        spanMerges === 1
          ? 'A merge commit sits between here and the tip of the branch. Rewriting across a merge would flatten it, so Gitalia does not offer it.'
          : `${spanMerges} merge commits sit between here and the tip of the branch. Rewriting across a merge would flatten them, so Gitalia does not offer it.`
      );
    }

    // Anything already on a remote is the part that costs a force push.
    const published = [];
    for (const commit of rewritten) {
      const { stdout: on } = await runGit(
        path,
        ['branch', '--remotes', '--contains', commit.hash, '--format=%(refname:short)'],
        { allowFailure: true }
      );
      for (const ref of on.split('\n').map((r) => r.trim()).filter(Boolean)) {
        if (!published.includes(ref)) published.push(ref);
      }
    }

    const { stdout: branch } = await runGit(path, ['symbolic-ref', '--short', 'HEAD'], { allowFailure: true });

    return {
      ok: problems.length === 0,
      problems,
      mode,
      base,
      head,
      branch: branch.trim() || null,
      /** Commits that would be rewritten, newest first. Includes the selection. */
      rewritten,
      published
    };
  },

  /**
   * Remove commits from the branch entirely.
   *
   * The change they made goes with them, which is what separates this from a
   * revert: nothing records that the commit was ever there. Everything after
   * them is replayed and gets a new hash.
   */
  async 'commits.drop'({ path, hashes }) {
    const inspection = await methods['commits.inspectRewrite']({ path, hashes, mode: 'drop' });
    if (!inspection.ok) {
      throw new GitError(inspection.problems.join('\n'), { command: '', stderr: '', code: 1 });
    }

    const { base, head, rewritten } = inspection;
    const dropping = new Set(hashes);
    if (rewritten.every((c) => dropping.has(c.hash))) {
      // Every commit in the span goes, so there is nothing for rebase to
      // replay. Moving the branch back is the same result and cannot conflict.
      await git(path, ['reset', '--hard', base]);
      return { ok: true, previousHead: head, head: base, dropped: hashes.length, replayed: 0 };
    }

    // Oldest first, which is the order the todo list runs in.
    const todo = [...rewritten]
      .reverse()
      .map((c) => `${dropping.has(c.hash) ? 'drop' : 'pick'} ${c.hash}`)
      .join('\n');

    await runRebasePlan(path, base, todo);

    const { stdout: after } = await runGit(path, ['rev-parse', 'HEAD'], { allowFailure: true });
    return {
      ok: true,
      previousHead: head,
      head: after.trim(),
      dropped: hashes.length,
      replayed: rewritten.length - hashes.length
    };
  },

  /**
   * Move one commit one place earlier or later in the history.
   *
   * One step at a time, so the result of each move is a history the user can
   * read and judge before making the next one.
   */
  async 'commits.move'({ path, hash, direction }) {
    if (direction !== 'up' && direction !== 'down') {
      throw new GitError('A move must be "up" or "down".', { command: '', stderr: '', code: 1 });
    }

    // `up` means later in history, which is towards HEAD and so earlier in a
    // newest-first list.
    //
    // The whole branch is listed, not just the part above the commit: moving
    // the newest commit down needs the one below it, which a range starting
    // at this commit's own parent would not contain.
    const { stdout: listing } = await runGit(
      path,
      ['log', '--format=%H', '--first-parent', 'HEAD'],
      { allowFailure: true }
    );
    const order = listing.split('\n').map((h) => h.trim()).filter(Boolean); // newest first
    const at = order.indexOf(hash);
    if (at === -1) {
      throw new GitError('That commit is not on the current branch.', { command: '', stderr: '', code: 1 });
    }

    const neighbour = direction === 'up' ? at - 1 : at + 1;
    if (neighbour < 0) {
      throw new GitError('That commit is already the newest on this branch.', { command: '', stderr: '', code: 1 });
    }
    if (neighbour >= order.length) {
      throw new GitError('That commit is already the oldest that can be moved.', { command: '', stderr: '', code: 1 });
    }

    // The span to rebase starts below whichever of the two sits lower.
    const lowest = order[Math.max(at, neighbour)];
    const inspection = await methods['commits.inspectRewrite']({ path, hashes: [lowest], mode: 'move' });
    if (!inspection.ok) {
      throw new GitError(inspection.problems.join('\n'), { command: '', stderr: '', code: 1 });
    }

    const { base, head, rewritten } = inspection;

    // Swap the pair, then write the span out oldest first.
    const swapped = [...rewritten.map((c) => c.hash)];
    const i = swapped.indexOf(hash);
    const j = swapped.indexOf(order[neighbour]);
    if (i === -1 || j === -1) {
      throw new GitError('The commits to swap are no longer where they were.', { command: '', stderr: '', code: 1 });
    }
    [swapped[i], swapped[j]] = [swapped[j], swapped[i]];

    const todo = swapped.reverse().map((sha) => `pick ${sha}`).join('\n');

    await runRebasePlan(path, base, todo);

    const { stdout: after } = await runGit(path, ['rev-parse', 'HEAD'], { allowFailure: true });
    return { ok: true, previousHead: head, head: after.trim(), moved: hash, direction };
  },

  /**
   * The commits an interactive rebase would cover, ready for the editor.
   *
   * `from` is the oldest commit to include. Everything from there up to HEAD
   * is listed oldest first, which is the order the todo list runs in and so
   * the order the editor shows.
   */
  async 'commits.rebaseSpan'({ path, from }) {
    const inspection = await methods['commits.inspectRewrite']({ path, hashes: [from], mode: 'move' });
    if (!inspection.ok) return inspection;

    const { base } = inspection;
    const { stdout } = await runGit(
      path,
      ['log', '--reverse', '--format=' + ['%H', '%h', '%an', '%at', '%s', '%B'].join(US) + RS, `${base}..HEAD`],
      { allowFailure: true }
    );

    const commits = stdout
      .split(RS)
      .map((r) => r.replace(/^\n/, ''))
      .filter((r) => r.trim())
      .map((record) => {
        const [hash, shortHash, author, when, subject, message] = record.split(US);
        return {
          hash,
          shortHash,
          author,
          date: Number(when) * 1000,
          subject,
          message: (message ?? '').trim()
        };
      });

    return { ...inspection, commits };
  },

  /**
   * Run an interactive rebase from a plan the user built.
   *
   * `plan` is the todo list, oldest first: `{ hash, command }` per commit,
   * with `message` on anything reworded or squashed. Nothing is worked out
   * here beyond turning that into a todo list and the messages to write;
   * deciding what the plan should be is the editor's job.
   */
  async 'commits.rebase'({ path, from, plan }) {
    if (!Array.isArray(plan) || plan.length === 0) {
      throw new GitError('The rebase plan is empty.', { command: '', stderr: '', code: 1 });
    }
    if (plan.every((entry) => entry.command === 'drop')) {
      throw new GitError(
        'The plan drops every commit, which would leave the branch with nothing to apply.',
        { command: '', stderr: '', code: 1 }
      );
    }
    // The oldest kept commit cannot fold into something above it: there is
    // nothing above it to fold into.
    const firstKept = plan.find((entry) => entry.command !== 'drop');
    if (firstKept && (firstKept.command === 'squash' || firstKept.command === 'fixup')) {
      throw new GitError(
        'The oldest commit cannot be squashed into the one before it, because the plan does not include it.',
        { command: '', stderr: '', code: 1 }
      );
    }

    const inspection = await methods['commits.inspectRewrite']({ path, hashes: [from], mode: 'move' });
    if (!inspection.ok) {
      throw new GitError(inspection.problems.join('\n'), { command: '', stderr: '', code: 1 });
    }
    const { base, head } = inspection;

    const todo = plan.map((entry) => `${entry.command} ${entry.hash}`).join('\n');

    const rewords = await messageRewrites(path, plan);

    const editor = rebaseEditor();
    const env = {
      GIT_SEQUENCE_EDITOR: `${editor} sequence`,
      GIT_EDITOR: `${editor} message`,
      GITALIA_TODO: todo
    };
    if (rewords.length > 0) env.GITALIA_REWORDS = JSON.stringify(rewords);

    let conflicted = 0;
    try {
      await runGit(path, ['rebase', '--interactive', base], { env });
    } catch (err) {
      // A conflict leaves the rebase stopped with files to resolve, and the
      // merge editor can resolve them: the rebase stays open for that, and
      // Continue or Abandon in the status bar takes it from there. Anything
      // else is abandoned, so the branch is left as it was.
      conflicted = (await detectOperation(path)) === 'rebase' ? await conflictCount(path) : 0;
      if (conflicted === 0) {
        await runGit(path, ['rebase', '--abort'], { allowFailure: true });
        throw err;
      }
    }

    const { stdout: after } = await runGit(path, ['rev-parse', 'HEAD'], { allowFailure: true });
    const { stdout: count } = await runGit(path, ['rev-list', '--count', `${base}..HEAD`], { allowFailure: true });

    // An `edit` in the plan stops the rebase instead of finishing it: Git
    // pauses at the commit so it can be amended, and the rest applies when the
    // user continues. That is a pause, not a finished run.
    const stop = await rebaseStopInfo(path);
    if (stop.sha !== null) await savePlan(path, plan);

    return {
      conflicted: conflicted > 0,
      ok: true,
      previousHead: head,
      head: after.trim(),
      commits: Number(count.trim() || 0),
      dropped: plan.filter((e) => e.command === 'drop').length,
      combined: plan.filter((e) => e.command === 'squash' || e.command === 'fixup').length,
      reworded: plan.filter((e) => e.command === 'reword').length,
      stopped: stop.sha !== null,
      stoppedAt: stop.sha
    };
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
      '--date-order', `--max-count=${limit + 1}`
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
    else args.push('--exclude=refs/stash', `--exclude=${recovery.RECOVERY_PREFIX}*`, '--all', 'HEAD');

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
   * Stashes.
   *
   * Nothing is wrapped or reinterpreted: a stash made here is an ordinary
   * stash, so `git stash list` shows it and the command line can reach it.
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

  /** The files one stash holds. */
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
   * Stash the chosen files and take them out of the working tree.
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
   * Take a stash back into the working tree.
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
        throw new GitError((stderr || stdout).trim() || 'The stash could not be applied.', {
          command: `git stash apply ${ref}`, stderr, code
        });
      }
      // Git keeps the stash when applying it conflicts, which is what makes
      // it safe to resolve: the stashed copy is still there to fall back on.
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
    // first parent is the branch the merge was made on. Any merge in the
    // batch needs the flag, so keep scanning until one shows up. Non-merges
    // ignore the flag, so one `-m` for the whole run is enough.
    for (const hash of hashes) {
      const { stdout: ids } = await runGit(path, ['rev-list', '--parents', '-n', '1', hash], { allowFailure: true });
      if (ids.trim().split(' ').length > 2) {
        args.push('-m', String(mainline));
        break;
      }
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
   * finishes it. `GIT_EDITOR=true` keeps Git from trying to open an editor for
   * the message it already has. A rebase pauses at an `edit` too, and that
   * kind of pause brings the rest of the plan with it, so the messages Git
   * still needs can be written by the same helper as the first pass.
   */
  async 'repo.continueOperation'({ path, plan }) {
    const operation = await detectOperation(path);
    if (!operation) return { ok: true, operation: null, finished: true };

    const status = parseStatus(await git(path, STATUS_ARGS));
    const unresolved = status.files.filter((f) => f.state === 'conflicted');
    if (unresolved.length > 0) {
      throw new GitError(
        `${unresolved.length} ${unresolved.length === 1 ? 'file still has' : 'files still have'} conflicts:\n  ${unresolved.map((f) => f.path).join('\n  ')}\n\nResolve them, then continue.`,
        { command: '', stderr: '', code: 1 }
      );
    }

    if (operation === 'rebase') return continueRebase(path, plan, status);

    const command = {
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
  async 'diff.file'({ path, file, origPath = null, hash = null, base = null, context = 3, side = null }) {
    if (!file) throw new GitError('No file was given.', { command: '', stderr: '', code: 1 });

    // core.quotepath escapes non-ASCII paths in the patch headers. The status
    // of the file is read from those headers, so keep them readable.
    const common = ['-c', 'core.quotepath=false', 'diff', `--unified=${context}`, '--find-renames'];
    let args;
    let untracked = false;

    // Only working-tree diffs answer the staged/unstaged question; a diff of
    // a commit has a fixed pair of sides. Who is untracked comes from status,
    // which is read once for both.
    if (!hash) {
      const status = parseStatus(await git(path, STATUS_ARGS));
      untracked = status.files.find((f) => f.path === file)?.state === 'untracked';
    }

    if (hash && base) {
      // Both sides named outright. A stash needs this: its content
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
    } else if (side === 'staged') {
      // What is waiting in the index: HEAD on the left, the index on the
      // right. An untracked file is not in the index, so this reads empty.
      args = ['-c', 'core.quotepath=false', 'diff', `--unified=${context}`, '--cached', '--', file];
    } else if (side === 'unstaged' && !untracked) {
      // What the working tree holds beyond the index, so the viewer can stage
      // parts of it. An untracked file falls through to the against-nothing
      // diff below, which shows the whole file as the unstaged part.
      args = ['-c', 'core.quotepath=false', 'diff', `--unified=${context}`, '--', file];
    } else {
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
      side,
      untracked,
      ...parsed,
      /** No hunks and not binary means a change Git records outside the text. */
      empty: !parsed.binary && parsed.hunks.length === 0,
      lfs: lfsPointerChange(parsed)
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
   * Stage or unstage whole files, the box in the commit panel.
   *
   * One tick now means one Git command. A partially staged file can only live
   * in the index, so the tick stopped being paper: ticking adds the file's
   * current working-tree content, unticking resets its index entry to HEAD.
   * An untracked file enters the index the moment it is ticked and leaves it
   * (becoming untracked again) when it is unticked.
   */
  async 'changes.stage'({ path, paths, on }) {
    if (!Array.isArray(paths) || paths.length === 0) return { ok: true, staged: 0 };

    if (on) {
      await git(path, ['add', '--', ...paths]);
    } else {
      // A staged rename is two index entries. Resetting only the new name
      // would leave the old one staged as a deletion.
      const status = parseStatus(await git(path, STATUS_ARGS));
      const wanted = new Set(paths);
      const origins = status.files
        .filter((f) => f.state === 'renamed' && f.origPath && wanted.has(f.path))
        .map((f) => f.origPath);
      await git(path, ['reset', '-q', '--', ...paths, ...origins]);
    }
    return { ok: true, staged: paths.length };
  },

  /**
   * Stage or unstage individual hunks of one file.
   *
   * The hunks come from `diff.file` with a `side` and are rebuilt here into a
   * minimal patch handed to `git apply --cached`: an `unstaged` hunk is
   * against the index and goes in, a `staged` hunk is against HEAD and comes
   * out. The hunks are applied one at a time, highest first, so staging one
   * does not move the line numbers the hunks above it were read with.
   */
  async 'changes.stageHunks'({ path, file, side = 'unstaged', hunks }) {
    if (side !== 'unstaged' && side !== 'staged') {
      throw new GitError('A side of "staged" or "unstaged" is required.', { command: '', stderr: '', code: 1 });
    }
    if (!Array.isArray(hunks) || hunks.length === 0) {
      throw new GitError('Select at least one hunk.', { command: '', stderr: '', code: 1 });
    }
    if (!file || !/^(?:[^/]+(?:\/|$))+$/.test(file) || file.includes('..')) {
      throw new GitError('A relative file path is required.', { command: '', stderr: '', code: 1 });
    }

    // A staged hunk starting at line 0 of nothing is the file being created.
    // Taking it out of the index means the file leaves the index; applying it
    // in reverse would instead stage an empty file.
    const partial = hunks.some((h) => (h.lines ?? []).some((l) => l.skip));
    if (side === 'staged' && !partial && hunks.some((h) => h.oldStart === 0 && h.oldLines === 0)) {
      await git(path, ['reset', '-q', '--', file]);
      return { ok: true, applied: hunks.length };
    }

    const ordered = [...hunks].sort((a, b) => (b.oldStart ?? 0) - (a.oldStart ?? 0));
    let dir = null;
    try {
      dir = await mkdtemp(join(tmpdir(), 'gitalia-hunks-'));
      const patchFile = join(dir, 'hunk.patch');
      const patches = ordered.map((hunk) => buildHunkPatch(file, hunk, side)).filter((p) => p !== null);
      if (patches.length === 0) {
        throw new GitError('Select at least one changed line.', { command: '', stderr: '', code: 1 });
      }
      for (const patch of patches) {
        await writeFile(patchFile, patch, 'utf8');
        const apply = ['apply', '--cached', '--recount'];
        if (side === 'staged') apply.push('-R');
        apply.push(patchFile);
        await git(path, apply);
      }
      return { ok: true, applied: hunks.length };
    } finally {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  },

  /**
   * Throw away chosen hunks, or chosen lines of them, from the working tree.
   *
   * The hunks come from the unstaged side, the working tree against the
   * index, and are applied in reverse to the working tree only: what is
   * staged is not touched. A line left out (`skip`) stays as it is. The file's
   * content is saved first, so the Undo panel can bring it back.
   */
  async 'changes.rollbackHunks'({ path, file, hunks }) {
    if (!Array.isArray(hunks) || hunks.length === 0) {
      throw new GitError('Select at least one hunk.', { command: '', stderr: '', code: 1 });
    }
    if (!file || !/^(?:[^/]+(?:\/|$))+$/.test(file) || file.includes('..')) {
      throw new GitError('A relative file path is required.', { command: '', stderr: '', code: 1 });
    }
    // Reversing on the working tree: an addition left out stays, as context;
    // a removal left out stays removed, so it is dropped. The same mirror as
    // unstaging, so `buildHunkPatch` is asked for that side.
    const ordered = [...hunks].sort((a, b) => (b.newStart ?? 0) - (a.newStart ?? 0));
    const patches = ordered.map((hunk) => buildHunkPatch(file, hunk, 'staged')).filter((p) => p !== null);
    if (patches.length === 0) throw new GitError('Select at least one changed line.', { command: '', stderr: '', code: 1 });

    const blob = await saveWorkingFile(path, file);
    await withScratch(async (dir) => {
      const patchFile = join(dir, 'hunk.patch');
      // Checked first, all of them, so a hunk that no longer fits leaves the
      // file exactly as it was rather than half rolled back.
      for (const patch of patches) {
        await writeFile(patchFile, patch, 'utf8');
        const check = await runGit(path, ['apply', '-R', '--check', '--recount', patchFile], { allowFailure: true });
        if (check.code !== 0) {
          throw new GitError('The file changed since the diff was read. Refresh and try again.', { command: 'git apply -R --check', stderr: check.stderr, code: check.code });
        }
      }
      for (const patch of patches) {
        await writeFile(patchFile, patch, 'utf8');
        await git(path, ['apply', '-R', '--recount', patchFile]);
      }
    });
    if (blob) {
      const { stdout: now } = await runGit(path, ['hash-object', '--', file], { allowFailure: true });
      await recovery.record(path, {
        operation: 'changes.rollbackHunks', label: `Rolled back part of ${file}`,
        target: { kind: 'file', name: file }, before: blob, after: now.trim() || null
      }).catch(() => {});
    }
    return { ok: true, rolledBack: patches.length };
  },

  /**
   * Commit the staged working tree.
   *
   * The tick is a stage, so "the files the user ticked" is exactly what the
   * index holds: a whole file by `git add`, a hunk by `git apply`. The commit
   * is therefore a plain index commit, and anything the index does not hold
   * stays out of it, on purpose. Amending with nothing staged still works: it
   * replaces the message of HEAD, whose tree is untouched.
   */
  async 'changes.commit'({ path, paths, message, amend = false, sign = null }) {
    if (!message || !message.trim()) {
      throw new GitError('A commit message is required.', { command: '', stderr: '', code: 1 });
    }
    if (!Array.isArray(paths)) {
      throw new GitError('Select at least one file to commit.', { command: '', stderr: '', code: 1 });
    }

    const status = parseStatus(await git(path, STATUS_ARGS));
    const operation = await detectOperation(path);
    const staged = status.files.filter((f) => f.index !== '.' && f.index !== '?');

    if (staged.length === 0 && !amend) {
      throw new GitError(
        'Nothing is staged. Tick a file to stage it, then commit again.',
        { command: '', stderr: '', code: 1 }
      );
    }

    const args = ['commit'];
    if (amend) args.push('--amend');
    // Signing follows the repository's own setting unless the panel says
    // otherwise for this one commit.
    if (sign === true) args.push('-S');
    else if (sign === false) args.push('--no-gpg-sign');
    args.push('-m', message.trim());

    // Nothing to undo if this fails: the commit writes no staging of its own,
    // so a refused commit leaves the working tree exactly as it was found.
    await git(path, args);

    const { stdout: created } = await runGit(path, ['rev-parse', 'HEAD'], { allowFailure: true });
    return { ok: true, commit: created.trim(), files: staged.length, partial: !operation };
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
    return resolveConflicts(path, paths);
  },

  /**
   * What the merge editor needs about a conflicted file, in one read.
   *
   * The working tree already holds Git's best merge: the code either side
   * wrote, cut into `<<<<<<<` blocks. That is parsed into sections, and stage
   * 1 is read so the common ancestor can be shown as a third, read-only side.
   */
  async 'conflicts.read'({ path, file }) {
    const target = await conflictFilePath(path, file);
    const status = parseStatus(await git(path, STATUS_ARGS));
    if (!status.files.some((f) => f.path === file && f.state === 'conflicted')) {
      throw new GitError(`${file} has no conflict to resolve.`, { command: '', stderr: '', code: 1 });
    }

    const unmerged = await readUnmerged(path, file);
    const stages = { base: {}, ours: {}, theirs: {} };
    for (const key of ['base', 'ours', 'theirs']) {
      const stage = unmerged[key];
      stages[key] = { present: !!stage, binary: !!(stage && stage.binary), lines: stage ? stage.lines : 0 };
    }

    const buffer = await readFile(target);
    if (buffer.includes(0)) {
      return { path: file, binary: true, truncated: false, lines: 0, sections: [], base: null, stages };
    }

    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      return { path: file, binary: true, truncated: false, lines: 0, sections: [], base: null, stages };
    }

    let { lines, sections } = parseConflictFile(text);

    // A modify/delete conflict leaves no markers in the working tree: Git
    // keeps the surviving side's content and lets `git add` or `git rm`
    // decide it. The two sides live only in the index, so the whole file
    // becomes one choice between them, in place of the plain text the parser
    // saw. The side with no stage is the one that deleted the file, and
    // choosing it deletes the file.
    if (!sections.some((s) => s.type === 'conflict')) {
      const oursLines = unmerged.ours && !unmerged.ours.binary ? splitKeptLines(unmerged.ours.content) : [];
      const theirsLines = unmerged.theirs && !unmerged.theirs.binary ? splitKeptLines(unmerged.theirs.content) : [];
      if (oursLines.length > 0 || theirsLines.length > 0) {
        sections = [{
          type: 'conflict',
          lines,
          ours: oursLines,
          theirs: theirsLines,
          labels: { ours: '', theirs: '' },
          deleted: { ours: !unmerged.ours, theirs: !unmerged.theirs }
        }];
      }
    }

    // The base is capped: it is a reference, and a generated file's ancestor
    // can be enormous without anyone reading most of it.
    let base = null, truncated = false;
    if (unmerged.base && !unmerged.base.binary) {
      const baseLines = splitKeptLines(unmerged.base.content);
      if (baseLines.length > 5000) truncated = true;
      base = truncated ? baseLines.slice(0, 5000) : baseLines;
    }

    return { path: file, binary: false, truncated, lines: lines.length, sections, base, stages };
  },

  /**
   * Write a merged file back into the working tree and mark it resolved.
   *
   * Only writing is safe here: what the result should be is the user's call,
   * and staging happens only after the marker check, which keeps a half-chosen
   * file out of the index.
   */
  async 'conflicts.resolve'({ path, file, content, remove = false }) {
    const target = await conflictFilePath(path, file);
    const status = parseStatus(await git(path, STATUS_ARGS));
    if (!status.files.some((f) => f.path === file && f.state === 'conflicted')) {
      throw new GitError(`${file} is no longer in conflict.`, { command: '', stderr: '', code: 1 });
    }

    // Keeping the side that deleted the file: `git rm` is how Git records
    // that resolution. Only a conflict where one side has no stage can end
    // this way.
    if (remove) {
      const unmerged = await readUnmerged(path, file);
      if (unmerged.ours && unmerged.theirs) {
        throw new GitError(`Neither side deleted ${file}, so it cannot be resolved by deleting it.`, { command: '', stderr: '', code: 1 });
      }
      await git(path, ['rm', '-q', '-f', '--', file]);
      return { ok: true, resolved: 1 };
    }

    if (typeof content !== 'string') {
      throw new GitError('No merged content was given.', { command: '', stderr: '', code: 1 });
    }
    if (content.includes('\0')) {
      throw new GitError('The merged content is not text.', { command: '', stderr: '', code: 1 });
    }
    // Checked before anything is written, so a refused result leaves the
    // file exactly as Git left it.
    if (/^<{7} /m.test(content)) {
      throw new GitError(
        `The merged ${file} would still contain conflict markers. Choose a side for every conflict first.`,
        { command: '', stderr: '', code: 1 }
      );
    }

    await writeFile(target, content);
    return resolveConflicts(path, [file]);
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

    // What each file holds now is lost to Git once it is checked out, so it
    // is saved first, and the Undo panel can put it back.
    const saved = [];
    for (const p of inHead) {
      const blob = await saveWorkingFile(path, p);
      if (blob) saved.push({ p, blob });
    }

    if (notInHead.length > 0) await git(path, ['reset', '-q', '--', ...notInHead]);
    if (inHead.length > 0) {
      await git(path, ['reset', '-q', '--', ...inHead]);
      await git(path, ['checkout', '--', ...inHead]);
    }
    for (const { p, blob } of saved) {
      const { stdout: now } = await runGit(path, ['hash-object', '--', p], { allowFailure: true });
      await recovery.record(path, {
        operation: 'changes.rollback', label: `Rolled back ${p}`,
        target: { kind: 'file', name: p }, before: blob, after: now.trim() || null
      }).catch(() => {});
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

/* ------------------------------------------------------------------ *
 * The smart console
 * ------------------------------------------------------------------ */

const CONSOLE_OUTPUT_LIMIT = 2 * 1024 * 1024;
const CONSOLE_TIMEOUT_MS = 5 * 60 * 1000;

/** The environment every console command runs in: no pager, no editor, no prompt. */
const CONSOLE_ENV = {
  GIT_PAGER: 'cat', PAGER: 'cat', GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true',
  GIT_MERGE_AUTOEDIT: 'no', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never'
};

/** Arguments that are not options, after the command's own. */
const positionals = (rest) => {
  const out = [];
  let paths = false;
  for (const a of rest) {
    if (a === '--') { paths = true; continue; }
    if (!paths && a.startsWith('-')) continue;
    out.push(a);
  }
  return out;
};
const pathsAfterDashes = (rest) => (rest.includes('--') ? rest.slice(rest.indexOf('--') + 1) : []);

async function resolvesToCommit(path, name) {
  if (!name) return null;
  const { stdout, code } = await runGit(path, ['rev-parse', '--verify', '--quiet', `${name}^{commit}`], { allowFailure: true });
  return code === 0 ? stdout.trim() : null;
}

/** Changed files among these paths, as a list: the ones a checkout would overwrite. */
async function changedAmong(path, paths) {
  const { stdout } = await runGit(path, ['diff', '--name-only', '-z', '--', ...(paths.length ? paths : ['.'])], { allowFailure: true });
  return stdout.split('\0').filter(Boolean);
}

/**
 * What a command is about to do, in a few lines, and how risky it is. This
 * is the line under the console's input. It reads the repository but never
 * changes it, so it can run on every key press.
 */
async function consolePreview(path, sub, rest) {
  let level = consoleRules.riskOf(sub, rest);
  const lines = [];
  const pos = positionals(rest);
  const branch = await recovery.currentBranch(path);

  if (sub === 'reset' && level === 'danger') {
    const target = pos[0] ?? 'HEAD';
    const commit = await resolvesToCommit(path, target);
    if (!commit) {
      level = 'write';
      lines.push(`Unstages ${pos.join(', ')}. The files keep their changes.`);
    } else {
      const { stdout: back } = await runGit(path, ['rev-list', '--count', `${commit}..HEAD`], { allowFailure: true });
      const n = Number(back.trim() || 0);
      const mode = rest.find((a) => ['--hard', '--soft', '--mixed', '--keep', '--merge'].includes(a)) ?? '--mixed';
      lines.push(`Moves ${branch ?? 'HEAD'} to ${commit.slice(0, 7)}${n ? `, ${n} commit${n === 1 ? '' : 's'} back` : ''}.`);
      if (mode === '--hard') {
        const changed = await changedAmong(path, []);
        const { stdout: staged } = await runGit(path, ['diff', '--cached', '--name-only'], { allowFailure: true });
        const lost = new Set([...changed, ...staged.split('\n').filter(Boolean)]);
        if (lost.size) lines.push(`Throws away your changes to ${lost.size} file${lost.size === 1 ? '' : 's'}.`);
        else if (n === 0) level = 'write';
      } else if (mode === '--soft') lines.push('The changes of those commits stay staged.');
      else lines.push('The changes of those commits stay in your files, unstaged.');
    }
  } else if (sub === 'clean' && level === 'danger') {
    const dry = rest.filter((a) => a !== '--force').map((a) => (/^-[a-zA-Z]+$/.test(a) ? a.replace(/f/g, '') : a)).filter((a) => a !== '-');
    const { stdout } = await runGit(path, ['clean', '-n', ...dry], { allowFailure: true });
    const gone = stdout.split('\n').filter((l) => l.startsWith('Would remove ')).map((l) => l.slice(13));
    lines.push(gone.length ? `Deletes ${gone.length} untracked item${gone.length === 1 ? '' : 's'}: ${gone.slice(0, 5).join(', ')}${gone.length > 5 ? ', …' : ''}.` : 'Nothing to delete.');
    if (!gone.length) level = 'read';
  } else if ((sub === 'checkout' || sub === 'restore') && level === 'danger') {
    const paths = sub === 'restore' ? pos : pathsAfterDashes(rest).length ? pathsAfterDashes(rest) : pos.filter((p) => p === '.');
    const changed = await changedAmong(path, paths);
    lines.push(changed.length ? `Throws away your changes to ${changed.length} file${changed.length === 1 ? '' : 's'}: ${changed.slice(0, 4).join(', ')}${changed.length > 4 ? ', …' : ''}.` : 'None of these files has changes to lose.');
  } else if (sub === 'branch' && level === 'danger') {
    for (const name of pos) {
      const { stdout, code } = await runGit(path, ['rev-list', '--count', `HEAD..refs/heads/${name}`], { allowFailure: true });
      if (code === 0) lines.push(`Deletes ${name}${Number(stdout.trim()) ? `, and its ${stdout.trim()} commits not on ${branch ?? 'HEAD'}` : ''}.`);
    }
  } else if (sub === 'push' && level === 'danger') {
    const name = pos.find((p) => !p.includes('/') && p !== 'origin') ?? branch;
    const { stdout: upstream } = await runGit(path, ['for-each-ref', '--format=%(upstream:short)', `refs/heads/${name}`], { allowFailure: true });
    if (upstream.trim()) {
      const { stdout: lost } = await runGit(path, ['rev-list', '--count', `refs/heads/${name}..${upstream.trim()}`], { allowFailure: true });
      lines.push(Number(lost.trim()) ? `Replaces ${upstream.trim()}; its ${lost.trim()} commits that ${name} does not have are removed from the remote.` : `Replaces ${upstream.trim()} with ${name}.`);
    } else lines.push('Rewrites what the remote has.');
  } else if (sub === 'rebase' && level === 'danger') {
    const onto = pos[0];
    const base = onto && (await resolvesToCommit(path, onto));
    if (base) {
      const { stdout: n } = await runGit(path, ['rev-list', '--count', `${base}..HEAD`], { allowFailure: true });
      lines.push(`Replays ${n.trim()} commit${n.trim() === '1' ? '' : 's'} of ${branch ?? 'HEAD'} onto ${onto}. They get new hashes.`);
    }
  } else if (sub === 'commit' && level === 'danger') {
    lines.push('Replaces the last commit with a new one. If it is pushed, publishing needs a force push.');
  } else if (sub === 'stash' && level === 'danger') {
    lines.push(rest[0] === 'clear' ? 'Deletes every stash.' : `Deletes ${pos[1] ?? 'stash@{0}'}.`);
  } else if (sub === 'rm' && level === 'danger') {
    lines.push(`Deletes ${pos.join(', ')} from your files and stages the deletion.`);
  }
  if (level === 'danger') lines.push('A recovery point is saved first, so the Undo panel can put it back.');
  return { level, lines };
}

/**
 * Save what a risky command could lose, before it runs. Returns a function
 * to call once it has run, which writes the entries to the operation log.
 */
async function consoleRecovery(path, sub, rest, label) {
  const pos = positionals(rest);
  const records = [];
  const onRef = async (ref, target) => {
    const before = await recovery.resolveRef(path, ref);
    if (before) records.push({ ref, target, before });
  };
  const branch = await recovery.currentBranch(path);
  if ((sub === 'reset' && (await resolvesToCommit(path, pos[0] ?? 'HEAD'))) || sub === 'rebase' || (sub === 'commit' && rest.includes('--amend'))) {
    if (branch) await onRef(`refs/heads/${branch}`, { kind: 'branch', name: branch });
  }
  if (sub === 'reset' && rest.includes('--hard') || sub === 'checkout' || sub === 'restore' || sub === 'rm') {
    const paths = sub === 'reset' ? [] : sub === 'checkout' ? pathsAfterDashes(rest) : pos;
    if (sub !== 'checkout' || paths.length || pos.includes('.')) {
      for (const file of (await changedAmong(path, paths)).slice(0, 100)) {
        const blob = await saveWorkingFile(path, file);
        if (blob) records.push({ blob, target: { kind: 'file', name: file } });
      }
    }
  }
  if (sub === 'clean') {
    const dry = rest.map((a) => (/^-[a-zA-Z]+$/.test(a) ? a.replace(/f/g, '') : a)).filter((a) => a !== '-' && a !== '--force');
    const { stdout } = await runGit(path, ['clean', '-n', ...dry], { allowFailure: true });
    for (const item of stdout.split('\n').filter((l) => l.startsWith('Would remove ')).map((l) => l.slice(13)).filter((f) => !f.endsWith('/')).slice(0, 200)) {
      const blob = await saveWorkingFile(path, item);
      if (blob) records.push({ blob, target: { kind: 'file', name: item } });
    }
  }
  if (sub === 'branch') for (const name of pos) await onRef(`refs/heads/${name}`, { kind: 'branch', name });
  if (sub === 'tag' && (rest.includes('-d') || rest.includes('--delete'))) for (const name of pos) await onRef(`refs/tags/${name}`, { kind: 'tag', name });
  if (sub === 'stash' && ['drop', 'clear'].includes(rest[0])) {
    const { stdout } = await runGit(path, ['stash', 'list', '--format=%gd%x00%H%x00%gs'], { allowFailure: true });
    for (const line of stdout.split('\n').filter(Boolean)) {
      const [ref, sha, message] = line.split('\0');
      if (rest[0] === 'clear' || ref === (pos[1] ?? 'stash@{0}')) records.push({ blob: sha, target: { kind: 'stash', name: ref }, detail: message });
    }
  }
  if (sub === 'push') {
    const name = pos.find((p) => !p.includes('/') && p !== 'origin') ?? branch;
    const { stdout } = await runGit(path, ['for-each-ref', '--format=%(upstream)', `refs/heads/${name}`], { allowFailure: true });
    if (stdout.trim()) await onRef(stdout.trim(), { kind: 'remote', name: stdout.trim().replace(/^refs\/remotes\//, '') });
  }
  return async () => {
    let n = 0;
    for (const r of records) {
      const after = r.ref ? await recovery.resolveRef(path, r.ref) : null;
      const before = r.before ?? r.blob;
      if (r.ref && after === before) continue;
      await recovery.record(path, { operation: 'console', label, target: r.target, before, after, detail: r.detail ?? null }).catch(() => {});
      n++;
    }
    return n;
  };
}

/** A read command's result as data the console can draw, where it has a picture for it. */
async function consoleView(path, sub, rest, stdout) {
  if (sub === 'status') return { kind: 'status', data: parseStatus(await git(path, STATUS_ARGS)) };
  if (sub === 'log' && !rest.some((a) => /^(-p|--patch|--stat|--numstat|--shortstat|--name-only|--name-status|--format|--pretty|-L|--follow)/.test(a))) {
    const max = rest.find((a) => /^(-n|--max-count=|-\d+$)/.test(a));
    const args = rest.filter((a) => !['--oneline', '--graph', '--decorate', '--all'].includes(a));
    const { stdout: out, code } = await runGit(path, [
      'log', `--pretty=format:${LOG_FORMAT}`, '--decorate=full', ...(max ? [] : ['-n', '50']),
      ...(rest.includes('--all') ? ['--exclude=refs/stash', `--exclude=${recovery.RECOVERY_PREFIX}*`, '--all'] : []), ...args
    ], { allowFailure: true, env: CONSOLE_ENV });
    if (code === 0) return { kind: 'log', data: { commits: parseLog(out), limited: !max } };
  }
  if (sub === 'branch' && consoleRules.riskOf(sub, rest) === 'read' && !rest.includes('--show-current')) {
    return { kind: 'branches', data: await methods['branches.list']({ path }) };
  }
  if (sub === 'stash' && rest[0] === 'list') return { kind: 'stashes', data: await methods['stash.list']({ path }) };
  if ((sub === 'diff' || sub === 'show') && /^diff --git /m.test(stdout)) return { kind: 'patch', data: null };
  return { kind: 'text', data: null };
}

methods['console.preview'] = async ({ path, line }) => {
  const { args, error } = consoleRules.tokenize(String(line ?? ''));
  if (!args) return { ok: false, error };
  const args2 = args[0] === 'git' ? args.slice(1) : args;
  const check = consoleRules.checkCommand(args2);
  if (!check.ok) return { ok: false, error: check.error, redirect: check.redirect ?? null };
  return { ok: true, ...(await consolePreview(path, check.sub, check.rest)) };
};

/**
 * Run one Git command typed in the console.
 *
 * Nothing risky runs unconfirmed: the first call answers with what it would
 * do, and the page runs it again with `confirmed` once the user agrees.
 * Before a risky command runs, what it could lose is saved for the Undo
 * panel. A command that shows something comes back as data too, so the
 * console can draw it rather than print it.
 */
methods['console.run'] = async ({ path, line, confirmed = false }) => {
  const typed = String(line ?? '').trim();
  const { args, error } = consoleRules.tokenize(typed);
  if (!args) return { ok: false, error };
  const argv = args[0] === 'git' ? args.slice(1) : args;
  const check = consoleRules.checkCommand(argv);
  if (!check.ok) return { ok: false, error: check.error, redirect: check.redirect ?? null };
  const { sub, rest } = check;

  const preview = await consolePreview(path, sub, rest);
  if (preview.level === 'danger' && !confirmed) return { ok: false, needsConfirm: true, preview };

  const label = `Console: git ${argv.join(' ')}`.slice(0, 120);
  const finish = preview.level === 'danger' ? await consoleRecovery(path, sub, rest, label) : null;

  const started = Date.now();
  const { stdout, stderr, code } = await new Promise((done) => {
    execFile('git', argv, {
      cwd: path, env: { ...process.env, ...CONSOLE_ENV }, maxBuffer: CONSOLE_OUTPUT_LIMIT,
      timeout: CONSOLE_TIMEOUT_MS, windowsHide: true
    }, (err, out, errOut) => done({
      stdout: String(out ?? ''), stderr: String(errOut ?? '') + (err?.killed ? '\nThe command took too long and was stopped.' : err?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? '\nThe output was too long, so it was cut.' : ''),
      code: err ? (typeof err.code === 'number' ? err.code : 1) : 0
    }));
  });
  const recorded = code === 0 && finish ? await finish() : 0;
  const view = code === 0 ? await consoleView(path, sub, rest, stdout) : { kind: 'text', data: null };
  return {
    ok: code === 0, code, stdout, stderr, ms: Date.now() - started, level: preview.level,
    changed: preview.level !== 'read', recorded, ...view,
    explanation: code === 0 ? null : consoleRules.explainError(`${stderr}\n${stdout}`)
  };
};

/* ------------------------------------------------------------------ *
 * GitHub
 * ------------------------------------------------------------------ */

/** The repository on GitHub and a token for it, or an error saying which is missing. */
async function githubContext(path) {
  const repo = await githubRepo(path);
  if (!repo) throw new GitError('This repository has no remote on github.com.', { command: '', stderr: '', code: 1 });
  const { token } = await githubToken();
  if (!token) {
    throw new GitError('No GitHub token. Add one in Settings, set GITHUB_TOKEN, or sign in with the GitHub CLI (gh auth login).', { command: '', stderr: '', code: 1 });
  }
  return { ...repo, token };
}

const asGitError = (err) => (err instanceof GitError ? err : new GitError(err.message, { command: '', stderr: '', code: 1 }));

/**
 * Whether this repository is on GitHub and Gitalia can talk to it. The page
 * asks this first, and shows GitHub features only when both are true.
 */
methods['github.status'] = async ({ path }) => {
  const repo = await githubRepo(path);
  const { token, source } = await githubToken();
  if (!repo || !token) return { repo, connected: false, tokenSource: source, login: null, defaultBranch: null };
  try {
    const [user, info] = await Promise.all([
      github(token, 'GET', '/user').catch(() => null),
      github(token, 'GET', `/repos/${repo.owner}/${repo.name}`)
    ]);
    return { repo, connected: true, tokenSource: source, login: user?.login ?? null, defaultBranch: info?.default_branch ?? null, private: !!info?.private };
  } catch (err) {
    return { repo, connected: false, tokenSource: source, login: null, defaultBranch: null, error: err.message };
  }
};

/** The repository's pull requests, open ones by default, newest change first. */
methods['github.pulls'] = async ({ path, state = 'open' }) => {
  if (!['open', 'closed', 'all'].includes(state)) throw new GitError('Show open, closed or all pull requests.', { command: '', stderr: '', code: 1 });
  const { owner, name, token } = await githubContext(path);
  try {
    const list = await github(token, 'GET', `/repos/${owner}/${name}/pulls?state=${state}&sort=updated&direction=desc&per_page=50`);
    return { pulls: list.map(shapePull) };
  } catch (err) {
    throw asGitError(err);
  }
};

/**
 * Open a pull request for a branch of this repository.
 *
 * The branch must already be on GitHub with every commit pushed: a pull
 * request is made from what GitHub has, and asking for one while commits are
 * still only here would quietly leave them out.
 */
methods['github.createPull'] = async ({ path, branch, base, title, body = '', draft = false }) => {
  const head = commitish(branch, 'the branch');
  const into = commitish(base, 'the base branch');
  if (typeof title !== 'string' || !title.trim()) throw new GitError('A pull request needs a title.', { command: '', stderr: '', code: 1 });
  const { owner, name, token, remote } = await githubContext(path);

  const { stdout: upstream, code } = await runGit(path, ['for-each-ref', '--format=%(upstream:short)', `refs/heads/${head}`], { allowFailure: true });
  if (code !== 0 || !upstream.trim().startsWith(`${remote}/`)) {
    throw new GitError(`${head} is not on ${remote} yet. Push it first, then open the pull request.`, { command: '', stderr: '', code: 1 });
  }
  const { stdout: ahead } = await runGit(path, ['rev-list', '--count', `${upstream.trim()}..refs/heads/${head}`], { allowFailure: true });
  if (Number(ahead.trim() || 0) > 0) {
    throw new GitError(`${head} has ${ahead.trim()} commits not pushed yet. Push them first, so the pull request has them.`, { command: '', stderr: '', code: 1 });
  }
  const remoteBranch = upstream.trim().slice(remote.length + 1);
  try {
    const pr = await github(token, 'POST', `/repos/${owner}/${name}/pulls`, { title: title.trim(), body, head: remoteBranch, base: into, draft: !!draft });
    return { ok: true, pull: shapePull(pr) };
  } catch (err) {
    throw asGitError(err);
  }
};

/** The checks of some commits, at most 20, by hash. */
methods['github.checks'] = async ({ path, shas }) => {
  if (!Array.isArray(shas) || shas.length === 0) return { checks: {} };
  const wanted = [...new Set(shas)].slice(0, 20).map((s) => {
    if (typeof s !== 'string' || !/^[0-9a-f]{7,40}$/i.test(s)) throw new GitError('Checks are read by commit hash.', { command: '', stderr: '', code: 1 });
    return s;
  });
  const { owner, name, token } = await githubContext(path);
  const results = await Promise.all(wanted.map((sha) => commitChecks(token, owner, name, sha)));
  return { checks: Object.fromEntries(results.map((r) => [r.sha, r])) };
};

/* ------------------------------------------------------------------ *
 * AI explanations
 * ------------------------------------------------------------------ */

const subjectOf = async (path, rev) => {
  const { stdout, code } = await runGit(path, ['log', '-1', '--format=%h %s', rev, '--'], { allowFailure: true });
  return code === 0 ? stdout.trim() : null;
};

/**
 * What the model is shown for each kind of explanation, gathered here so the
 * page never builds it and a model only ever sees this repository's history.
 */
const EXPLAIN_MATERIAL = {
  /** A commit: its full message, the files it touched, and its diff. */
  async commit({ path, hash }) {
    const rev = commitish(hash, 'the commit');
    const stat = await git(path, ['-c', 'core.quotepath=false', 'show', '--stat', '--format=', rev, '--']);
    const shown = await git(path, ['-c', 'core.quotepath=false', 'show', '--format=fuller', '--patch', '--find-renames', rev, '--']);
    return { material: shown, stat };
  },

  /**
   * A conflicted file: which two commits are being combined, and each
   * conflict block with the lines on either side.
   */
  async conflict({ path, file }) {
    const offer = await methods['conflicts.read']({ path, file });
    const operation = await detectOperation(path);
    const incoming = { merge: 'MERGE_HEAD', 'cherry-pick': 'CHERRY_PICK_HEAD', revert: 'REVERT_HEAD' }[operation];
    let theirs = incoming ? await subjectOf(path, incoming) : null;
    if (operation === 'rebase') {
      const stop = await rebaseStopInfo(path);
      if (stop.sha) theirs = await subjectOf(path, stop.sha);
    }
    const lines = [
      `Operation: ${operation ?? 'unknown'}${operation === 'rebase' ? ' (ours is the branch being rebased onto, theirs is the commit being replayed)' : ''}`,
      `File: ${file}`,
      `Ours: ${await subjectOf(path, 'HEAD') ?? 'HEAD'}`,
      `Theirs: ${theirs ?? 'the incoming side'}`,
      ''
    ];
    let n = 0;
    for (const section of offer.sections) {
      if (section.type !== 'conflict') continue;
      n++;
      lines.push(`Conflict ${n}:`, '<ours>', section.ours.join('').trimEnd(), '</ours>', '<theirs>', section.theirs.join('').trimEnd(), '</theirs>', '');
    }
    if (offer.base) lines.push('The common ancestor of the file:', '<base>', offer.base.join('').trimEnd(), '</base>');
    return { material: lines.join('\n'), stat: `${file}: ${n} conflict ${n === 1 ? 'block' : 'blocks'}` };
  },

  /** Two branches: where they split, the commits each made, and what changed since. */
  async branches({ path, base, target }) {
    const r = await methods['compare.refs']({ path, base, target, mode: 'split' });
    // The names people use: `main`, not `refs/heads/main`.
    const short = (ref) => ref.replace(/^refs\/(heads|remotes|tags)\//, '');
    base = short(base);
    target = short(target);
    const list = (side) => side.commits.slice(0, 60).map((c) => `- ${c.shortHash} ${c.subject} (${c.author})`).join('\n') || '- none';
    const stat = r.files.map((f) => `${f.path} +${f.added ?? '?'} -${f.removed ?? '?'}`).join('\n');
    const diff = await git(path, ['-c', 'core.quotepath=false', 'diff', '--find-renames', r.from, r.to, '--']);
    return {
      material: [
        `First side: ${base}. Second side: ${target}.`,
        r.mergeBase ? `They split at ${await subjectOf(path, r.mergeBase)}.` : 'They share no history.',
        `Commits only on ${target}:`, list(r.onlyInTarget),
        `Commits only on ${base}:`, list(r.onlyInBase),
        `What ${target} changed since the split:`, diff
      ].join('\n'),
      stat
    };
  },

  /** A confirmation dialog, as the page showed it. */
  async operation({ path, text }) {
    if (typeof text !== 'string' || !text.trim()) throw new GitError('Nothing to explain.', { command: '', stderr: '', code: 1 });
    const branch = await runGit(path, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true });
    return { material: `${text.slice(0, 4000)}\n\nCurrent branch: ${branch.stdout.trim() || 'detached HEAD'}`, stat: '' };
  }
};

/**
 * Ask the configured AI provider to explain a commit, a conflict, two
 * branches, or an operation about to run. Nothing in the repository changes.
 */
methods['ai.explain'] = async (args) => {
  const gather = EXPLAIN_MATERIAL[args.kind];
  if (!gather) throw new GitError(`Gitalia cannot explain "${args.kind}".`, { command: '', stderr: '', code: 1 });
  const { material, stat } = await gather(args);
  try {
    return await explain({ kind: args.kind, material, stat, provider: args.provider ?? null });
  } catch (err) {
    throw new GitError(err.message, { command: '', stderr: '', code: 1 });
  }
};

/* ------------------------------------------------------------------ *
 * Patches and bundles
 * ------------------------------------------------------------------ */

/** A file name from a commit subject: lower case, dashes, at most 50 letters. */
function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'change';
}

/** Run `body` with a scratch folder, removed afterwards whatever happens. */
async function withScratch(body) {
  const dir = await mkdtemp(join(tmpdir(), 'gitalia-'));
  try {
    return await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Commits as a patch file, the way `git format-patch` writes them: author,
 * date and message kept, oldest first, so `git am` can replay them.
 */
methods['patch.create'] = async ({ path, hashes }) => {
  if (!Array.isArray(hashes) || hashes.length === 0) {
    throw new GitError('Choose at least one commit.', { command: '', stderr: '', code: 1 });
  }
  const commits = hashes.map((h) => commitish(h, 'a commit'));
  // Oldest first, whatever order they were picked in.
  const { stdout: order } = await runGit(path, ['rev-list', '--no-walk=sorted', '--reverse', ...commits, '--'], { allowFailure: true });
  const ordered = order.split('\n').filter(Boolean);
  let content = '';
  for (const [i, hash] of ordered.entries()) {
    const { stdout, code, stderr } = await runGit(path, [
      'format-patch', '-1', '--stdout', `--start-number=${i + 1}`, ...(ordered.length > 1 ? ['--numbered'] : []), hash
    ], { allowFailure: true });
    if (code !== 0) throw new GitError(stderr.trim() || 'Git could not write the patch.', { command: 'git format-patch', stderr, code });
    content += stdout;
  }
  const { stdout: subject } = await runGit(path, ['log', '-1', '--format=%s', ordered[ordered.length - 1]], { allowFailure: true });
  const name = ordered.length === 1
    ? `${ordered[0].slice(0, 7)}-${slug(subject.trim())}.patch`
    : `${ordered.length}-commits-to-${ordered[ordered.length - 1].slice(0, 7)}.patch`;
  return { name, content, commits: ordered.length };
};

/**
 * Apply a patch file.
 *
 * A patch written by `git format-patch` carries its commits, so `git am`
 * replays them as commits, author and message included. Any other diff only
 * changes the files, which then wait in the commit panel. Both are checked
 * first, so a patch that does not fit changes nothing; one that fails part
 * way through `git am` is abandoned, leaving the branch as it was.
 */
methods['patch.apply'] = async ({ path, patch }) => {
  if (typeof patch !== 'string' || !patch.trim()) {
    throw new GitError('The patch is empty.', { command: '', stderr: '', code: 1 });
  }
  const operation = await detectOperation(path);
  if (operation) throw new GitError(`A ${operation} is in progress. Finish or abandon it first.`, { command: '', stderr: '', code: 1 });
  const mailbox = /^From [0-9a-f]{40} /m.test(patch);
  return withScratch(async (dir) => {
    const file = join(dir, 'change.patch');
    await writeFile(file, patch);
    if (mailbox) {
      const { stdout: before } = await runGit(path, ['rev-parse', 'HEAD'], { allowFailure: true });
      const { code, stderr } = await runGit(path, ['am', '--quiet', '--', file], { allowFailure: true });
      if (code !== 0) {
        await runGit(path, ['am', '--abort'], { allowFailure: true });
        throw new GitError(
          `The patch does not apply to this branch, so nothing was changed.\n\n${stderr.trim()}`,
          { command: 'git am', stderr, code }
        );
      }
      const { stdout: count } = await runGit(path, ['rev-list', '--count', `${before.trim()}..HEAD`], { allowFailure: true });
      return { ok: true, mode: 'commits', commits: Number(count.trim() || 0) };
    }
    const check = await runGit(path, ['apply', '--check', '--', file], { allowFailure: true });
    if (check.code !== 0) {
      throw new GitError(
        `The patch does not apply to the files as they are, so nothing was changed.\n\n${check.stderr.trim()}`,
        { command: 'git apply --check', stderr: check.stderr, code: check.code }
      );
    }
    await git(path, ['apply', '--', file]);
    return { ok: true, mode: 'files', commits: 0 };
  });
};

/**
 * Every branch and tag in one file that `git clone` or `git fetch` can read,
 * for moving a repository without a server. Sent back as base64.
 */
methods['bundle.create'] = async ({ path }) => withScratch(async (dir) => {
  const file = join(dir, 'repo.bundle');
  const { code, stderr } = await runGit(path, ['bundle', 'create', '--quiet', file, '--branches', '--tags'], { allowFailure: true });
  if (code !== 0) throw new GitError(stderr.trim() || 'Git could not write the bundle.', { command: 'git bundle create', stderr, code });
  const data = await readFile(file);
  return { name: `${basename(path)}.bundle`, bytes: data.length, base64: data.toString('base64') };
});

/**
 * Bring the branches and tags of a bundle file in, the way a fetch from a
 * remote would: its branches arrive as `<name>/<branch>`, and no branch of
 * this repository moves.
 */
methods['bundle.import'] = async ({ path, base64, name }) => {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new GitError('Name the bundle with letters, numbers, dots, dashes or underscores.', { command: '', stderr: '', code: 1 });
  }
  if (typeof base64 !== 'string' || !base64) throw new GitError('The bundle file is empty.', { command: '', stderr: '', code: 1 });
  return withScratch(async (dir) => {
    const file = join(dir, 'in.bundle');
    await writeFile(file, Buffer.from(base64, 'base64'));
    const verify = await runGit(path, ['bundle', 'verify', '--quiet', file], { allowFailure: true });
    if (verify.code !== 0) {
      throw new GitError(`This is not a bundle Git can read here.\n\n${verify.stderr.trim()}`, { command: 'git bundle verify', stderr: verify.stderr, code: verify.code });
    }
    const { stdout: heads } = await runGit(path, ['bundle', 'list-heads', file], { allowFailure: true });
    const branches = heads.split('\n').map((l) => l.split(' ')[1]).filter((r) => r?.startsWith('refs/heads/')).map((r) => r.slice(11));
    const args = ['fetch', '--quiet', '--no-write-fetch-head', file, `+refs/heads/*:refs/remotes/${name}/*`, 'refs/tags/*:refs/tags/*'];
    const { code, stderr } = await runGit(path, args, { allowFailure: true });
    if (code !== 0) throw new GitError(stderr.trim() || 'Git could not read the bundle.', { command: 'git fetch <bundle>', stderr, code });
    return { ok: true, branches: branches.map((b) => `${name}/${b}`) };
  });
};

/* ------------------------------------------------------------------ *
 * Image diffs
 * ------------------------------------------------------------------ */

const IMAGE_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif', svg: 'image/svg+xml'
};
const IMAGE_LIMIT = 20 * 1024 * 1024;

/** The picture a blob holds, or null when there is no such blob. */
async function imageBlob(path, spec) {
  const { stdout, code } = await runGit(path, ['cat-file', 'blob', spec], { allowFailure: true, binary: true });
  return code === 0 ? stdout : null;
}

/**
 * The two versions of an image, for the diff viewer to show side by side.
 *
 * The same four cases as `diff.file`: a commit against its parent (or `base`),
 * the index against HEAD (`staged`), the working tree against the index
 * (`unstaged`), and an untracked file, which has no before. Each side is a
 * data URL, or null when that side has no file. A side too large to send
 * says so instead.
 */
methods['diff.image'] = async ({ path, file, origPath = null, hash = null, base = null, side = null }) => {
  const ext = /\.([a-z0-9]+)$/i.exec(file)?.[1]?.toLowerCase();
  const type = ext && IMAGE_TYPES[ext];
  if (!type) throw new GitError(`${file} is not an image Gitalia can show.`, { command: '', stderr: '', code: 1 });
  const target = workPath(path, file);
  const oldName = origPath ?? file;

  let before = null, after = null;
  if (hash) {
    const parent = base ?? (await firstParentOf(path, hash));
    before = parent === hash ? null : await imageBlob(path, `${parent}:${oldName}`);
    after = await imageBlob(path, `${hash}:${file}`);
  } else if (side === 'staged') {
    before = await imageBlob(path, `HEAD:${oldName}`);
    after = await imageBlob(path, `:${file}`);
  } else {
    // The working tree against the index, or against HEAD when nothing of it
    // is staged; an untracked file has only the working-tree side.
    before = (await imageBlob(path, `:${oldName}`)) ?? (await imageBlob(path, `HEAD:${oldName}`));
    after = await readFile(target).catch(() => null);
  }

  const encode = (buffer) => {
    if (!buffer) return null;
    if (buffer.length > IMAGE_LIMIT) return { tooLarge: true, bytes: buffer.length, url: null };
    return { tooLarge: false, bytes: buffer.length, url: `data:${type};base64,${buffer.toString('base64')}` };
  };
  return { file, type, before: encode(before), after: encode(after) };
};

/* ------------------------------------------------------------------ *
 * Git LFS
 * ------------------------------------------------------------------ */

/** Run git-lfs, which may not be installed. */
async function lfs(path, args) {
  return runGit(path, ['lfs', ...args], { allowFailure: true });
}

/**
 * How this repository uses Git LFS.
 *
 * - `installed`: git-lfs is on this computer.
 * - `ready`: its filters are set up, globally or for this repository, so
 *   tracked files are stored in LFS and their content is fetched on checkout.
 * - `patterns`: what `.gitattributes` sends to LFS.
 * - `files`: every LFS file at HEAD, and whether its content is here or only
 *   its pointer is.
 */
methods['lfs.status'] = async ({ path }) => {
  const { stdout: version, code } = await lfs(path, ['version']);
  if (code !== 0) {
    // Without git-lfs the patterns can still be read, so the user learns
    // that the repository needs it.
    const { stdout: attrs } = await runGit(path, ['show', 'HEAD:.gitattributes'], { allowFailure: true });
    const patterns = attrs.split('\n')
      .filter((l) => /\bfilter=lfs\b/.test(l))
      .map((l) => ({ pattern: l.trim().split(/\s+/)[0], source: '.gitattributes' }));
    return { installed: false, version: null, ready: false, patterns, files: [] };
  }
  const { stdout: clean } = await runGit(path, ['config', '--get', 'filter.lfs.clean'], { allowFailure: true });
  const { stdout: tracked } = await lfs(path, ['track', '--json']);
  let patterns = [];
  try {
    patterns = (JSON.parse(tracked).patterns ?? []).map((p) => ({ pattern: p.pattern, source: p.source }));
  } catch { /* an old git-lfs without --json lists nothing */ }
  const { stdout: listed } = await lfs(path, ['ls-files', '--json']);
  let files = [];
  try {
    files = (JSON.parse(listed).files ?? []).map((f) => ({ path: f.name, size: f.size, oid: f.oid, downloaded: !!f.downloaded }));
  } catch { /* an empty repository has nothing to list */ }
  return { installed: true, version: version.trim().split(' ')[0], ready: !!clean.trim(), patterns, files };
};

const lfsPattern = (pattern) => {
  if (typeof pattern !== 'string' || !pattern.trim() || pattern.startsWith('-') || /[\n\0]/.test(pattern)) {
    throw new GitError('Name a file pattern, such as *.psd.', { command: '', stderr: '', code: 1 });
  }
  return pattern.trim();
};

/** Set LFS up for this repository alone, leaving the global Git settings alone. */
methods['lfs.install'] = async ({ path }) => {
  const { code, stderr } = await lfs(path, ['install', '--local']);
  if (code !== 0) throw new GitError(stderr.trim() || 'Git LFS could not be set up.', { command: 'git lfs install --local', stderr, code });
  return methods['lfs.status']({ path });
};

/**
 * Send files matching a pattern to LFS from now on. This writes
 * `.gitattributes`, which then waits in the commit panel like any change.
 * Files already committed stay as they are until they are changed again.
 */
methods['lfs.track'] = async ({ path, pattern }) => {
  const { code, stderr } = await lfs(path, ['track', '--', lfsPattern(pattern)]);
  if (code !== 0) throw new GitError(stderr.trim() || 'Git LFS could not track that pattern.', { command: 'git lfs track', stderr, code });
  return methods['lfs.status']({ path });
};

methods['lfs.untrack'] = async ({ path, pattern }) => {
  const { code, stderr } = await lfs(path, ['untrack', '--', lfsPattern(pattern)]);
  if (code !== 0) throw new GitError(stderr.trim() || 'Git LFS could not stop tracking that pattern.', { command: 'git lfs untrack', stderr, code });
  return methods['lfs.status']({ path });
};

/** Download the content of every LFS file at HEAD and put it in place. */
methods['lfs.pull'] = async ({ path }) => {
  const { code, stderr } = await lfs(path, ['pull']);
  if (code !== 0) throw new GitError(stderr.trim() || 'Git LFS could not download the files.', { command: 'git lfs pull', stderr, code });
  return methods['lfs.status']({ path });
};

/* ------------------------------------------------------------------ *
 * Commit signing
 * ------------------------------------------------------------------ */

/**
 * How this repository signs commits, from Git's configuration.
 *
 * `available` is true when there is something to sign with: a signing key
 * named in `user.signingkey`, or an OpenPGP setup where gpg picks the key
 * itself from the committer's email.
 */
methods['commit.signing'] = async ({ path }) => {
  const get = async (key) => {
    const { stdout, code } = await runGit(path, ['config', '--get', key], { allowFailure: true });
    return code === 0 ? stdout.trim() : null;
  };
  const format = (await get('gpg.format')) ?? 'openpgp';
  const key = await get('user.signingkey');
  const always = ((await get('commit.gpgsign')) ?? '').toLowerCase() === 'true';
  return { format, key, always, available: !!key || (format === 'openpgp' && always) };
};

/* ------------------------------------------------------------------ *
 * Submodules
 * ------------------------------------------------------------------ */

/**
 * The submodules this repository records, and how each one stands.
 *
 * `git submodule status` marks each line: `-` not checked out yet, `+` checked
 * out at a commit other than the one recorded, `U` in a merge conflict, and
 * a space when it is at the recorded commit. The URL and branch come from
 * `.gitmodules`, which is what a fresh clone would use.
 */
async function listSubmodules(path) {
  const { stdout: config } = await runGit(path, ['config', '-f', '.gitmodules', '-z', '--get-regexp', '^submodule\\.'], { allowFailure: true });
  const byName = {};
  for (const entry of config.split('\0').filter(Boolean)) {
    const nl = entry.indexOf('\n');
    const key = entry.slice(0, nl), value = entry.slice(nl + 1);
    const m = /^submodule\.(.*)\.(path|url|branch)$/.exec(key);
    if (m) (byName[m[1]] ??= {})[m[2]] = value;
  }
  const byPath = Object.fromEntries(Object.entries(byName).map(([name, v]) => [v.path, { name, ...v }]));

  const { stdout } = await runGit(path, ['submodule', 'status'], { allowFailure: true });
  const out = [];
  for (const line of stdout.split('\n').filter(Boolean)) {
    const m = /^([ +\-U])([0-9a-f]{40}) (.+?)(?: \((.*)\))?$/.exec(line);
    if (!m) continue;
    const [, mark, commit, subPath, describe] = m;
    const info = byPath[subPath] ?? {};
    out.push({
      path: subPath,
      name: info.name ?? subPath,
      url: info.url ?? null,
      branch: info.branch ?? null,
      /** The commit this repository records for it. */
      recorded: mark === '+' ? null : commit,
      /** The commit checked out in it, when it is checked out. */
      checkedOut: mark === '-' ? null : commit,
      state: { '-': 'not-initialized', '+': 'moved', 'U': 'conflicted', ' ': 'clean' }[mark],
      describe: describe ?? null
    });
  }
  // For a moved submodule the status line shows the checked-out commit; the
  // recorded one is in the index.
  for (const sub of out) {
    if (sub.state !== 'moved') continue;
    const { stdout: staged } = await runGit(path, ['ls-files', '-s', '--', sub.path], { allowFailure: true });
    sub.recorded = staged.split(' ')[1] ?? null;
  }
  return out;
}

methods['submodule.list'] = async ({ path }) => ({ submodules: await listSubmodules(path) });

/**
 * Check submodules out at the commits this repository records, cloning any
 * that are not there yet. With `paths`, only those; otherwise all of them.
 * Nested submodules are updated too.
 */
methods['submodule.update'] = async ({ path, paths = null }) => {
  const known = new Set((await listSubmodules(path)).map((s) => s.path));
  const wanted = Array.isArray(paths) ? paths : [];
  for (const p of wanted) {
    if (!known.has(p)) throw new GitError(`${p} is not a submodule of this repository.`, { command: '', stderr: '', code: 1 });
  }
  const args = ['submodule', 'update', '--init', '--recursive', '--', ...wanted];
  const { code, stderr } = await runGit(path, args, { allowFailure: true });
  if (code !== 0) {
    throw new GitError(stderr.trim() || 'Git could not update the submodules.', { command: `git ${args.join(' ')}`, stderr, code });
  }
  return { ok: true, submodules: await listSubmodules(path) };
};

/* ------------------------------------------------------------------ *
 * Worktrees
 * ------------------------------------------------------------------ */

/**
 * Every working tree of this repository: the main one, and each extra one
 * made with `git worktree add`. Each has its own checkout (a branch, or a
 * detached commit), and a branch can be checked out in only one at a time.
 */
async function listWorktrees(path) {
  const { stdout } = await runGit(path, ['worktree', 'list', '--porcelain', '-z'], { allowFailure: true });
  const here = await realpath(path).catch(() => path);
  const trees = [];
  let current = null;
  for (const field of stdout.split('\0')) {
    if (field === '') {
      if (current) trees.push(current);
      current = null;
      continue;
    }
    const space = field.indexOf(' ');
    const key = space === -1 ? field : field.slice(0, space);
    const value = space === -1 ? '' : field.slice(space + 1);
    if (key === 'worktree') {
      current = { path: value, head: null, branch: null, detached: false, bare: false, locked: false, prunable: false, main: trees.length === 0, current: false };
      current.current = (await realpath(value).catch(() => value)) === here;
    } else if (!current) {
      continue;
    } else if (key === 'HEAD') current.head = value;
    else if (key === 'branch') current.branch = value.replace(/^refs\/heads\//, '');
    else if (key === 'detached') current.detached = true;
    else if (key === 'bare') current.bare = true;
    else if (key === 'locked') current.locked = true;
    else if (key === 'prunable') current.prunable = true;
  }
  if (current) trees.push(current);
  return trees;
}

methods['worktree.list'] = async ({ path }) => ({ worktrees: await listWorktrees(path) });

/**
 * Make a new working tree in `dir`, with a branch checked out in it.
 *
 * With `create`, a new branch of that name starts at `from` (HEAD when not
 * given). Otherwise the existing branch is checked out there, which Git
 * refuses when another worktree already has it. A relative `dir` is taken
 * from the folder that holds this repository, so `../name` sits beside it.
 */
methods['worktree.add'] = async ({ path, dir, branch, create = false, from = null }) => {
  if (typeof dir !== 'string' || !dir.trim() || dir.includes('\0')) {
    throw new GitError('Name a folder for the new worktree.', { command: '', stderr: '', code: 1 });
  }
  const target = resolve(path, dir.trim());
  if (await exists(target)) {
    throw new GitError(`${target} already exists. Choose a folder that does not exist yet.`, { command: '', stderr: '', code: 1 });
  }
  const name = commitish(branch, 'the branch');
  let args;
  if (create) {
    const { code } = await runGit(path, ['check-ref-format', '--branch', name], { allowFailure: true });
    if (code !== 0) throw new GitError(`${name} is not a valid branch name.`, { command: '', stderr: '', code: 1 });
    args = ['worktree', 'add', '-b', name, '--', target, from ? commitish(from, 'the starting commit') : 'HEAD'];
  } else {
    args = ['worktree', 'add', '--', target, name];
  }
  const { code, stderr } = await runGit(path, args, { allowFailure: true });
  if (code !== 0) {
    throw new GitError(stderr.trim() || 'Git could not make the worktree.', { command: `git ${args.join(' ')}`, stderr, code });
  }
  return { ok: true, path: target, worktrees: await listWorktrees(path) };
};

/**
 * Delete a working tree's folder and forget it.
 *
 * Git refuses when the folder holds changes not committed yet, unless
 * `force` is set. The main worktree, and the one Gitalia has open, are never
 * removed from here.
 */
methods['worktree.remove'] = async ({ path, dir, force = false }) => {
  const trees = await listWorktrees(path);
  // Git lists real paths, and the folder may have been named through a link
  // (on macOS, /var is one for /private/var).
  const real = async (p) => realpath(p).catch(() => resolve(p));
  const wanted = typeof dir === 'string' ? await real(dir) : null;
  let tree = null;
  for (const t of trees) if (t.path === dir || (await real(t.path)) === wanted) tree = t;
  if (!tree) throw new GitError(`${dir} is not a worktree of this repository.`, { command: '', stderr: '', code: 1 });
  if (tree.main) throw new GitError('The main worktree holds the repository itself, so it cannot be removed.', { command: '', stderr: '', code: 1 });
  if (tree.current) throw new GitError('Gitalia has this worktree open. Open another one first.', { command: '', stderr: '', code: 1 });
  const args = ['worktree', 'remove', ...(force ? ['--force'] : []), '--', tree.path];
  const { code, stderr } = await runGit(path, args, { allowFailure: true });
  if (code !== 0) {
    const dirty = /modified or untracked files|contains modified/i.test(stderr);
    throw new GitError(
      dirty ? `${tree.path} has changes that are not committed. Commit or stash them there first, or remove it anyway to throw them away.` : (stderr.trim() || 'Git could not remove the worktree.'),
      { command: `git ${args.join(' ')}`, stderr, code }
    );
  }
  return { ok: true, worktrees: await listWorktrees(path) };
};

/** Forget worktrees whose folders were deleted by hand. */
methods['worktree.prune'] = async ({ path }) => {
  await git(path, ['worktree', 'prune']);
  return { ok: true, worktrees: await listWorktrees(path) };
};

/* ------------------------------------------------------------------ *
 * Comparing two branches or commits
 * ------------------------------------------------------------------ */

const COMPARE_LIMIT = 500;

/**
 * What separates two branches or commits.
 *
 * `onlyInTarget` are the commits `target` has and `base` does not, and
 * `onlyInBase` the other way round. The files are one of two diffs:
 *
 * - `split` (the default): what `target` changed since the two went apart,
 *   which is what merging `target` into `base` would bring in.
 * - `tips`: the plain difference between the two ends.
 *
 * `from` and `to` are the two commits the file diff was taken between, so
 * the viewer can show any one file the same way.
 */
methods['compare.refs'] = async ({ path, base, target, mode = 'split' }) => {
  const a = commitish(base, 'the first side');
  const b = commitish(target, 'the second side');
  if (mode !== 'split' && mode !== 'tips') {
    throw new GitError('Compare either since the split or tip to tip.', { command: '', stderr: '', code: 1 });
  }
  const resolve = async (rev) => {
    const { stdout, code } = await runGit(path, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], { allowFailure: true });
    if (code !== 0) throw new GitError(`${rev} is not a commit or branch here.`, { command: '', stderr: '', code: 1 });
    return stdout.trim();
  };
  const [baseHash, targetHash] = [await resolve(a), await resolve(b)];

  const { stdout: split } = await runGit(path, ['merge-base', baseHash, targetHash], { allowFailure: true });
  const mergeBase = split.trim() || null;

  const side = async (range) => {
    const { stdout } = await runGit(path, [
      'log', `--pretty=format:${LOG_FORMAT}`, '--decorate=full', `--max-count=${COMPARE_LIMIT + 1}`,
      `--decorate-refs-exclude=${recovery.RECOVERY_PREFIX}*`, range, '--'
    ], { allowFailure: true });
    const commits = parseLog(stdout);
    return { commits: commits.slice(0, COMPARE_LIMIT), truncated: commits.length > COMPARE_LIMIT };
  };
  const onlyInTarget = await side(`${baseHash}..${targetHash}`);
  const onlyInBase = await side(`${targetHash}..${baseHash}`);

  // Unrelated histories have no split point, so only the tips can be compared.
  const from = mode === 'split' && mergeBase ? mergeBase : baseHash;
  const stat = await git(path, ['-c', 'core.quotepath=false', 'diff', '--numstat', '-z', '-M', from, targetHash, '--']);
  return {
    base: a, target: b, baseHash, targetHash, mergeBase,
    mode: mode === 'split' && !mergeBase ? 'tips' : mode,
    from, to: targetHash,
    onlyInTarget, onlyInBase,
    files: parseNumstat(stat)
  };
};

/* ------------------------------------------------------------------ *
 * Bisect
 * ------------------------------------------------------------------ */

/**
 * Where a bisect stands: the commit being tested, how far is left, and the
 * first bad commit once only one candidate remains.
 *
 * Git keeps its marks as refs: `refs/bisect/bad`, and a `good-` and `skip-`
 * ref per commit. The candidates are what the bad commit reaches and no good
 * one does. When that is the bad commit alone, it is the answer.
 */
async function bisectState(path) {
  if ((await detectOperation(path)) !== 'bisect') return { running: false };
  const { stdout: marks } = await runGit(path, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/bisect/'], { allowFailure: true });
  let bad = null;
  const good = [], skipped = [];
  for (const line of marks.split('\n').filter(Boolean)) {
    const [ref, sha] = line.split(' ');
    if (ref === 'refs/bisect/bad') bad = sha;
    else if (ref.startsWith('refs/bisect/good-')) good.push(sha);
    else if (ref.startsWith('refs/bisect/skip-')) skipped.push(sha);
  }
  const { stdout: head } = await runGit(path, ['rev-parse', 'HEAD'], { allowFailure: true });
  const state = { running: true, current: head.trim() || null, bad, good, skipped, left: null, steps: null, found: null, onlySkipped: false };
  if (!bad || good.length === 0) return state;

  // `^<hash>` for each good commit. A repeated `--not` would toggle back.
  const not = good.map((g) => `^${g}`);
  const { stdout: count } = await runGit(path, ['rev-list', '--count', bad, ...not], { allowFailure: true });
  const candidates = Number(count.trim() || 0);
  if (candidates <= 1) {
    state.found = bad;
    return state;
  }
  const { stdout: vars } = await runGit(path, ['rev-list', '--bisect-vars', bad, ...not], { allowFailure: true });
  const get = (name) => Number((new RegExp(`${name}=(\\d+)`).exec(vars) ?? [])[1] ?? NaN);
  state.left = Number.isNaN(get('bisect_all')) ? candidates : get('bisect_all');
  state.steps = Number.isNaN(get('bisect_steps')) ? null : get('bisect_steps');
  // Every commit left to test has been skipped: Git cannot narrow it further.
  const untested = candidates - 1 - skipped.length;
  state.onlySkipped = skipped.length > 0 && untested <= 0;
  return state;
}

const commitish = (value, what) => {
  if (typeof value !== 'string' || !/^[\w./^~@{}-]+$/.test(value) || value.startsWith('-')) {
    throw new GitError(`That is not a commit Gitalia can use as ${what}.`, { command: '', stderr: '', code: 1 });
  }
  return value;
};

methods['bisect.state'] = async ({ path }) => bisectState(path);

/**
 * Start a bisect between a commit that works and one that does not.
 *
 * Git checks out a commit halfway between them for the user to test. The
 * branch they were on is remembered, and stopping the bisect returns there.
 */
methods['bisect.start'] = async ({ path, good, bad = 'HEAD' }) => {
  const operation = await detectOperation(path);
  if (operation) {
    throw new GitError(`A ${operation} is in progress. Finish or abandon it first.`, { command: '', stderr: '', code: 1 });
  }
  const args = ['bisect', 'start', commitish(bad, 'the bad commit'), commitish(good, 'the good commit'), '--'];
  const { code, stderr } = await runGit(path, args, { allowFailure: true });
  if (code !== 0) {
    await runGit(path, ['bisect', 'reset'], { allowFailure: true });
    throw new GitError(stderr.trim() || 'Git could not start the bisect.', { command: `git ${args.join(' ')}`, stderr, code });
  }
  return bisectState(path);
};

/** Say whether the commit being tested works, and move on to the next one. */
methods['bisect.mark'] = async ({ path, verdict }) => {
  if (!['good', 'bad', 'skip'].includes(verdict)) {
    throw new GitError('A bisect verdict is good, bad or skip.', { command: '', stderr: '', code: 1 });
  }
  if ((await detectOperation(path)) !== 'bisect') {
    throw new GitError('No bisect is running.', { command: '', stderr: '', code: 1 });
  }
  const { code, stderr } = await runGit(path, ['bisect', verdict], { allowFailure: true });
  // Only skipped commits left is Git's way of ending without an answer, and
  // not a failure worth an error.
  if (code !== 0 && !/only 'skip'ped commits/i.test(stderr)) {
    throw new GitError(stderr.trim() || `Git could not mark the commit ${verdict}.`, { command: `git bisect ${verdict}`, stderr, code });
  }
  return bisectState(path);
};

/** End the bisect and go back to where it started. */
methods['bisect.reset'] = async ({ path }) => {
  await git(path, ['bisect', 'reset']);
  return { running: false };
};

/* ------------------------------------------------------------------ *
 * The operation log
 * ------------------------------------------------------------------ */

methods['recovery.list'] = async ({ path }) => ({ entries: await recovery.list(path) });

methods['recovery.restore'] = async ({ path, id }) => recovery.restore(path, id, await detectOperation(path));

/**
 * What each recorded method changes, worked out before it runs.
 *
 * Each returns the ref the operation will move or delete and how to describe
 * it, or null when this call rewrites nothing (a commit that is not an amend,
 * a push that is not forced). The ref is read again after a successful run,
 * and the pair goes into the log with a recovery point for the old commit.
 */
const onCurrentBranch = (operation, label) => async ({ path }) => {
  const branch = await recovery.currentBranch(path);
  if (!branch) return null;
  return { operation, label: label(branch), target: { kind: 'branch', name: branch }, ref: `refs/heads/${branch}` };
};

const RECORDED = {
  'branch.reset': async (args) => onCurrentBranch('branch.reset', (b) => `Reset ${b} (${args.mode ?? 'mixed'})`)(args),
  'commits.squash': onCurrentBranch('commits.squash', (b) => `Squashed commits on ${b}`),
  'commits.drop': onCurrentBranch('commits.drop', (b) => `Dropped commits from ${b}`),
  'commits.move': onCurrentBranch('commits.move', (b) => `Moved a commit on ${b}`),
  'commits.rebase': onCurrentBranch('commits.rebase', (b) => `Rebased ${b}`),
  'changes.commit': async (args) => (args.amend ? onCurrentBranch('changes.commit', (b) => `Amended the last commit on ${b}`)(args) : null),
  'branch.delete': async ({ name }) => ({
    operation: 'branch.delete', label: `Deleted branch ${name}`, target: { kind: 'branch', name }, ref: `refs/heads/${name}`
  }),
  'tag.delete': async ({ name }) => ({
    operation: 'tag.delete', label: `Deleted tag ${name}`, target: { kind: 'tag', name }, ref: `refs/tags/${name}`
  }),
  'stash.drop': async ({ path, ref, sha }) => {
    const { stdout } = await runGit(path, ['log', '-1', '--format=%gs', ref], { allowFailure: true });
    return {
      operation: 'stash.drop', label: `Dropped a stash${stdout.trim() ? `: ${stdout.trim()}` : ''}`,
      target: { kind: 'stash', name: ref }, ref: sha || ref, detail: stdout.trim() || null, fixed: true
    };
  },
  'repo.push': async ({ path, branch, force }) => {
    if (!force) return null;
    const name = branch || (await recovery.currentBranch(path));
    if (!name) return null;
    const { stdout } = await runGit(path, ['for-each-ref', '--format=%(upstream)', `refs/heads/${name}`], { allowFailure: true });
    const upstream = stdout.trim();
    if (!upstream) return null;
    return {
      operation: 'repo.push', label: `Force pushed ${name}`,
      target: { kind: 'remote', name: upstream.replace(/^refs\/remotes\//, '') }, ref: upstream
    };
  }
};

for (const [name, plan] of Object.entries(RECORDED)) {
  const run = methods[name];
  methods[name] = async (args) => {
    const change = await plan(args);
    const before = change ? await recovery.resolveRef(args.path, change.ref) : null;
    const result = await run(args);
    if (change && before) {
      // A stash is gone once dropped and a deleted ref reads as null; either
      // way the recovery point keeps the old commit.
      const after = change.fixed ? null : await recovery.resolveRef(args.path, change.ref);
      await recovery.record(args.path, { ...change, before, after }).catch(() => {});
    }
    return result;
  };
}

/** Single entry point, mirroring a Tauri `invoke(method, args)` call. */
export async function invokeMethod(method, args = {}) {
  const fn = methods[method];
  if (!fn) throw new GitError(`Unknown method: ${method}`, { command: '', stderr: '', code: 1 });
  return fn(args);
}

export { GitError };
