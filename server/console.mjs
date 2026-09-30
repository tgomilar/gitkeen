/**
 * The rules of the smart console: which Git commands it runs, which it hands
 * to one of Gitalia's editors instead, how risky each one is, and what Git's
 * common errors mean in plain words.
 *
 * The console runs `git` itself, with an argument list and no shell, so a
 * pipe, a `;` or a `$(...)` is text and never runs anything. On top of that
 * it runs only the commands listed here, and refuses the options that make
 * Git start another program, write a file anywhere, or reach past this
 * repository. An alias is not a command here, because an alias can run a
 * shell.
 */

/** The commands the console runs, and whether they change anything. */
export const COMMANDS = {
  // Read only.
  status: 'read', log: 'read', show: 'read', diff: 'read', blame: 'read', shortlog: 'read',
  reflog: 'read', describe: 'read', grep: 'read', 'ls-files': 'read', 'rev-parse': 'read',
  'count-objects': 'read', cherry: 'read', version: 'read', 'show-ref': 'read', 'cat-file': 'read',
  // Change something.
  add: 'write', commit: 'write', branch: 'write', switch: 'write', checkout: 'write', restore: 'write',
  merge: 'write', rebase: 'write', 'cherry-pick': 'write', revert: 'write', reset: 'write', rm: 'write',
  mv: 'write', clean: 'write', stash: 'write', tag: 'write', fetch: 'write', pull: 'write', push: 'write',
  remote: 'write', worktree: 'write', config: 'write', notes: 'write'
};

/** Options that start a program, write outside the repository, or change where Git looks. */
const REFUSED = [
  { test: (a) => /^--(upload|receive)-pack(=|$)/.test(a), why: 'it names a program for Git to run' },
  { test: (a) => /^--exec(=|$)|^-x$/.test(a), why: 'it runs a shell command for every commit' },
  { test: (a) => /^--output(=|$)/.test(a), why: 'it writes a file outside the console' },
  { test: (a) => a === '--ext-diff', why: 'it runs an external diff program' },
  { test: (a) => /^--(open-files-in-pager|exec-path|git-dir|work-tree|namespace|config-env)(=|$)|^-O/.test(a), why: 'it runs a program or points Git somewhere else' }
];

const MERGE_STRATEGIES = new Set(['ort', 'recursive', 'resolve', 'octopus', 'ours', 'subtree']);

/**
 * Split what was typed into arguments, the way a shell would with quotes,
 * without being a shell: nothing is expanded or run. Returns null with a
 * reason for anything that only a shell could mean.
 */
export function tokenize(line) {
  const out = [];
  let current = '', quote = null, started = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) { quote = null; continue; }
      if (c === '\\' && quote === '"' && i + 1 < line.length) { current += line[++i]; continue; }
      current += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; started = true; continue; }
    if (c === '\\' && i + 1 < line.length) { current += line[++i]; started = true; continue; }
    if (/\s/.test(c)) { if (started) { out.push(current); current = ''; started = false; } continue; }
    if ('|;&<>`'.includes(c) || (c === '$' && line[i + 1] === '(')) {
      return { args: null, error: `"${c === '$' ? '$(' : c}" is shell syntax. The console runs one Git command, with no shell.` };
    }
    current += c;
    started = true;
  }
  if (quote) return { args: null, error: `A ${quote === '"' ? 'double' : 'single'} quote is not closed.` };
  if (started) out.push(current);
  return { args: out, error: null };
}

/**
 * Whether the console may run these arguments (without the leading `git`),
 * and if not, why. A command that would wait for an editor is answered
 * with where in Gitalia to do it instead.
 */
