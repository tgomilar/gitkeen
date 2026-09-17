/**
 * Centralised repository state (plan section 12).
 *
 * Git operations can change several parts of state at once, so every mutating
 * method re-reads from Git afterwards rather than patching state optimistically.
 */
import { GitRepository } from '../git/repository';
import { GitCallError } from '../git/transport';
import { layoutGraph } from '../graph/layout';
import type {
  ApplyInspection, ApplyResult, Branch, BranchSet, Commit, CommitDetails, GitStatus, HeadInfo,
  RepositoryInfo, ResetInspection, ResetMode, SquashInspection, SquashResult, Stash
} from '../git/types';
import { toasts } from './toasts.svelte';
import { rememberRepo } from './recent';

const LOG_LIMIT = 5000;

class RepoStore {
  repo = $state<GitRepository | null>(null);
  info = $state<RepositoryInfo | null>(null);

  commits = $state<Commit[]>([]);
  truncated = $state(false);
  branches = $state<BranchSet>({ local: [], remote: [], tags: [] });
  status = $state<GitStatus | null>(null);
  head = $state<HeadInfo | null>(null);
  remotes = $state<string[]>([]);
  /** The shelf, which is Git's stash list. Newest first. */
  stashes = $state<Stash[]>([]);

  /**
   * The branch, remote branch or tag the graph is narrowed to, or null for
   * every branch. Picking a branch in the sidebar sets it.
   */
  scope = $state<{ ref: string; kind: 'local' | 'remote' | 'tag' } | null>(null);

  /** Selected commit hashes, kept in graph order. */
  selection = $state<string[]>([]);
  /** Keyboard cursor. Always a selected commit when the selection is non-empty. */
  cursor = $state<string | null>(null);
  /** Anchor for shift-range selection. */
  private anchor: string | null = null;

  details = $state<CommitDetails | null>(null);
  detailsFor = $state<string | null>(null);

  opening = $state(false);
  refreshing = $state(false);
  /** Label of the Git operation currently running, or null. */
  busy = $state<string | null>(null);
  openError = $state<string | null>(null);

  filter = $state('');

  layout = $derived(layoutGraph(this.commits));

  selectedSet = $derived(new Set(this.selection));

  /** Rows surviving the search box, with their original graph row index. */
  visibleRows = $derived.by(() => {
    const q = this.filter.trim().toLowerCase();
    const rows = this.layout.rows;
    if (!q) return rows;
    return rows.filter((r) =>
      r.commit.subject.toLowerCase().includes(q) ||
      r.commit.author.toLowerCase().includes(q) ||
      r.commit.hash.startsWith(q) ||
      r.commit.refs.some((ref) => ref.name.toLowerCase().includes(q))
    );
  });

  currentBranch = $derived(this.head?.branch ?? null);

  dirtyFileCount = $derived(
    this.status ? this.status.files.filter((f) => f.state !== 'untracked').length : 0
  );

  isDirty = $derived(this.dirtyFileCount > 0);

  commitByHash(hash: string): Commit | undefined {
    const i = this.layout.index.get(hash);
    return i === undefined ? undefined : this.commits[i];
  }

  async open(path: string) {
    this.opening = true;
    this.openError = null;
    try {
      const repo = await GitRepository.open(path);
      this.repo = repo;
      this.info = repo.info;
      this.selection = [];
      this.cursor = null;
      this.anchor = null;
      this.details = null;
      this.detailsFor = null;
      this.filter = '';
      this.scope = null;
      rememberRepo(repo.info.root, repo.info.name);
      await this.refresh();
      // Start on HEAD so the view is never empty.
      if (this.head?.oid && this.layout.index.has(this.head.oid)) {
        this.select(this.head.oid, 'replace');
      }
    } catch (err) {
      this.openError = describe(err);
      this.repo = null;
      this.info = null;
    } finally {
      this.opening = false;
    }
  }

  close() {
    this.repo = null;
    this.info = null;
    this.commits = [];
    this.branches = { local: [], remote: [], tags: [] };
    this.status = null;
    this.head = null;
    this.stashes = [];
    this.selection = [];
    this.cursor = null;
    this.details = null;
    this.detailsFor = null;
    this.scope = null;
  }

