/**
 * The Git service described in the project plan, section 11.
 *
 * UI components call these methods. They never see a command line, a flag,
 * or a transport detail.
 */
import { transport } from './transport';
import type {
  ApplyInspection, ApplyResult, BranchSet, BranchInspection, CommitDetails, CommitMessage,
  CommitResult, FileDiff, GitStatus, HeadCommit, HeadInfo, LogPage, OperationResult,
  PushResult, RepositoryInfo, ResetInspection, ResetMode, ResetResult, RollbackResult,
  SquashInspection, SquashResult, Stash, StashApplyResult,
  StashFile, StashResult, StatsRange, StatsReport
} from './types';

export class GitRepository {
  constructor(public readonly info: RepositoryInfo) {}

  private get path() {
    return this.info.root;
  }

  static async open(path: string): Promise<GitRepository> {
    const info = await transport.call<RepositoryInfo>('repo.open', { path });
    return new GitRepository(info);
  }

  status(): Promise<GitStatus> {
    return transport.call('repo.status', { path: this.path });
  }

  head(): Promise<HeadInfo> {
    return transport.call('head.read', { path: this.path });
  }

  /** `refs` narrows the log to what those refs reach, e.g. a single branch. */
  log(options: { limit?: number; all?: boolean; refs?: string[] } = {}): Promise<LogPage> {
    return transport.call('log.list', { path: this.path, ...options });
  }

  branches(): Promise<BranchSet> {
    return transport.call('branches.list', { path: this.path });
  }

  remotes(): Promise<{ remotes: string[] }> {
    return transport.call('remotes.list', { path: this.path });
  }

  commitDetails(hash: string): Promise<CommitDetails> {
    return transport.call('commit.details', { path: this.path, hash });
  }

  switchBranch(name: string): Promise<void> {
    return transport.call('branch.checkout', { path: this.path, name });
  }

  createBranch(name: string, from?: string, checkout = true): Promise<void> {
    return transport.call('branch.create', { path: this.path, name, from, checkout });
  }

  deleteBranch(name: string, force = false): Promise<void> {
    return transport.call('branch.delete', { path: this.path, name, force });
  }

  renameBranch(from: string, to: string): Promise<void> {
    return transport.call('branch.rename', { path: this.path, from, to });
  }

  checkoutCommit(hash: string): Promise<void> {
    return transport.call('commit.checkout', { path: this.path, hash });
  }

  fetch(remote?: string): Promise<{ output: string }> {
    return transport.call('repo.fetch', { path: this.path, remote });
  }

  /**
   * The diff of one file. Leave `hash` out for the working tree against HEAD,
   * or name a commit to see what that commit did to the file.
   */
  fileDiff(options: {
    file: string;
    origPath?: string | null;
    hash?: string | null;
    /** Names the other side outright, for a diff between two revisions. */
    base?: string | null;
    context?: number;
  }): Promise<FileDiff> {
    return transport.call('diff.file', { path: this.path, ...options });
  }

  /**
   * The statistics report: one read-only pass over the log.
   *
   * Everything the report shows comes from this one call, so no two numbers
   * in it can have been read at different moments.
   */
  stats(range: Partial<StatsRange> & { limit?: number } = {}): Promise<StatsReport> {
    return transport.call('stats.report', { path: this.path, ...range });
  }

  /* The shelf, which is Git's stash. */

  stashes(): Promise<{ stashes: Stash[] }> {
    return transport.call('stash.list', { path: this.path });
  }

  stashFiles(ref: string): Promise<{ files: StashFile[] }> {
    return transport.call('stash.files', { path: this.path, ref });
  }

  shelve(options: { message: string; paths: string[]; includeUntracked: boolean }): Promise<StashResult> {
    return transport.call('stash.create', { path: this.path, ...options });
  }

  /** `drop` makes this an unshelve: put it back, and take it off the shelf. */
  applyStash(ref: string, sha: string, drop: boolean): Promise<StashApplyResult> {
    return transport.call('stash.apply', { path: this.path, ref, sha, drop });
  }

  dropStash(ref: string, sha: string): Promise<{ ok: boolean }> {
    return transport.call('stash.drop', { path: this.path, ref, sha });
  }

  /** What HEAD holds, so the commit panel can describe an amend. */
  headCommit(): Promise<HeadCommit> {
    return transport.call('commit.head', { path: this.path });
  }

  /** Commit exactly these paths, leaving anything else staged where it is. */
  commit(paths: string[], message: string, amend = false): Promise<CommitResult> {
    return transport.call('changes.commit', { path: this.path, paths, message, amend });
  }

  /** Mark conflicted files as dealt with, so an operation can continue. */
  markResolved(paths: string[]): Promise<{ ok: boolean; resolved: number }> {
    return transport.call('changes.markResolved', { path: this.path, paths });
  }

  /** Throw away the working-tree changes to these paths. */
  rollback(paths: string[]): Promise<RollbackResult> {
    return transport.call('changes.rollback', { path: this.path, paths });
  }

  push(options: { remote?: string; setUpstream?: boolean } = {}): Promise<PushResult> {
    return transport.call('repo.push', { path: this.path, ...options });
  }

  /** Safety probe run before offering a destructive branch action. */
  inspectBranch(name: string): Promise<BranchInspection> {
    return transport.call('branch.inspect', { path: this.path, name });
  }

  /** Full messages, used to seed the squash dialog. Newest first. */
  commitMessages(hashes: string[]): Promise<{ messages: CommitMessage[] }> {
    return transport.call('commits.messages', { path: this.path, hashes });
  }

  /** Safety probe for a cherry-pick or a revert. Hashes come newest first. */
  inspectApply(hashes: string[], mode: 'cherry-pick' | 'revert'): Promise<ApplyInspection> {
    return transport.call('commits.inspectApply', { path: this.path, hashes, mode });
  }

  /** Copy commits onto the current branch. Hashes come newest first. */
  cherryPick(hashes: string[]): Promise<ApplyResult> {
    return transport.call('commits.cherryPick', { path: this.path, hashes });
  }

  /** Undo commits with new commits that reverse them. */
  revert(hashes: string[], mainline = 1): Promise<ApplyResult> {
    return transport.call('commits.revert', { path: this.path, hashes, mainline });
  }

  /** What a reset would cost, read before anything moves. */
  inspectReset(target: string): Promise<ResetInspection> {
    return transport.call('branch.inspectReset', { path: this.path, target });
  }

  reset(target: string, mode: ResetMode): Promise<ResetResult> {
    return transport.call('branch.reset', { path: this.path, target, mode });
  }

  /** Abandon a half-finished merge, rebase, cherry-pick or revert. */
  abortOperation(): Promise<OperationResult> {
    return transport.call('repo.abortOperation', { path: this.path });
  }

  /** Carry on with one, once its conflicts are resolved. */
  continueOperation(): Promise<OperationResult> {
    return transport.call('repo.continueOperation', { path: this.path });
  }

  /** Everything the squash dialog needs to know. Hashes come newest first. */
  inspectSquash(hashes: string[]): Promise<SquashInspection> {
    return transport.call('commits.inspectSquash', { path: this.path, hashes });
  }

  squash(hashes: string[], message: string): Promise<SquashResult> {
    return transport.call('commits.squash', { path: this.path, hashes, message });
  }
}
