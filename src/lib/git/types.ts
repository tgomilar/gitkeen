export type RefKind = 'local' | 'remote' | 'tag' | 'head' | 'bisect';

export interface CommitRef {
  kind: RefKind;
  name: string;
  isHead: boolean;
}

export interface Commit {
  hash: string;
  shortHash: string;
  parents: string[];
  author: string;
  authorEmail: string;
  authorDate: number;
  committer: string;
  commitDate: number;
  refs: CommitRef[];
  subject: string;
}

export interface Branch {
  name: string;
  refname: string;
  oid: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  isHead: boolean;
  date: number;
}

/** What deleting a tag would cost, read before the confirmation is shown. */
export interface TagInspection {
  name: string;
  oid: string;
  shortHash: string;
  subject: string;
  /** True for an annotated tag, which records who tagged it and when. */
  annotated: boolean;
  /** Remotes that also hold this tag, where deleting here leaves it. */
  onRemote: string[];
  /** True when a remote could not be reached, so `onRemote` may be short. */
  unreachable: boolean;
}

export interface BranchSet {
  local: Branch[];
  remote: Branch[];
  tags: Branch[];
}

export type FileState = 'tracked' | 'renamed' | 'conflicted' | 'untracked';

export interface StatusFile {
  path: string;
  origPath?: string;
  index: string;
  worktree: string;
  state: FileState;
}

export type OperationState = 'rebase' | 'merge' | 'cherry-pick' | 'revert' | 'bisect' | null;

export interface GitStatus {
  branch: string | null;
  upstream: string | null;
  oid: string | null;
  ahead: number;
  behind: number;
  detached: boolean;
  files: StatusFile[];
  operation: OperationState;
  /** Why a rebase is paused: an `edit` to amend, or a conflict. Null otherwise. */
  rebaseStop?: 'edit' | 'conflict' | null;
}

export interface RepositoryInfo {
  root: string;
  name: string;
  gitVersion: string;
  /** How this repository expects commit messages to be written. */
  commitRules?: CommitRules;
}

/** One commitlint rule, as read from the repository's own config. */
export interface CommitRule {
  /** commitlint levels: 0 off, 1 warning, 2 error. */
  level: number;
  applicable: 'always' | 'never';
  value: string[] | string | number | null;
}

export interface CommitRules {
  /** Where the rules came from, which decides whether they are enforced. */
  source: 'commitlint' | 'hook' | 'none';
  /** The file the rules were read from, shown so the user can go and read it. */
  file: string | null;
  /** True only when the rules can be both read and checked before committing. */
  enforced: boolean;
  rules: Record<string, CommitRule>;
  /** Allowed types, used for the hint under the message box. */
  types: string[] | null;
  maxHeader: number | null;
}

/** Where one provider's key comes from. The key itself is never sent here. */
export interface KeyState {
  configured: boolean;
  /** 'environment' wins over 'saved'; null when there is no key at all. */
  source: 'environment' | 'saved' | null;
  variable: string;
  saved: boolean;
}

export interface KeyStatus {
  /** The file keys are saved in, shown so the user knows where it lives. */
  file: string;
  providers: Record<string, KeyState>;
}

/** Which AI providers have a key, reported so the panel can hide the button. */
export interface SuggestProviders {
  available: string[];
  preferred: string | null;
  models: Record<string, string>;
}

/** One commit a change could be split into, when it holds unrelated work. */
export interface SuggestedGroup {
  /** What this group of files is, in a few words. */
  reason: string;
  files: string[];
}

/** A suggested subject line, already checked against the repository's rules. */
export interface Suggestion {
  subject: string;
  provider: string;
  model: string;
  /** True when the diff was too large to send whole. */
  clipped: boolean;
  problems: MessageProblem[];
  /** False when the suggestion still breaks a blocking rule after a retry. */
  ok: boolean;
  /**
   * How the change could be split, when it looks like more than one commit.
   * Empty when it is one piece of work, which is the usual case.
   */
  groups: SuggestedGroup[];
}

export interface MessageProblem {
  rule: string;
  message: string;
  level: number;
}