  /** What to ask the log for, given the branch the graph is narrowed to. */
  private logOptions() {
    return this.scope
      ? { limit: LOG_LIMIT, refs: [this.scope.ref] }
      : { limit: LOG_LIMIT, all: true };
  }

  /**
   * Narrow the graph to one ref, or pass null for every branch. Nothing in
   * Git changed, so only the log is re-read.
   */
  async setScope(scope: { ref: string; kind: 'local' | 'remote' | 'tag' } | null) {
    const same = this.scope?.ref === scope?.ref && this.scope?.kind === scope?.kind;
    if (same) return;
    this.scope = scope;
    await this.reloadLog();
    // The commit that was selected may not be on this branch. Fall back to
    // its tip, so the details panel is never left empty.
    if (this.selection.length === 0 && this.layout.rows.length > 0) {
      this.select(this.layout.rows[0].commit.hash, 'replace');
    }
  }

  private async reloadLog() {
    const repo = this.repo;
    if (!repo) return;
    this.refreshing = true;
    try {
      const log = await repo.log(this.logOptions());
      this.commits = log.commits;
      this.truncated = log.truncated;
      this.pruneSelection();
    } catch (err) {
      toasts.error('Could not read the history', describe(err));
    } finally {
      this.refreshing = false;
    }
  }

  /** Drop selected commits that the graph no longer holds. */
  private pruneSelection() {
    const live = new Set(this.commits.map((c) => c.hash));
    const kept = this.selection.filter((h) => live.has(h));
    if (kept.length !== this.selection.length) this.selection = kept;
    if (this.cursor && !live.has(this.cursor)) this.cursor = kept[0] ?? null;
  }

  async refresh() {
    const repo = this.repo;
    if (!repo) return;
    this.refreshing = true;
    try {
      const [log, branches, status, head, remotes, stashes] = await Promise.all([
        repo.log(this.logOptions()),
        repo.branches(),
        repo.status(),
        repo.head(),
        repo.remotes(),
        repo.stashes()
      ]);
      this.commits = log.commits;
      this.truncated = log.truncated;
      this.branches = branches;
      this.status = status;
      this.head = head;
      this.remotes = remotes.remotes;
      this.stashes = stashes.stashes;

      // A branch the graph was narrowed to can be deleted or renamed under
      // us, and then the scope is meaningless: widen back to every branch.
      if (this.scope && !this.refExists(this.scope)) {
        this.scope = null;
        const all = await repo.log(this.logOptions());
        this.commits = all.commits;
        this.truncated = all.truncated;
      }

      // Drop selected commits that no longer exist (e.g. after a rewrite).
      this.pruneSelection();
    } catch (err) {
      toasts.error('Could not read the repository', describe(err));
    } finally {
      this.refreshing = false;
    }
  }

  /** Selection modes mirror a normal list: plain click, toggle, range. */
  select(hash: string, mode: 'replace' | 'toggle' | 'range' = 'replace') {
    if (mode === 'replace') {
      this.selection = [hash];
      this.anchor = hash;
    } else if (mode === 'toggle') {
      this.selection = this.selection.includes(hash)
        ? this.selection.filter((h) => h !== hash)
        : this.orderHashes([...this.selection, hash]);
      this.anchor = hash;
    } else {
      const rows = this.visibleRows;
      const from = rows.findIndex((r) => r.commit.hash === (this.anchor ?? hash));
      const to = rows.findIndex((r) => r.commit.hash === hash);
      if (from === -1 || to === -1) {
        this.selection = [hash];
        this.anchor = hash;
      } else {
        const [lo, hi] = from <= to ? [from, to] : [to, from];
        this.selection = rows.slice(lo, hi + 1).map((r) => r.commit.hash);
      }
    }
    this.cursor = hash;
  }

  /** Keep a selection in graph order so operations read top-to-bottom. */
  private orderHashes(hashes: string[]): string[] {
    const set = new Set(hashes);
    return this.layout.rows.filter((r) => set.has(r.commit.hash)).map((r) => r.commit.hash);
  }

  /** Move the keyboard cursor by `delta` rows within the visible list. */
  moveCursor(delta: number, extend = false) {
    const rows = this.visibleRows;
    if (rows.length === 0) return;
    const current = this.cursor ? rows.findIndex((r) => r.commit.hash === this.cursor) : -1;
    const next = Math.max(0, Math.min(rows.length - 1, (current === -1 ? 0 : current + delta)));
    this.select(rows[next].commit.hash, extend ? 'range' : 'replace');
  }

