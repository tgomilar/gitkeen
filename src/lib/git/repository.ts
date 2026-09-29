/**
 * The Git service described in the project plan, section 11.
 *
 * UI components call these methods. They never see a command line, a flag,
 * or a transport detail.
 */
import { transport } from './transport';
import type {
  ApplyInspection, ApplyResult, BranchSet, BranchInspection, CommitDetails, CommitMessage,
  CommitResult, DropResult, FileDiff, GitStatus, HeadCommit, HeadInfo, LogPage, MoveResult,
  MergeOffer, OperationResult, RebasePlanEntry, RebaseResult, RebaseSpan, RewriteInspection,
  ForcePushInspection, MergeInspection, MergeResult, PullInspection, PullResult, PushOptions, PushResult, RepositoryInfo, ResetInspection, ResetMode, ResetResult, RollbackResult,
  SquashInspection, SquashResult, Stash, StashApplyResult, TagInspection,
  StashFile, StashResult, StatsRange, StatsReport, Suggestion, SuggestProviders,
  KeyStatus
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

  /**
   * One page of the log. `refs` narrows it to what those refs reach (e.g. a
   * single branch); `skip` jumps past commits already shown, so the graph can
   * be walked deeper without holding the whole history.
   */
  log(options: { limit?: number; all?: boolean; refs?: string[]; skip?: number } = {}): Promise<LogPage> {
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
   * or name a commit to see what that commit did to the file. For a working
   * tree file, `side` picks one half of it: what is staged (`staged`) or what
   * still waits to be (`unstaged`).
   */
  fileDiff(options: {
    file: string;
    origPath?: string | null;
    hash?: string | null;
    /** Names the other side outright, for a diff between two revisions. */
    base?: string | null;
    side?: 'staged' | 'unstaged' | null;
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

  /* Stashes. */

  stashes(): Promise<{ stashes: Stash[] }> {
    return transport.call('stash.list', { path: this.path });
  }

  stashFiles(ref: string): Promise<{ files: StashFile[] }> {
    return transport.call('stash.files', { path: this.path, ref });
  }

  createStash(options: { message: string; paths: string[]; includeUntracked: boolean }): Promise<StashResult> {
    return transport.call('stash.create', { path: this.path, ...options });
  }

  /** `drop` makes this an unstash: put it back, and remove the stash. */
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

  /** Stage or unstage whole files, the box in the commit panel. */
  stage(paths: string[], on: boolean): Promise<{ ok: boolean; staged: number }> {
    return transport.call('changes.stage', { path: this.path, paths, on });
  }

  /**
   * Stage or unstage individual hunks of one file. `hunks` come from a
   * `fileDiff` of the matching `side`.
   */
  stageHunks(file: string, side: 'staged' | 'unstaged', hunks: FileDiff['hunks']): Promise<{ ok: boolean; applied: number }> {
    return transport.call('changes.stageHunks', { path: this.path, file, side, hunks });
  }

  /** Commit the staged working tree: exactly the ticked files and hunks. */
  commit(paths: string[], message: string, amend = false): Promise<CommitResult> {
    return transport.call('changes.commit', { path: this.path, paths, message, amend });
  }

  /** Where each AI key comes from. Never returns a key. */
  keyStatus(): Promise<KeyStatus> {
    return transport.call('settings.keyStatus', {});
  }

  /** Save an AI key, or clear it by passing an empty string. */
  setKey(provider: string, key: string): Promise<KeyStatus> {
    return transport.call('settings.setKey', { provider, key });
  }

  /** Which AI providers are configured on the backend. */
  suggestProviders(): Promise<SuggestProviders> {
    return transport.call('commit.suggestProviders', {});
  }

  /** Ask for a commit subject describing exactly these paths. */
  suggest(paths: string[], options: { provider?: string | null; amend?: boolean } = {}): Promise<Suggestion> {
    return transport.call('commit.suggest', {
      path: this.path,
      paths,
      provider: options.provider ?? null,
      amend: options.amend ?? false
    });
  }

  /** Mark conflicted files as dealt with, so an operation can continue. */
  markResolved(paths: string[]): Promise<{ ok: boolean; resolved: number }> {
    return transport.call('changes.markResolved', { path: this.path, paths });
  }

  /** What the merge editor needs about a conflicted file, in one read. */
  conflictRead(file: string): Promise<MergeOffer> {
    return transport.call('conflicts.read', { path: this.path, file });
  }

  /** Write a merged file back and mark it resolved, in one step. */
  conflictResolve(file: string, content: string): Promise<{ ok: boolean; resolved: number }> {
    return transport.call('conflicts.resolve', { path: this.path, file, content });
  }

  /** Throw away the working-tree changes to these paths. */
  rollback(paths: string[]): Promise<RollbackResult> {
    return transport.call('changes.rollback', { path: this.path, paths });
  }

  /** What a pull would bring in. Read-only, but it fetches first. */
  inspectPull(): Promise<PullInspection> {
    return transport.call('repo.inspectPull', { path: this.path });
  }

  /** Bring the upstream branch in, as a merge. */
  pull(): Promise<PullResult> {
    return transport.call('repo.pull', { path: this.path });
  }

  /** What merging a branch into the current one would do. Read-only. */
  inspectMerge(source: string): Promise<MergeInspection> {
    return transport.call('repo.inspectMerge', { path: this.path, source });
  }

  /** Merge a branch into the one checked out. */
  merge(source: string): Promise<MergeResult> {
    return transport.call('repo.merge', { path: this.path, source });
  }

  /** What a force push would overwrite. Read-only. Defaults to the checked-out branch. */
  inspectForcePush(branch?: string): Promise<ForcePushInspection> {
    return transport.call('repo.inspectForcePush', { path: this.path, branch: branch ?? null });
  }

  push(options: PushOptions = {}): Promise<PushResult> {
    return transport.call('repo.push', { path: this.path, ...options });
  }

  /* Tags. A message makes the tag annotated; without one it is lightweight. */

  createTag(name: string, at: string | null, message: string): Promise<{ ok: boolean; name: string; annotated: boolean }> {
    return transport.call('tag.create', { path: this.path, name, at, message });
  }

  /** What deleting a tag would cost. Read-only, and it asks the remotes. */
  inspectTag(name: string): Promise<TagInspection> {
    return transport.call('tag.inspect', { path: this.path, name });
  }

  deleteTag(name: string): Promise<{ ok: boolean; name: string }> {
    return transport.call('tag.delete', { path: this.path, name });
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

  /* Moving and removing commits, both of which rewrite history. */

  inspectRewrite(hashes: string[], mode: 'drop' | 'move'): Promise<RewriteInspection> {
    return transport.call('commits.inspectRewrite', { path: this.path, hashes, mode });
  }

  /** Remove commits from the branch. Hashes come newest first. */
  drop(hashes: string[]): Promise<DropResult> {
    return transport.call('commits.drop', { path: this.path, hashes });
  }

  /** Move one commit one place towards HEAD (`up`) or away from it (`down`). */
  move(hash: string, direction: 'up' | 'down'): Promise<MoveResult> {
    return transport.call('commits.move', { path: this.path, hash, direction });
  }

  /** The commits an interactive rebase would cover, oldest first. */
  rebaseSpan(from: string): Promise<RebaseSpan> {
    return transport.call('commits.rebaseSpan', { path: this.path, from });
  }

  /** Run an interactive rebase from a plan the editor built. */
  rebase(from: string, plan: RebasePlanEntry[]): Promise<RebaseResult> {
    return transport.call('commits.rebase', { path: this.path, from, plan });
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

  /**
   * Carry on with one, once its conflicts are resolved.
   *
   * The plan comes with the continue when the operation is a rebase that
   * paused at an `edit`, so the messages still to be written are remembered.
   */
  continueOperation(plan?: RebasePlanEntry[]): Promise<OperationResult> {
    return transport.call('repo.continueOperation', { path: this.path, plan });
  }

  /** Everything the squash dialog needs to know. Hashes come newest first. */
  inspectSquash(hashes: string[]): Promise<SquashInspection> {
    return transport.call('commits.inspectSquash', { path: this.path, hashes });
  }

  squash(hashes: string[], message: string): Promise<SquashResult> {
    return transport.call('commits.squash', { path: this.path, hashes, message });
  }
}