export interface MessageCheck {
  ok: boolean;
  problems: MessageProblem[];
  /** The subset that turns the Commit button off. */
  blocking: MessageProblem[];
}

export interface HeadInfo {
  branch: string | null;
  detached: boolean;
  oid: string | null;
}

export interface CommitFileStat {
  path: string;
  /** The name the file had before this commit renamed it, or null. */
  origPath: string | null;
  added: number | null;
  removed: number | null;
  binary: boolean;
}

export interface CommitDetails {
  body: string;
  files: CommitFileStat[];
  signature?: CommitSignature;
}

/** Whether a commit is signed, and what Git made of the signature. */
export interface CommitSignature {
  status: 'good' | 'untrusted' | 'expired' | 'expired-key' | 'revoked' | 'bad' | 'unknown' | 'none';
  /** The kind of key it was signed with, or null when it is not signed. */
  format?: 'openpgp' | 'ssh' | 'x509' | null;
  signer: string | null;
  key: string | null;
}

/** How this repository signs commits. */
export interface SigningInfo {
  format: string;
  key: string | null;
  /** True when `commit.gpgsign` signs every commit. */
  always: boolean;
  /** True when there is a key to sign with. */
  available: boolean;
}

export interface HeadCommit {
  exists: boolean;
  hash: string | null;
  message: string;
  subject: string;
  isMerge: boolean;
  /** The upstream branch that already holds this commit, or null. */
  pushed: string | null;
}

export interface CommitResult {
  ok: boolean;
  commit: string;
  files: number;
  /** False when a merge forced the whole index to be committed. */
  partial: boolean;
}

export interface RollbackResult {
  ok: boolean;
  restored: number;
  unstaged: number;
}

/**
 * What to push, and how.
 *
 * `branch` names the branch to send. Left out, it is the checked-out branch,
 * which is what the toolbar and the commit panel push.
 */
export interface PushOptions {
  branch?: string;
  remote?: string;
  setUpstream?: boolean;
  force?: boolean;
}

export interface PushResult {
  ok: boolean;
  branch: string;
  output: string;
  /** True when the push replaced the remote branch rather than adding to it. */
  forced?: boolean;
}

/** A commit a pull would bring in. */
export interface IncomingCommit {
  hash: string;
  shortHash: string;
  author: string;
  date: number;
  subject: string;
}

/** What a pull would do, read before the confirmation is shown. */
export interface PullInspection {
  ok: boolean;
  /** Reasons the pull cannot run, written for the user. */
  problems: string[];
  branch?: string;
  upstream?: string | null;
  /** What is coming in, newest first. */
  commits?: IncomingCommit[];
  behind?: number;
  ahead?: number;
  /** True when the merge is a straight fast-forward, with no merge commit. */
  fastForward?: boolean;
  changedFiles?: number;
  /** True when the remote refs could not be refreshed, so this may be stale. */
  staleRefs?: boolean;
}

/** The outcome of a pull. Shaped like ApplyResult so it reports the same way. */
export interface PullResult {
  ok: boolean;
  /** True when Git stopped on a conflict and left the merge open. */
  conflicted: boolean;
  operation?: OperationState;
  applied?: number;
  previousHead: string;
  head?: string;
  /** True when the branch was already up to date, so nothing moved. */
  upToDate?: boolean;
  output?: string;
}

/** What a merge would do, read before the confirmation is shown. */
export interface MergeInspection {
  ok: boolean;
  /** Reasons the merge cannot run, written for the user. */
  problems: string[];
  source?: string;
  target?: string;
  /** What the merge would bring in, newest first. */
  commits?: IncomingCommit[];
  incoming?: number;
  /** True when the source is already contained in the current branch. */
  alreadyMerged?: boolean;
  /** True when the branch would simply move up, with no merge commit. */
  fastForward?: boolean;
  changedFiles?: number;
  /** Paths Git says would conflict, found without touching the working tree. */
  conflicts?: string[];
}