export function checkCommand(args) {
  if (!Array.isArray(args) || args.length === 0) return { ok: false, error: 'Type a Git command, such as status or log.' };
  const [sub, ...rest] = args;
  if (sub.startsWith('-')) {
    return { ok: false, error: `Options before the command, like ${sub}, are not taken here. Put the command first: git status, git log …` };
  }
  if (!COMMANDS[sub]) {
    return { ok: false, error: `The console does not run "git ${sub}". It runs the everyday commands: ${Object.keys(COMMANDS).slice(0, 12).join(', ')} and more.` };
  }
  for (const arg of rest) {
    const refused = REFUSED.find((r) => r.test(arg));
    if (refused) return { ok: false, error: `${arg} is not taken here, because ${refused.why}.` };
  }
  const has = (...names) => rest.some((a) => names.some((n) => a === n || a.startsWith(`${n}=`)));
  const hasShort = (letter) => rest.some((a) => /^-[a-zA-Z]+$/.test(a) && a.includes(letter));

  if (sub === 'config') {
    const reading = has('--get', '--get-all', '--get-regexp', '--list', '--show-origin', '--show-scope') || hasShort('l');
    if (!reading) return { ok: false, error: 'The console only reads the configuration (git config --get, --list). Change it in a terminal.' };
  }
  if ((sub === 'merge' || sub === 'pull') && (has('--strategy') || rest.includes('-s'))) {
    const at = rest.indexOf('-s');
    const name = at !== -1 ? rest[at + 1] : rest.find((a) => a.startsWith('--strategy='))?.split('=')[1];
    if (name && !MERGE_STRATEGIES.has(name)) return { ok: false, error: `"${name}" is not one of Git's own merge strategies.` };
  }
  if (sub === 'bisect' || (sub === 'submodule' && rest[0] === 'foreach')) {
    return { ok: false, error: 'Use the Bisect command in Gitalia, which walks you through it.' };
  }

  // Commands that would open an editor and wait. Gitalia has an editor for each.
  if (sub === 'rebase' && (has('--interactive') || hasShort('i') || rest.includes('--edit-todo'))) {
    const base = [...rest].reverse().find((a) => !a.startsWith('-'));
    return { ok: false, redirect: { to: 'rebase', base: base ?? null }, error: 'An interactive rebase opens in Gitalia\'s rebase editor.' };
  }
  const choosesHunks =
    (['add', 'checkout', 'reset', 'restore', 'stash', 'commit'].includes(sub) && has('--patch', '--interactive')) ||
    (['add', 'checkout', 'reset', 'restore'].includes(sub) && hasShort('p')) ||
    (sub === 'add' && hasShort('i')) ||
    (sub === 'stash' && rest.includes('-p'));
  if (choosesHunks) {
    const file = [...rest].reverse().find((a) => !a.startsWith('-'));
    return { ok: false, redirect: { to: 'hunks', file: file ?? null }, error: 'Choosing hunks happens in Gitalia\'s diff viewer, where you tick the ones you want.' };
  }
  if (sub === 'commit' && !has('--message', '--file', '--reuse-message', '--no-edit', '--fixup', '--squash') && !hasShort('m') && !hasShort('F') && !hasShort('C')) {
    if (!has('--amend')) {
      return { ok: false, redirect: { to: 'commit' }, error: 'Write the message with -m "…", or in the commit panel, which opens now.' };
    }
  }
  if (sub === 'tag' && (hasShort('a') || has('--annotate') || hasShort('s')) && !hasShort('m') && !has('--message', '--file')) {
    return { ok: false, error: 'An annotated tag needs its message here: git tag -a v1.0 -m "…".' };
  }
  return { ok: true, sub, rest };
}

/**
 * How risky a command is, before anything else is known about it.
 * `danger` can lose work or rewrite history; `write` changes something that
 * is easy to undo; `read` changes nothing.
 */
export function riskOf(sub, rest) {
  const has = (...names) => rest.some((a) => names.includes(a) || names.some((n) => a.startsWith(`${n}=`)));
  const hasShort = (letter) => rest.some((a) => /^-[a-zA-Z]+$/.test(a) && a.includes(letter));
  if (COMMANDS[sub] === 'read') return 'read';
  if (sub === 'branch' && rest.every((a) => ['-a', '-r', '-v', '-vv', '--all', '--remotes', '--list', '-l', '--merged', '--no-merged', '--show-current'].includes(a) || !a.startsWith('-') && rest.includes('--list'))) return 'read';
  if (sub === 'tag' && (rest.length === 0 || has('-l', '--list'))) return 'read';
  if (sub === 'remote' && (rest.length === 0 || rest[0] === '-v' || rest[0] === 'show' || rest[0] === 'get-url')) return 'read';
  if (sub === 'stash' && ['list', 'show'].includes(rest[0])) return 'read';
  if (sub === 'worktree' && rest[0] === 'list') return 'read';
  if (sub === 'config') return 'read';
  // Moving the branch is risky; unstaging files is not. A bare name could be
  // either, so it counts as risky here and the preview tells which it is.
  if (sub === 'reset') {
    if (has('--hard', '--keep', '--merge', '--soft', '--mixed')) return 'danger';
    if (rest.length === 0 || rest[0] === '--') return 'write';
    return 'danger';
  }
  if (sub === 'clean' && (hasShort('f') || has('--force'))) return 'danger';
  if (sub === 'push' && (has('--force', '--force-with-lease', '--force-if-includes', '--mirror', '--delete', '--prune') || hasShort('f') || hasShort('d') || rest.some((a) => a.startsWith('+') || a.startsWith(':')))) return 'danger';
  if (sub === 'branch' && (has('--delete', '--force') || hasShort('D') || hasShort('d') || hasShort('M') || hasShort('f'))) return 'danger';
  if (sub === 'tag' && (hasShort('d') || has('--delete') || hasShort('f') || has('--force'))) return 'danger';
  if (sub === 'stash' && ['drop', 'clear'].includes(rest[0])) return 'danger';
  if (sub === 'commit' && has('--amend')) return 'danger';
  if (sub === 'rebase' && !has('--abort', '--continue', '--skip', '--quit')) return 'danger';
  if ((sub === 'checkout' || sub === 'restore') && (rest.includes('--') || rest.includes('.') || sub === 'restore' && !has('--staged', '-S'))) return 'danger';
  if ((sub === 'checkout' || sub === 'switch') && (has('--force', '--discard-changes') || hasShort('f'))) return 'danger';
  if (sub === 'rm' && !has('--cached')) return 'danger';
  return 'write';
}

