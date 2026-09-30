/**
 * Centralised repository state (plan section 12).
 *
 * Git operations can change several parts of state at once, so every mutating
 * method re-reads from Git afterwards rather than patching state optimistically.
 */
import { GitRepository } from '../git/repository';
import { GitCallError } from '../git/transport';
import { layoutGraph, type GraphLayout } from '../graph/layout';
import type {
  ApplyInspection, ApplyResult, Branch, BranchSet, Commit, CommitDetails, DropResult, GitStatus,
  HeadInfo, MoveResult, RebasePlanEntry, RebaseSpan, RewriteInspection,
  MergeInspection, MergeResult, PullInspection, PullResult, RepositoryInfo, ResetInspection,
  ResetMode, SquashInspection, SquashResult, Stash, TagInspection
} from '../git/types';
import { pluralize } from '../format';
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
  /** Git's stash list. Newest first. */
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
  /** True while the next page of history is being read. */
  loadingOlder = $state(false);
  /**
   * Bumped whenever the graph starts over from its newest page. A page of
   * older history read before that no longer follows on from what is shown.
   */
  private logGeneration = 0;
  /** Label of the Git operation currently running, or null. */
  busy = $state<string | null>(null);
  openError = $state<string | null>(null);

  filter = $state('');

  /**
   * The graph's lanes for `commits`. Kept rather than derived, so a page of
   * older history is laid out on top of the rows already drawn instead of the
   * whole history being laid out again.
   */
  layout = $state.raw<GraphLayout>(layoutGraph([]));

  /** Replace the commits shown, or with `older`, add a page beneath them. */
  private setCommits(commits: Commit[], older?: Commit[]) {
    if (older) {
      this.layout = layoutGraph(older, this.layout);
      this.commits = commits.concat(older);
    } else {
      this.layout = layoutGraph(commits);
      this.commits = commits;
    }
  }

  selectedSet = $derived(new Set(this.selection));

  /**
   * What Git found for the search box across the whole history, and the
   * query it answers. Null until the search for the current text is back.
   */
  searchResults = $state.raw<{ query: string; commits: Commit[]; truncated: boolean } | null>(null);
  searching = $state(false);
  private searchGeneration = 0;

  /** Commits found by the search that the graph has not loaded, by hash. */
  private searchExtra = $derived(
    new Map((this.searchResults?.commits ?? []).filter((c) => !this.layout.index.has(c.hash)).map((c) => [c.hash, c]))
  );

  /**
   * Rows surviving the search box.
   *
   * The loaded rows are filtered straight away, as the user types. When
   * Git's search of the whole history comes back, its matches join them:
   * a loaded one keeps its graph row, and an older one is shown as a commit
   * with no lanes, since its place in the graph is not loaded.
   */
  visibleRows = $derived.by(() => {
    const q = this.filter.trim().toLowerCase();
    const rows = this.layout.rows;
    if (!q) return rows;
    const found = this.searchResults?.query === this.filter.trim() ? this.searchResults.commits : [];
    const hits = new Set(found.map((c) => c.hash));
    const shown = rows.filter((r) =>
      hits.has(r.commit.hash) ||
      r.commit.subject.toLowerCase().includes(q) ||
      r.commit.author.toLowerCase().includes(q) ||
      r.commit.hash.startsWith(q) ||
      r.commit.refs.some((ref) => ref.name.toLowerCase().includes(q))
    );
    const older = found
      .filter((c) => !this.layout.index.has(c.hash))
      .map((commit) => ({ commit, lane: 0, passes: [], incoming: [], outgoing: [] }));
    return older.length > 0 ? shown.concat(older) : shown;
  });

  /**
   * Search the whole history for the text in the search box.
   *
   * Called a moment after the user stops typing. Only the newest search
   * counts: an answer that arrives after the text changed again is dropped.
   */
  async search(text: string) {
    const repo = this.repo;
    const query = text.trim();
    const generation = ++this.searchGeneration;
    if (!repo || !query) {
      this.searchResults = null;
      this.searching = false;
      return;
    }
    this.searching = true;
    try {
      const refs = this.scope ? [this.scope.ref] : undefined;
      const result = await repo.search(query, refs);
      if (generation !== this.searchGeneration || repo !== this.repo) return;
      this.searchResults = { query, commits: result.commits, truncated: result.truncated };
    } catch (err) {
      if (generation === this.searchGeneration) toasts.error('Could not search the history', describe(err));
    } finally {
      if (generation === this.searchGeneration) this.searching = false;
    }
  }

  currentBranch = $derived(this.head?.branch ?? null);

  dirtyFileCount = $derived(
    this.status ? this.status.files.filter((f) => f.state !== 'untracked').length : 0
  );

  isDirty = $derived(this.dirtyFileCount > 0);

  commitByHash(hash: string): Commit | undefined {
    const i = this.layout.index.get(hash);
    return i === undefined ? this.searchExtra.get(hash) : this.commits[i];
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
    this.logGeneration++;
    this.setCommits([]);
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
  private logOptions(skip = 0, limit = LOG_LIMIT) {
    return this.scope
      ? { limit, refs: [this.scope.ref], skip }
      : { limit, all: true, skip };
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
      const generation = ++this.logGeneration;
      const log = await repo.log(this.logOptions());
      if (repo !== this.repo || generation !== this.logGeneration) return;
      this.setCommits(log.commits);
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
      // The graph is the fastest thing to draw, so it is painted as soon as
      // the log lands instead of waiting for the slower status and branch
      // calls. Those still start at the same time, so the refresh as a whole
      // takes no longer than before.
      const generation = ++this.logGeneration;
      const rest = Promise.all([
        repo.branches(),
        repo.status(),
        repo.head(),
        repo.remotes(),
        repo.stashes()
      ]);
      // Nothing may reject unobserved while the log is awaited.
      rest.catch(() => {});
      // As deep as the user has already walked, so a refresh after an
      // operation does not throw away the pages they loaded. With the whole
      // history on screen, a page's worth of room is added, so commits made
      // since cannot push the oldest ones off the end.
      const depth = Math.max(LOG_LIMIT, this.commits.length + (this.truncated ? 0 : LOG_LIMIT));
      const log = await repo.log(this.logOptions(0, depth));
      if (repo !== this.repo) return;
      const current = generation === this.logGeneration;
      if (current) {
        this.setCommits(log.commits);
        this.truncated = log.truncated;
      }

      const [branches, status, head, remotes, stashes] = await rest;
      if (repo !== this.repo) return;
      const branchBefore = this.currentBranch;
      this.branches = branches;
      this.status = status;
      this.head = head;
      this.remotes = remotes.remotes;
      this.stashes = stashes.stashes;

      // A branch the graph was narrowed to can be deleted or renamed under
      // us, and then the scope is meaningless: widen back to every branch.
      // The selection is pruned only after that, so a commit that is still
      // there under "all branches" stays selected.
      //
      // A switch to another branch moves the narrowing with it: the graph was
      // narrowed to where the user was working, and staying on the old branch
      // would hide every commit they now make.
      const switched = branchBefore !== null && this.currentBranch !== branchBefore
        && !(this.scope?.kind === 'local' && this.scope.ref === this.currentBranch);
      if (this.scope && (switched || !this.refExists(this.scope))) {
        this.scope = switched && this.currentBranch ? { ref: this.currentBranch, kind: 'local' } : null;
        const widened = ++this.logGeneration;
        const all = await repo.log(this.logOptions());
        if (repo !== this.repo || widened !== this.logGeneration) return;
        this.setCommits(all.commits);
        this.truncated = all.truncated;
        this.pruneSelection();
      } else if (current) {
        this.pruneSelection();
      }
    } catch (err) {
      toasts.error('Could not read the repository', describe(err));
    } finally {
      this.refreshing = false;
    }
  }

  /**
   * Read the next page of history and append it beneath the graph.
   *
   * The graph window never loads the whole history: every page walks deeper
   * with `--skip`, and the DOM holds only the visible rows. A refresh reads
   * as deep as the pages already loaded, so an operation part way down a
   * long history leaves the user where they were. Narrowing to a branch
   * starts again from its newest page.
   */
  async loadOlder() {
    const repo = this.repo;
    if (!repo || !this.truncated || this.loadingOlder) return;
    this.loadingOlder = true;
    const generation = this.logGeneration;
    try {
      const log = await repo.log(this.logOptions(this.commits.length));
      // A refresh or a scope change landed meanwhile: this page followed on
      // from a graph that is gone, and appending it would leave a gap or
      // repeat commits.
      if (repo !== this.repo || generation !== this.logGeneration) return;
      const seen = new Set(this.commits.map((c) => c.hash));
      this.setCommits(this.commits, log.commits.filter((c) => !seen.has(c.hash)));
      this.truncated = log.truncated;
    } catch (err) {
      toasts.error('Could not read older commits', describe(err));
    } finally {
      this.loadingOlder = false;
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

  createTag(name: string, at: string | null, message: string) {
    return this.operate(
      `Creating ${name}`,
      (r) => r.createTag(name, at, message),
      message.trim() ? `Created annotated tag ${name}` : `Created tag ${name}`
    );
  }

  deleteTag(name: string) {
    return this.operate(`Deleting ${name}`, (r) => r.deleteTag(name), `Deleted tag ${name}`);
  }

  /**
   * Remove commits from the branch.
   *
   * Reported like a reset: the previous HEAD is named in the message, because
   * a rewrite cannot be undone through Gitkeen and that hash is what makes it
   * recoverable with `git reset` from the terminal.
   */
  async drop(hashes: string[]): Promise<DropResult | null> {
    const repo = this.repo;
    if (!repo) return null;
    this.busy = hashes.length === 1 ? 'Dropping 1 commit' : `Dropping ${hashes.length} commits`;
    try {
      const result = await repo.drop(hashes);
      await this.refresh();
      toasts.success(
        `Dropped ${pluralize(result.dropped, 'commit')}`,
        `The branch was at ${result.previousHead.slice(0, 7)} before.`
      );
      return result;
    } catch (err) {
      toasts.error('Could not drop', describe(err));
      await this.refresh();
      return null;
    } finally {
      this.busy = null;
    }
  }

  async move(hash: string, direction: 'up' | 'down'): Promise<MoveResult | null> {
    const repo = this.repo;
    if (!repo) return null;
    this.busy = 'Moving the commit';
    try {
      const result = await repo.move(hash, direction);
      await this.refresh();
      toasts.success(
        direction === 'up' ? 'Moved the commit later' : 'Moved the commit earlier',
        `The branch was at ${result.previousHead.slice(0, 7)} before.`
      );
      return result;
    } catch (err) {
      toasts.error('Could not move the commit', describe(err));
      await this.refresh();
      return null;
    } finally {
      this.busy = null;
    }
  }

  /**
   * Run an interactive rebase. Returns what happened to it, so the editor
   * knows whether to close and whether the branch only paused part-way.
   */
  async rebase(from: string, plan: RebasePlanEntry[]): Promise<{ ok: boolean; stopped: boolean; stoppedAt: string | null }> {
    const repo = this.repo;
    if (!repo) return { ok: false, stopped: false, stoppedAt: null };
    this.busy = 'Rebasing';
    try {
      const result = await repo.rebase(from, plan);
      await this.refresh();

      // An `edit` in the plan stops the rebase so the commit at that point
      // can be amended. That is not a finished run: the branch is mid-flight,
      // and the status bar's Continue takes over from here.
      if (result.stopped && result.conflicted) {
        toasts.info(
          'Rebase stopped on a conflict',
          `${result.stoppedAt?.slice(0, 7) ?? 'A commit'} does not apply cleanly. Resolve the conflicted files with Resolve… in the status bar, then Continue. Abandon puts the branch back as it was.`
        );
        return { ok: true, stopped: true, stoppedAt: result.stoppedAt };
      }
      if (result.stopped) {
        toasts.info(
          'Rebase paused',
          `It stopped at ${result.stoppedAt?.slice(0, 7) ?? 'a commit'} so that commit can be amended. Make the change, then Continue in the status bar.`
        );
        return { ok: true, stopped: true, stoppedAt: result.stoppedAt };
      }

      const parts: string[] = [];
      if (result.dropped > 0) parts.push(`${pluralize(result.dropped, 'commit')} dropped`);
      if (result.combined > 0) parts.push(`${pluralize(result.combined, 'commit')} folded in`);
      if (result.reworded > 0) parts.push(`${pluralize(result.reworded, 'message')} rewritten`);

      toasts.success(
        `Rebased ${this.currentBranch ?? 'HEAD'}`,
        `${parts.length > 0 ? parts.join(', ') + '. ' : ''}The branch was at ${result.previousHead.slice(0, 7)} before.`
      );
      return { ok: true, stopped: false, stoppedAt: null };
    } catch (err) {
      toasts.error('The rebase did not run', describe(err));
      await this.refresh();
      return { ok: false, stopped: false, stoppedAt: null };
    } finally {
      this.busy = null;
    }
  }

  /**
   * Continue a rebase that paused at an `edit`, carrying the rest of the plan.
   * Where it ended up tells the editor when to let the plan go.
   */
  async continueRebase(plan: RebasePlanEntry[]): Promise<{ ok: boolean; finished: boolean; stoppedAt: string | null }> {
    const repo = this.repo;
    if (!repo) return { ok: false, finished: false, stoppedAt: null };
    this.busy = 'Continuing the rebase';
    try {
      const result = await repo.continueOperation(plan);
      await this.refresh();
      if (result.finished === true) {
        toasts.success('Rebase finished', 'The rest of the plan was applied to the branch.');
      } else if (result.conflicted) {
        toasts.info('Rebase stopped on a conflict', `${result.stoppedAt?.slice(0, 7) ?? 'The next commit'} does not apply cleanly. Resolve it, then Continue again.`);
      } else if (result.stoppedAt) {
        toasts.info('Rebase paused again', `It stopped at ${result.stoppedAt.slice(0, 7)} to amend. Continue again when it is ready.`);
      } else {
        toasts.success('The rebase moved on', null);
      }
      return { ok: true, finished: result.finished === true, stoppedAt: result.stoppedAt ?? null };
    } catch (err) {
      toasts.error('The rebase did not continue', describe(err));
      await this.refresh();
      return { ok: false, finished: false, stoppedAt: null };
    } finally {
      this.busy = null;
    }
  }

  rebaseSpan(from: string): Promise<RebaseSpan> {
    const repo = this.repo;
    if (!repo) return Promise.resolve({ ok: false, problems: ['No repository is open.'] });
    return repo.rebaseSpan(from).catch((err) => ({ ok: false, problems: [describe(err)] }));
  }

  inspectRewrite(hashes: string[], mode: 'drop' | 'move'): Promise<RewriteInspection> {
    const repo = this.repo;
    if (!repo) return Promise.resolve({ ok: false, problems: ['No repository is open.'] });
    return repo.inspectRewrite(hashes, mode).catch((err) => ({ ok: false, problems: [describe(err)] }));
  }

  inspectTag(name: string): Promise<TagInspection | null> {
    const repo = this.repo;
    if (!repo) return Promise.resolve(null);
    return repo.inspectTag(name).catch(() => null);
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

  /**
   * Pull, which is a merge, so a conflict leaves it open rather than failing.
   *
   * Reported the way `apply` reports a cherry-pick, with one difference: a
   * pull that brought nothing in is worth saying plainly, rather than
   * announcing nought commits and the hash the branch has not moved from.
   */
  async pull(): Promise<PullResult | null> {
    const repo = this.repo;
    if (!repo) return null;
    this.busy = 'Pulling';
    try {
      const result = await repo.pull();
      await this.refresh();

      if (result.conflicted) {
        toasts.error(
          'The pull stopped on a conflict',
          'Resolve the conflicted files, then continue or abandon the merge from the status bar.'
        );
      } else if (result.upToDate) {
        toasts.info(`${this.currentBranch ?? 'The branch'} is already up to date`);
      } else {
        toasts.success(
          `Pulled ${result.applied} ${result.applied === 1 ? 'commit' : 'commits'} into ${this.currentBranch ?? 'HEAD'}`,
          `The branch was at ${result.previousHead.slice(0, 7)} before.`
        );
      }
      return result;
    } catch (err) {
      toasts.error('Pull failed', describe(err));
      await this.refresh();
      return null;
    } finally {
      this.busy = null;
    }
  }

  /**
   * Merge a branch into the one checked out.
   *
   * Reported like a pull: a conflict is not a failure, and a fast-forward is
   * worth naming, because a user who expected a merge commit and did not get
   * one should be told why rather than left to read the graph.
   */
  async merge(source: string): Promise<MergeResult | null> {
    const repo = this.repo;
    if (!repo) return null;
    this.busy = `Merging ${source}`;
    try {
      const result = await repo.merge(source);
      await this.refresh();

      if (result.conflicted) {
        toasts.error(
          `Merging ${source} stopped on a conflict`,
          'Resolve the conflicted files, then continue or abandon the merge from the status bar.'
        );
      } else if (result.upToDate) {
        toasts.info(`${source} was already merged`, 'Nothing changed.');
      } else {
        toasts.success(
          `Merged ${source} into ${this.currentBranch ?? 'HEAD'}`,
          result.mergeCommit
            ? `${pluralize(result.applied ?? 0, 'commit')} came in, with a merge commit.`
            : `The branch moved straight up. No merge commit was needed.`
        );
      }
      return result;
    } catch (err) {
      toasts.error(`Could not merge ${source}`, describe(err));
      await this.refresh();
      return null;
    } finally {
      this.busy = null;
    }
  }

  inspectMerge(source: string): Promise<MergeInspection> {
    const repo = this.repo;
    if (!repo) return Promise.resolve({ ok: false, problems: ['No repository is open.'] });
    return repo.inspectMerge(source).catch((err) => ({ ok: false, problems: [describe(err)] }));
  }

  inspectPull(): Promise<PullInspection> {
    const repo = this.repo;
    if (!repo) return Promise.resolve({ ok: false, problems: ['No repository is open.'] });
    return repo.inspectPull().catch((err) => ({ ok: false, problems: [describe(err)] }));
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
      if (result.conflicted) {
        toasts.info(`The ${name} stopped on another conflict`, 'Resolve it, then Continue again.');
      } else {
        toasts.success(
          result.finished ? `The ${name} finished` : `The ${name} moved on`,
          result.finished ? null : 'There is more to resolve.'
        );
      }
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