/** The outcome of a merge. */
export interface MergeResult {
  ok: boolean;
  /** True when Git stopped on a conflict and left the merge open. */
  conflicted: boolean;
  operation?: OperationState;
  applied?: number;
  previousHead: string;
  head?: string;
  upToDate?: boolean;
  /** False when the branch simply moved up, so no merge commit was made. */
  mergeCommit?: boolean;
  output?: string;
}

/** A commit a force push would remove from the remote. */
export interface DroppedCommit {
  hash: string;
  shortHash: string;
  author: string;
  date: number;
  subject: string;
}

/** What a force push would do, read before the confirmation is shown. */
export interface ForcePushInspection {
  branch: string;
  upstream: string | null;
  /** Commits on the remote that this branch does not have. */
  dropped: DroppedCommit[];
  /** Commits this branch would add. */
  gained: number;
  behind: number;
  /** True when the remote refs could not be refreshed, so this may be stale. */
  staleRefs: boolean;
}

export type DiffLineKind = 'context' | 'add' | 'del';

export interface DiffLine {
  kind: DiffLineKind;
  /** Line number on the left, or null when the line is an addition. */
  oldNumber: number | null;
  /** Line number on the right, or null when the line is a deletion. */
  newNumber: number | null;
  text: string;
  /** Git's "\ No newline at end of file" applies to this line. */
  noNewline?: boolean;
  /** Set by the diff viewer on a changed line the user left out of a stage. */
  skip?: boolean;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** The text Git puts after the @@ marker, usually the enclosing function. */
  heading: string;
  lines: DiffLine[];
}

export type DiffStatus = 'added' | 'deleted' | 'modified' | 'renamed';

export interface FileDiff {
  path: string;
  origPath: string | null;
  /** The commit this diff belongs to, or null for the working tree. */
  hash: string | null;
  /**
   * Which half of the working tree this diff compares, when it was asked
   * for one: the index against HEAD (`staged`) or the worktree against the
   * index (`unstaged`). Null for a whole-file or commit diff.
   */
  side?: 'staged' | 'unstaged' | null;
  /** True when `path` is not yet known to Git. */
  untracked?: boolean;
  status: DiffStatus;
  binary: boolean;
  /** True when the diff was cut short because the file is very large. */
  truncated: boolean;
  /** True when Git records a change with no difference in the text. */
  empty: boolean;
  added: number;
  removed: number;
  hunks: DiffHunk[];
}

/**
 * One region of a conflicted file, as the merge editor draws it.
 *
 * Each element is a raw line that keeps its own newline, so joining a set of
 * slices reproduces the original bytes exactly. `text` regions are the code
 * both sides left alone; `conflict` regions hold the two contenders.
 */
export interface MergeTextSection {
  type: 'text';
  lines: string[];
}

export interface MergeConflictSection {
  type: 'conflict';
  /** The whole block as Git wrote it, markers included. */
  lines: string[];
  /** The lines on the current branch's side, before the `=======`. */
  ours: string[];
  /** The lines the incoming side brought, after the `=======`. */
  theirs: string[];
  /** What Git put after the `<<<<<<<` and `>>>>>>>` markers. */
  labels: { ours: string; theirs: string };
  /**
   * Set on a modify/delete conflict, where the whole file is the one choice:
   * which side deleted the file. Keeping that side deletes it.
   */
  deleted?: { ours: boolean; theirs: boolean };
}

export type MergeSection = MergeTextSection | MergeConflictSection;

export interface MergeStage {
  /** True when one of the index's three stages held this side. */
  present: boolean;
  binary: boolean;
  lines: number;
}

export interface MergeStages {
  base: MergeStage;
  ours: MergeStage;
  theirs: MergeStage;
}

/** What the merge editor is told about a conflicted file, in one read. */
export interface MergeOffer {
  path: string;
  binary: boolean;
  /** True when a section of the file was cut, so the whole is not shown. */
  truncated?: boolean;
  /** How many lines the working-tree file has, markers included. */
  lines: number;
  sections: MergeSection[];
  /** The common ancestor's lines, or null when there is no base to show. */
  base: string[] | null;
  stages: MergeStages;
}

