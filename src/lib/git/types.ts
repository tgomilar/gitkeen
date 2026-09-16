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

export interface PushResult {
  ok: boolean;
  branch: string;
  output: string;
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