/** Git's common complaints, in plain words, with what to try next. */
const EXPLANATIONS = [
  [/is not a git command/, 'Git does not know that command.', 'Check the spelling, or press Tab to see the commands.'],
  [/invalid reference: (\S+)/, 'No branch or commit is called "$1".', 'Press Tab after the command to pick one from the list, or make it with git switch -c $1.'],
  [/pathspec '([^']+)' did not match any file/, 'No file or branch is called "$1".', 'Press Tab after the command to pick one from the list.'],
  [/Your local changes to the following files would be overwritten by (checkout|merge)/, 'You have changes that this would overwrite.', 'Commit or stash them first: git stash, then run it again, then git stash pop.'],
  [/untracked working tree files would be overwritten/, 'New files of yours are in the way of this.', 'Move or delete them, or add and commit them first.'],
  [/\[rejected\].*\(non-fast-forward\)|Updates were rejected because the tip of your current branch is behind/s, 'The remote has commits you do not have.', 'Pull first (git pull), then push again.'],
  [/\[rejected\].*\(fetch first\)/s, 'The remote has new commits.', 'Fetch or pull first, then push again.'],
  [/has no upstream branch/, 'This branch does not track a branch on the remote yet.', 'Push it with git push -u origin <branch> once, and plain git push works after.'],
  [/CONFLICT \(/, 'Some files conflict, and Git stopped for you to resolve them.', 'Open the conflicted files with Resolve… in the status bar, then continue.'],
  [/You are in 'detached HEAD' state/, 'HEAD is on a commit, not on a branch.', 'Make a branch here if you will commit: git switch -c <name>.'],
  [/Please tell me who you are/, 'Git does not know your name and email yet.', 'Set them once: git config --global user.name "…" and user.email "…", in a terminal.'],
  [/not something we can merge|unknown revision or path not in the working tree|bad revision/, 'Git cannot find that commit or branch.', 'Press Tab to pick an existing one.'],
  [/nothing to commit, working tree clean/, 'There is nothing to commit: every change is already committed.', null],
  [/no changes added to commit/, 'Nothing is staged, so there is nothing to commit.', 'Stage files first with git add <file>, or tick them in the commit panel.'],
  [/A branch named '([^']+)' already exists/, 'A branch called "$1" exists already.', 'Choose another name, or switch to it with git switch $1.'],
  [/is not fully merged/, 'That branch has commits no other branch has.', 'Deleting it with -D loses them, but the Undo panel keeps a recovery point.'],
  [/Could not read from remote repository|Permission denied \(publickey\)/, 'Git could not reach the remote.', 'Check your network, and that your SSH key or token has access.'],
  [/terminal prompts disabled|could not read Username/, 'The remote asked for a password, and the console cannot type one.', 'Set up an SSH key or a credential helper, or use the GitHub CLI (gh auth login).'],
  [/There is no tracking information for the current branch/, 'This branch does not track a remote branch, so Git does not know what to pull.', 'Name it: git pull origin <branch>, or set it once with git branch -u origin/<branch>.'],
  [/fatal: not a git repository/, 'This folder is not a Git repository.', null]
];

export function explainError(text) {
  for (const [pattern, what, fix] of EXPLANATIONS) {
    const m = pattern.exec(text);
    if (m) {
      const fill = (s) => s && s.replace(/\$(\d)/g, (_, n) => m[Number(n)] ?? '');
      return { what: fill(what), fix: fill(fix) };
    }
  }
  return null;
}