/** Which side of a conflict the editor is told to keep: one, or both in turn. */
export type ConflictChoice = 'ours' | 'theirs' | 'both';

/** A commit as the cherry-pick and revert dialogs need to describe it. */
export interface ApplyCommit {
  hash: string;
  shortHash: string;
  subject: string;
  parents: string[];
  isMerge: boolean;
  /** True when this commit is already reachable from HEAD. */
  inHistory: boolean;
}

export interface ApplyInspection {
  ok: boolean;
  /** Reasons the operation cannot run, written for the user. */
  problems: string[];
  /** Things worth knowing that do not block it. */
  warnings?: string[];
  commits?: ApplyCommit[];
  branch?: string | null;
  detached?: boolean;
  dirty?: number;
  operation?: OperationState;
}

export interface ApplyResult {
  ok: boolean;
  /** True when Git stopped on a conflict and left the operation open. */
  conflicted: boolean;
  operation?: OperationState;
  applied?: number;
  previousHead: string;
  head?: string;
}

/** A commit a rewrite would give a new hash. */
export interface RewrittenCommit {
  hash: string;
  shortHash: string;
  subject: string;
}

/** What moving or dropping commits would cost, read before the dialog. */
export interface RewriteInspection {
  ok: boolean;
  /** Reasons the rewrite cannot run, written for the user. */
  problems: string[];
  mode?: 'drop' | 'move';
  base?: string | null;
  head?: string;
  branch?: string | null;
  /** Commits that would be rewritten, newest first. Includes the selection. */
  rewritten?: RewrittenCommit[];
  /** Remote branches holding any of them, which a rewrite would need forcing. */
  published?: string[];
}

export interface DropResult {
  ok: boolean;
  previousHead: string;
  head: string;
  dropped: number;
  replayed: number;
}

export interface MoveResult {
  ok: boolean;
  previousHead: string;
  head: string;
  moved: string;
  direction: 'up' | 'down';
}

/** What an interactive rebase can do with one commit. */
export type RebaseCommand = 'pick' | 'reword' | 'squash' | 'fixup' | 'drop' | 'edit';

/** One commit in the span an interactive rebase would cover. */
export interface RebaseCommit {
  hash: string;
  shortHash: string;
  author: string;
  date: number;
  subject: string;
  /** The full message, so a reword starts from what is already there. */
  message: string;
}

/** The span an interactive rebase would cover, plus what it would cost. */
export interface RebaseSpan extends RewriteInspection {
  /** Oldest first, the order the todo list runs in. */
  commits?: RebaseCommit[];
}

/** One line of the todo list, as the editor built it. */
export interface RebasePlanEntry {
  hash: string;
  command: RebaseCommand;
  message?: string;
}

export interface RebaseResult {
  ok: boolean;
  previousHead: string;
  head: string;
  /** How many commits the branch has over the base now. */
  commits: number;
  dropped: number;
  combined: number;
  reworded: number;
  /** True when an `edit` or a conflict stopped the rebase part-way. */
  stopped: boolean;
  /** True when it stopped on a conflict, with files to resolve. */
  conflicted?: boolean;
  /** The commit the run paused at, when it paused. */
  stoppedAt: string | null;
}

export type ResetMode = 'soft' | 'mixed' | 'hard';

export interface ResetInspection {
  ok: boolean;
  problems: string[];
  target?: string;
  head?: string;
  /** Commits that would leave this branch. */
  dropped?: number;
  /** Commits that would join it, when resetting forward. */
  gained?: number;
  dirty?: number;
  untracked?: number;
  branch?: string | null;
  detached?: boolean;
  /** Remote branches that still hold the commits being dropped. */
  published?: string[];
}

export interface ResetResult {
  ok: boolean;
  previousHead: string;
  head: string;
  mode: ResetMode;
}

export interface OperationResult {
  ok: boolean;
  operation: OperationState;
  finished?: boolean;
  /** Where the operation paused again, for a rebase that stopped to amend. */
  stoppedAt?: string | null;
  /** True when a rebase stopped again because the next commit conflicts. */
  conflicted?: boolean;
}

