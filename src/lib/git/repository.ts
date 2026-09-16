/**
 * The Git service described in the project plan, section 11.
 *
 * UI components call these methods. They never see a command line, a flag,
 * or a transport detail.
 */
import { transport } from './transport';
import type {
  BranchSet, BranchInspection, CommitDetails, CommitMessage, CommitResult, FileDiff, GitStatus,
  HeadCommit, HeadInfo, LogPage, PushResult, RepositoryInfo, RollbackResult,
  SquashInspection, SquashResult
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

  log(options: { limit?: number; all?: boolean } = {}): Promise<LogPage> {
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
  fileDiff(options: { file: string; origPath?: string | null; hash?: string | null; context?: number }): Promise<FileDiff> {
    return transport.call('diff.file', { path: this.path, ...options });
  }

  /** What HEAD holds, so the commit panel can describe an amend. */
  headCommit(): Promise<HeadCommit> {
    return transport.call('commit.head', { path: this.path });
  }

  /** Commit exactly these paths, leaving anything else staged where it is. */
  commit(paths: string[], message: string, amend = false): Promise<CommitResult> {
    return transport.call('changes.commit', { path: this.path, paths, message, amend });
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

  /** Everything the squash dialog needs to know. Hashes come newest first. */
  inspectSquash(hashes: string[]): Promise<SquashInspection> {
    return transport.call('commits.inspectSquash', { path: this.path, hashes });
  }

  squash(hashes: string[], message: string): Promise<SquashResult> {
    return transport.call('commits.squash', { path: this.path, hashes, message });
  }
}
