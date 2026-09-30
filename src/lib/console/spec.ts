/**
 * What the console knows about Git's commands, for autocomplete: each one's
 * purpose, its common options, and what kind of value each position takes,
 * so a branch, a file or a commit can be offered from the open repository.
 */

/** The kinds of value a position can take, each filled from the repository. */
export type ValueKind = 'branch' | 'ref' | 'commit' | 'changed' | 'staged' | 'file' | 'remote' | 'tag' | 'stash' | 'none';

export interface FlagSpec {
  flag: string;
  about: string;
  /** What follows the flag, when it takes a value: `-m "message"`, `-b name`. */
  takes?: ValueKind | 'text';
}

export interface CommandSpec {
  name: string;
  about: string;
  flags: FlagSpec[];
  /** What the arguments after the options are, in order; the last repeats. */
  args: ValueKind[];
  /** Subcommands, for `stash`, `remote` and `worktree`. */
  subcommands?: { name: string; about: string; args?: ValueKind[] }[];
}

const f = (flag: string, about: string, takes?: FlagSpec['takes']): FlagSpec => ({ flag, about, takes });

export const COMMANDS: CommandSpec[] = [
  { name: 'status', about: 'Show what changed in your files', args: ['file'], flags: [f('-s', 'Short format'), f('-b', 'Show the branch too'), f('--ignored', 'Show ignored files too')] },
  { name: 'add', about: 'Stage changes for the next commit', args: ['changed'], flags: [f('-A', 'Stage every change, new files too'), f('-u', 'Stage changes to tracked files only'), f('-p', 'Choose hunks to stage (opens the diff viewer)'), f('-N', 'Record a new file without its content')] },
  { name: 'commit', about: 'Record the staged changes', args: [], flags: [f('-m', 'The message', 'text'), f('--amend', 'Replace the last commit'), f('-a', 'Stage tracked changes first'), f('--no-edit', 'Keep the message when amending'), f('--fixup', 'Make a fixup commit for a commit', 'commit'), f('-S', 'Sign the commit'), f('--no-verify', 'Skip the commit hooks'), f('--allow-empty', 'Commit with no changes')] },
  { name: 'switch', about: 'Switch to a branch', args: ['branch'], flags: [f('-c', 'Make a new branch and switch to it', 'text'), f('--detach', 'Check out a commit, on no branch', 'commit'), f('-', 'Back to the branch before')] },
  { name: 'checkout', about: 'Switch branch, or restore files', args: ['ref', 'changed'], flags: [f('-b', 'Make a new branch and switch to it', 'text'), f('--', 'The rest are files to restore'), f('-p', 'Choose hunks to throw away')] },
  { name: 'restore', about: 'Throw away changes to files', args: ['changed'], flags: [f('--staged', 'Unstage, keep the changes'), f('--source', 'Take the files from a commit', 'commit'), f('-p', 'Choose hunks')] },
  { name: 'branch', about: 'List, make or delete branches', args: ['branch'], flags: [f('-a', 'List remote branches too'), f('-r', 'List remote branches'), f('-v', 'Show the last commit of each'), f('-d', 'Delete a merged branch', 'branch'), f('-D', 'Delete a branch, merged or not', 'branch'), f('-m', 'Rename a branch', 'branch'), f('-u', 'Set the upstream', 'ref'), f('--show-current', 'Name the current branch'), f('--merged', 'Branches merged into this one'), f('--no-merged', 'Branches not merged yet')] },
  { name: 'log', about: 'Show the history', args: ['ref', 'file'], flags: [f('--oneline', 'One line per commit'), f('--graph', 'Draw the branches'), f('-n', 'How many commits', 'text'), f('--all', 'Every branch'), f('--author', 'Commits by an author', 'text'), f('--grep', 'Commits whose message matches', 'text'), f('--since', 'Commits since a date', 'text'), f('--until', 'Commits until a date', 'text'), f('-p', 'Show each change too'), f('--stat', 'Show the files each commit changed'), f('--', 'The rest are files')] },
  { name: 'diff', about: 'Show changes', args: ['ref', 'changed'], flags: [f('--staged', 'What is staged'), f('--stat', 'Only the files and counts'), f('--name-only', 'Only the file names'), f('--word-diff', 'Mark changed words'), f('--', 'The rest are files')] },
  { name: 'show', about: 'Show a commit', args: ['commit'], flags: [f('--stat', 'Only the files and counts'), f('--name-only', 'Only the file names')] },
  { name: 'merge', about: 'Join another branch into this one', args: ['ref'], flags: [f('--no-ff', 'Always make a merge commit'), f('--ff-only', 'Only move forward, never merge'), f('--squash', 'Bring the changes in as one change, not committed'), f('--abort', 'Abandon the merge in progress'), f('--continue', 'Finish after resolving conflicts'), f('-m', 'The merge commit message', 'text')] },
  { name: 'rebase', about: 'Replay commits on top of another', args: ['ref'], flags: [f('-i', 'Choose what happens to each commit (opens the rebase editor)'), f('--onto', 'Put them on another base', 'ref'), f('--continue', 'Carry on after a conflict'), f('--abort', 'Abandon the rebase'), f('--skip', 'Leave out the current commit'), f('--autostash', 'Stash changes first, and bring them back')] },
  { name: 'cherry-pick', about: 'Copy commits onto this branch', args: ['commit'], flags: [f('-x', 'Note the original commit in the message'), f('-n', 'Apply without committing'), f('--continue', 'Carry on after a conflict'), f('--abort', 'Abandon it')] },
  { name: 'revert', about: 'Undo a commit with a new commit', args: ['commit'], flags: [f('-n', 'Apply without committing'), f('--no-edit', 'Keep the suggested message'), f('-m', 'Which parent, for a merge', 'text'), f('--abort', 'Abandon it')] },
  { name: 'reset', about: 'Move the branch, or unstage files', args: ['commit', 'staged'], flags: [f('--soft', 'Move the branch, keep changes staged'), f('--mixed', 'Move the branch, keep changes unstaged'), f('--hard', 'Move the branch and throw changes away'), f('--keep', 'Move the branch, keep local changes'), f('--', 'The rest are files to unstage')] },
  { name: 'stash', about: 'Set changes aside', args: [], flags: [f('-u', 'Include untracked files'), f('-m', 'A name for the stash', 'text'), f('--keep-index', 'Keep what is staged')], subcommands: [
    { name: 'push', about: 'Set changes aside (the default)' }, { name: 'list', about: 'List the stashes' },
    { name: 'pop', about: 'Bring a stash back and remove it', args: ['stash'] }, { name: 'apply', about: 'Bring a stash back and keep it', args: ['stash'] },
    { name: 'drop', about: 'Delete a stash', args: ['stash'] }, { name: 'show', about: 'Show what a stash holds', args: ['stash'] }, { name: 'clear', about: 'Delete every stash' }
  ] },
  { name: 'tag', about: 'List, make or delete tags', args: ['tag', 'commit'], flags: [f('-a', 'An annotated tag'), f('-m', 'The tag message', 'text'), f('-d', 'Delete a tag', 'tag'), f('-l', 'List tags matching a pattern', 'text'), f('-s', 'A signed tag')] },
  { name: 'fetch', about: 'Download new commits from a remote', args: ['remote'], flags: [f('--all', 'Every remote'), f('--prune', 'Forget branches deleted on the remote'), f('--tags', 'Fetch every tag')] },
  { name: 'pull', about: 'Fetch and merge the upstream branch', args: ['remote', 'branch'], flags: [f('--rebase', 'Rebase instead of merging'), f('--ff-only', 'Only move forward'), f('--no-rebase', 'Merge')] },
  { name: 'push', about: 'Publish commits to a remote', args: ['remote', 'branch'], flags: [f('-u', 'Remember the remote branch'), f('--force-with-lease', 'Replace the remote branch, if nobody else pushed'), f('--force', 'Replace the remote branch'), f('--tags', 'Push tags too'), f('--delete', 'Delete a remote branch', 'branch'), f('--dry-run', 'Show what would be pushed')] },
  { name: 'remote', about: 'List or manage remotes', args: [], flags: [f('-v', 'Show the addresses')], subcommands: [
    { name: 'add', about: 'Add a remote' }, { name: 'remove', about: 'Remove a remote', args: ['remote'] },
    { name: 'rename', about: 'Rename a remote', args: ['remote'] }, { name: 'show', about: 'Show a remote', args: ['remote'] },
    { name: 'get-url', about: 'Show a remote\'s address', args: ['remote'] }, { name: 'set-url', about: 'Change a remote\'s address', args: ['remote'] }
  ] },
  { name: 'rm', about: 'Delete files and stage the deletion', args: ['file'], flags: [f('--cached', 'Stop tracking, keep the file'), f('-r', 'Folders too')] },
  { name: 'mv', about: 'Move or rename a file', args: ['file'], flags: [] },
  { name: 'clean', about: 'Delete untracked files', args: ['file'], flags: [f('-n', 'Only show what would be deleted'), f('-f', 'Delete them'), f('-d', 'Folders too'), f('-x', 'Ignored files too')] },
  { name: 'blame', about: 'Who changed each line of a file', args: ['file'], flags: [f('-L', 'Only these lines', 'text'), f('-w', 'Ignore whitespace')] },
  { name: 'reflog', about: 'Where HEAD has been', args: ['ref'], flags: [f('-n', 'How many entries', 'text')] },
  { name: 'describe', about: 'Name a commit by the nearest tag', args: ['commit'], flags: [f('--tags', 'Any tag, not only annotated ones')] },
  { name: 'shortlog', about: 'Commits by author', args: ['ref'], flags: [f('-s', 'Only the counts'), f('-n', 'Most commits first'), f('-e', 'Show emails')] },
  { name: 'grep', about: 'Search the tracked files', args: ['none'], flags: [f('-n', 'Show line numbers'), f('-i', 'Ignore case'), f('-l', 'Only the file names')] },
  { name: 'worktree', about: 'Folders with other branches checked out', args: [], flags: [], subcommands: [
    { name: 'list', about: 'List the worktrees' }, { name: 'add', about: 'Add a worktree' }, { name: 'remove', about: 'Remove a worktree' }, { name: 'prune', about: 'Forget deleted worktrees' }
  ] }
];

export const COMMAND_BY_NAME = new Map(COMMANDS.map((c) => [c.name, c]));