/**
 * One stashed change.
 *
 * `ref` is a position such as `stash@{0}`, not an identity: dropping one
 * renumbers the rest. `sha` is the identity, and every action carries it so a
 * shifted stash cannot be acted on by mistake.
 */
export interface Stash {
  ref: string;
  sha: string;
  date: number;
  branch: string | null;
  message: string;
  /** True when Git also put untracked files in the stash. */
  hasUntracked: boolean;
}

export interface StashFile {
  path: string;
  origPath: string | null;
  added: number | null;
  removed: number | null;
  binary: boolean;
  /** True when the file was untracked, so it sits in the stash's third parent. */
  untracked: boolean;
}

export interface StashResult {
  ok: boolean;
  /** True when Git found nothing to stash. */
  empty?: boolean;
  ref?: string;
  sha?: string;
}

export interface StashApplyResult {
  ok: boolean;
  conflicted: boolean;
  dropped: boolean;
  conflicts: number;
}

export interface BranchInspection {
  isMerged: boolean;
  onRemote: string[];
  unmergedCommits: number;
}

export interface LogPage {
  commits: Commit[];
  truncated: boolean;
}

export interface CommitMessage {
  hash: string;
  message: string;
}

export interface SquashInspection {
  ok: boolean;
  /** Reasons the squash cannot run, written for the user. */
  problems: string[];
  base?: string | null;
  head?: string;
  /** True when the selection reaches the branch tip, which needs no rebase. */
  atHead?: boolean;
  branch?: string | null;
  count?: number;
  /** Commits that would be replayed on top of the squashed result. */
  replayed?: number;
  /** Remote branches that already contain these commits. */
  published?: string[];
}

export interface SquashResult {
  ok: boolean;
  commit: string;
  /** Where the branch pointed before, so the user can recover. */
  previousHead: string;
  replayed: number;
}

/* Statistics. The Stats report reads the log and counts; it never writes.

   Every time in a report is a commit date, because that is what `--since` and
   `--until` filter on. Author date and commit date differ once a commit has
   been rebased, and mixing the two would put commits in a report that fall
   outside the period it says it covers. */

export interface StatsRange {
  /** Anything `git log --since` accepts, e.g. "30 days ago". Null for all. */
  since: string | null;
  until: string | null;
  /** Refs the report is narrowed to, or null for every branch. */
  refs: string[] | null;
  includeMerges: boolean;
  /** Glob pathspecs kept out of the line counts, e.g. generated files. */
  excludePaths: string[];
}

export interface StatsTotals {
  commits: number;
  authors: number;
  added: number;
  removed: number;
  filesTouched: number;
  merges: number;
  firstCommit: number | null;
  lastCommit: number | null;
  /** Distinct days that carry at least one commit. */
  activeDays: number;
}

export interface AuthorStats {
  /** The identity commits are grouped under: the author email, lowercased. */
  key: string;
  name: string;
  email: string;
  /** Other spellings of the name seen for this address. */
  aliases: string[];
  commits: number;
  merges: number;
  added: number;
  removed: number;
  files: number;
  first: number;
  last: number;
  activeDays: number;
  /** Commits per hour of the day, 0–23. */
  hours: number[];
  /** Commits per day of the week, Sunday first. */
  weekdays: number[];
}

export interface DayStats {
  /** Local calendar day, as YYYY-MM-DD. */
  date: string;
  commits: number;
  added: number;
  removed: number;
  authors: number;
}

export interface MonthStats {
  /** Local calendar month, as YYYY-MM. */
  month: string;
  commits: number;
  added: number;
  removed: number;
  authors: number;
}

export interface FileStats {
  path: string;
  commits: number;
  added: number;
  removed: number;
  authors: number;
  last: number;
}

export interface ExtensionStats {
  ext: string;
  files: number;
  added: number;
  removed: number;
}

export interface RecentCommitStats {
  hash: string;
  shortHash: string;
  author: string;
  authorEmail: string;
  date: number;
  subject: string;
  added: number;
  removed: number;
  files: number;
}

