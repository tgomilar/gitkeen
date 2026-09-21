export type RefKind = 'local' | 'remote' | 'tag' | 'head';

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
}

/**
 * One shelved change.
 *
 * Shelving is Git's stash under the IntelliJ IDEA name, so `ref` is a position
 * such as `stash@{0}`, not an identity. `sha` is the identity, and every
 * action carries it so a shifted shelf cannot be acted on by mistake.
 */
export interface Stash {
  ref: string;
  sha: string;
  date: number;
  branch: string | null;
  message: string;
  /** True when Git also put untracked files on the shelf. */
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
  /** True when Git found nothing to shelve. */
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