  async loadDetails(hash: string) {
    const repo = this.repo;
    if (!repo) return;
    this.detailsFor = hash;
    try {
      const details = await repo.commitDetails(hash);
      // A newer selection may have landed while this was in flight.
      if (this.detailsFor === hash) this.details = details;
    } catch (err) {
      if (this.detailsFor === hash) {
        this.details = null;
        toasts.error('Could not load commit details', describe(err));
      }
    }
  }

  /** Run a Git operation with one busy label, one refresh and one message. */
  private async operate<T>(label: string, run: (repo: GitRepository) => Promise<T>, done: string) {
    const repo = this.repo;
    if (!repo) return false;
    this.busy = label;
    try {
      await run(repo);
      await this.refresh();
      toasts.success(done);
      return true;
    } catch (err) {
      toasts.error(`${label} failed`, describe(err));
      return false;
    } finally {
      this.busy = null;
    }
  }

  switchBranch(name: string) {
    return this.operate(`Switching to ${name}`, (r) => r.switchBranch(name), `Switched to ${name}`);
  }

  createBranch(name: string, from?: string, checkout = true) {
    return this.operate(
      `Creating ${name}`,
      (r) => r.createBranch(name, from, checkout),
      checkout ? `Created and switched to ${name}` : `Created ${name}`
    );
  }

  deleteBranch(name: string, force = false) {
    return this.operate(`Deleting ${name}`, (r) => r.deleteBranch(name, force), `Deleted ${name}`);
  }

  renameBranch(from: string, to: string) {
    return this.operate(`Renaming ${from}`, (r) => r.renameBranch(from, to), `Renamed to ${to}`);
  }

  checkoutCommit(hash: string) {
    const short = hash.slice(0, 7);
    return this.operate(
      `Checking out ${short}`,
      (r) => r.checkoutCommit(hash),
      `HEAD is now at ${short} (detached)`
    );
  }

  fetch(remote?: string) {
    return this.operate('Fetching', (r) => r.fetch(remote), 'Fetch complete');
  }

  inspectBranch(name: string) {
    const repo = this.repo;
    if (!repo) return Promise.resolve(null);
    return repo.inspectBranch(name).catch(() => null);
  }

  inspectApply(hashes: string[], mode: 'cherry-pick' | 'revert'): Promise<ApplyInspection> {
    const repo = this.repo;
    if (!repo) return Promise.resolve({ ok: false, problems: ['No repository is open.'] });
    return repo.inspectApply(hashes, mode).catch((err) => ({ ok: false, problems: [describe(err)] }));
  }

  inspectReset(target: string): Promise<ResetInspection> {
    const repo = this.repo;
    if (!repo) return Promise.resolve({ ok: false, problems: ['No repository is open.'] });
    return repo.inspectReset(target).catch((err) => ({ ok: false, problems: [describe(err)] }));
  }

  /**
   * Cherry-pick or revert.
   *
   * A conflict is not a failure. Git stops and waits, so the result says so
   * and the status bar offers to continue or to abandon it.
   */
  private async apply(
    label: string,
    run: (repo: GitRepository) => Promise<ApplyResult>,
    describeDone: (result: ApplyResult) => string
  ): Promise<ApplyResult | null> {
    const repo = this.repo;
    if (!repo) return null;
    this.busy = label;
    try {
      const result = await run(repo);
      await this.refresh();
      if (result.conflicted) {
        toasts.error(
          `${label} stopped on a conflict`,
          'Resolve the conflicted files, then continue or abandon it from the status bar.'
        );
      } else {
        toasts.success(describeDone(result), `The branch was at ${result.previousHead.slice(0, 7)} before.`);
      }
      return result;
    } catch (err) {
      toasts.error(`${label} failed`, describe(err));
      await this.refresh();
      return null;
    } finally {
      this.busy = null;
    }
  }