export interface StatsReport {
  generatedAt: number;
  /** The commit cap the report was read with. */
  limit: number;
  /** True when the cap bit, so the report describes only part of the history. */
  truncated: boolean;
  totals: StatsTotals;
  authors: AuthorStats[];
  days: DayStats[];
  months: MonthStats[];
  /** Commits per hour of the day, 0–23. */
  hours: number[];
  /** Commits per day of the week, Sunday first. */
  weekdays: number[];
  files: FileStats[];
  extensions: ExtensionStats[];
  recent: RecentCommitStats[];
}

/** One operation in the log, with the recovery point saved before it ran. */
export interface RecoveryEntry {
  id: string;
  /** When it ran, in milliseconds. */
  time: number;
  /** The method that ran, such as `branch.reset`. */
  operation: string;
  /** What happened, in words: "Reset main (hard)". */
  label: string;
  /** What it changed. A remote target is the remote-tracking branch a force push replaced. */
  target: { kind: 'branch' | 'tag' | 'stash' | 'remote'; name: string };
  /** Where the target pointed before, which is what a restore goes back to. */
  before: string;
  /** Where it pointed after, or null when it was deleted. */
  after: string | null;
  /** False once the recovery point is gone, so there is nothing to restore. */
  restorable: boolean;
}

export interface RecoveryResult {
  ok: boolean;
  kind: 'branch' | 'tag' | 'stash';
  /** The branch, tag or stash that was put back. */
  name: string;
  at: string;
  /** True when it had been deleted and was made again. */
  recreated: boolean;
}

/** One line of a blamed file, and the commit that last changed it. */
export interface BlameLine {
  hash: string;
  /** The line's number in that commit's version of the file. */
  origLine: number;
  /** The line's number in the file as shown. */
  line: number;
  text: string;
}

export interface BlameCommit {
  author: string;
  email: string;
  time: number;
  summary: string;
  /** Where these lines were before this commit, for going further back. */
  previous: { hash: string; file: string } | null;
}

export interface BlameResult {
  file: string;
  /** The commit the file was read at, or null for the working tree. */
  rev: string | null;
  lines: BlameLine[];
  commits: Record<string, BlameCommit>;
  /** True when the file was too long to show every line. */
  truncated: boolean;
}

/** Where a bisect stands. */
export interface BisectState {
  running: boolean;
  /** The commit checked out for testing. */
  current?: string | null;
  bad?: string | null;
  good?: string[];
  skipped?: string[];
  /** Commits still in the running, and about how many more tests it takes. */
  left?: number | null;
  steps?: number | null;
  /** The first bad commit, once Git has narrowed it down to one. */
  found?: string | null;
  /** True when only skipped commits are left, so there is no single answer. */
  onlySkipped?: boolean;
}

/** What separates two branches or commits. */
export interface CompareResult {
  /** The names as given, and the commits they stand for. */
  base: string;
  target: string;
  baseHash: string;
  targetHash: string;
  /** Where the two went apart, or null when they share no history. */
  mergeBase: string | null;
  /** `split`: what target changed since then. `tips`: the two ends as they are. */
  mode: 'split' | 'tips';
  /** The two commits the file diff was taken between. */
  from: string;
  to: string;
  onlyInTarget: { commits: Commit[]; truncated: boolean };
  onlyInBase: { commits: Commit[]; truncated: boolean };
  files: CommitFileStat[];
}

/** One working tree of the repository. */
export interface Worktree {
  path: string;
  head: string | null;
  /** The branch checked out there, or null when HEAD is detached. */
  branch: string | null;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  /** True when its folder is gone and Git can forget it. */
  prunable: boolean;
  /** The first one, which holds the repository itself. */
  main: boolean;
  /** The one Gitalia has open. */
  current: boolean;
}

/** A repository kept inside this one, pinned at a recorded commit. */
export interface Submodule {
  path: string;
  name: string;
  url: string | null;
  branch: string | null;
  /** The commit this repository records for it. */
  recorded: string | null;
  /** The commit checked out in it, or null when it is not checked out. */
  checkedOut: string | null;
  state: 'clean' | 'moved' | 'not-initialized' | 'conflicted';
  describe: string | null;
}
