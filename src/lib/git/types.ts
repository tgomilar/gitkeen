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
  added: number | null;
  removed: number | null;
  binary: boolean;
}

export interface CommitDetails {
  body: string;
  files: CommitFileStat[];
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