  cherryPick(hashes: string[]) {
    const label = hashes.length === 1 ? 'Copying 1 commit' : `Copying ${hashes.length} commits`;
    return this.apply(
      label,
      (r) => r.cherryPick(hashes),
      (result) => `Copied ${result.applied} ${result.applied === 1 ? 'commit' : 'commits'} onto ${this.currentBranch ?? 'HEAD'}`
    );
  }

  revert(hashes: string[], mainline = 1) {
    const label = hashes.length === 1 ? 'Reverting 1 commit' : `Reverting ${hashes.length} commits`;
    return this.apply(
      label,
      (r) => r.revert(hashes, mainline),
      (result) => `Reverted ${result.applied} ${result.applied === 1 ? 'commit' : 'commits'}`
    );
  }

  async reset(target: string, mode: ResetMode) {
    const repo = this.repo;
    if (!repo) return null;
    this.busy = 'Resetting';
    try {
      const result = await repo.reset(target, mode);
      await this.refresh();
      if (this.layout.index.has(result.head)) this.select(result.head, 'replace');
      toasts.success(
        `${this.currentBranch ?? 'HEAD'} is now at ${result.head.slice(0, 7)}`,
        `It was at ${result.previousHead.slice(0, 7)} before. Run "git reset --${mode} ${result.previousHead.slice(0, 12)}" to put it back.`
      );
      return result;
    } catch (err) {
      toasts.error('Reset failed', describe(err));
      await this.refresh();
      return null;
    } finally {
      this.busy = null;
    }
  }

  abortOperation() {
    const name = this.status?.operation ?? 'operation';
    return this.operate(`Abandoning the ${name}`, (r) => r.abortOperation(), `The ${name} was abandoned`);
  }

  async continueOperation() {
    const name = this.status?.operation ?? 'operation';
    const repo = this.repo;
    if (!repo) return false;
    this.busy = `Continuing the ${name}`;
    try {
      const result = await repo.continueOperation();
      await this.refresh();
      toasts.success(
        result.finished ? `The ${name} finished` : `The ${name} moved on`,
        result.finished ? null : 'There is more to resolve.'
      );
      return true;
    } catch (err) {
      toasts.error(`Could not continue the ${name}`, describe(err));
      await this.refresh();
      return false;
    } finally {
      this.busy = null;
    }
  }

  inspectSquash(hashes: string[]): Promise<SquashInspection> {
    const repo = this.repo;
    if (!repo) return Promise.resolve({ ok: false, problems: ['No repository is open.'] });
    return repo
      .inspectSquash(hashes)
      .catch((err) => ({ ok: false, problems: [describe(err)] }));
  }

  commitMessages(hashes: string[]) {
    const repo = this.repo;
    if (!repo) return Promise.resolve({ messages: [] });
    return repo.commitMessages(hashes).catch(() => ({ messages: [] }));
  }

  /**
   * Squash and then select the commit that replaced the selection, so the
   * user's place in the graph is not lost.
   */
  async squash(hashes: string[], message: string): Promise<SquashResult | null> {
    const repo = this.repo;
    if (!repo) return null;
    this.busy = `Squashing ${hashes.length} commits`;
    try {
      const result = await repo.squash(hashes, message);
      await this.refresh();
      if (this.layout.index.has(result.commit)) this.select(result.commit, 'replace');
      toasts.success(
        `Squashed ${hashes.length} commits into ${result.commit.slice(0, 7)}`,
        `The branch was at ${result.previousHead.slice(0, 7)} before. Run "git reset --hard ${result.previousHead.slice(0, 12)}" to undo this.`
      );
      return result;
    } catch (err) {
      toasts.error('Squash failed', describe(err));
      await this.refresh();
      return null;
    } finally {
      this.busy = null;
    }
  }

  private refExists(scope: { ref: string; kind: 'local' | 'remote' | 'tag' }) {
    const list = scope.kind === 'local' ? this.branches.local
      : scope.kind === 'remote' ? this.branches.remote
      : this.branches.tags;
    return list.some((b) => b.name === scope.ref);
  }

  /** Every branch head that points at a given commit. */
  branchesAt(hash: string): Branch[] {
    return [...this.branches.local, ...this.branches.remote].filter((b) => b.oid === hash);
  }
}

export function describe(err: unknown): string {
  if (err instanceof GitCallError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

export const repoStore = new RepoStore();
export type { GitStatus, HeadInfo };
