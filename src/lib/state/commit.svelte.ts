/**
 * State behind the commit panel.
 *
 * The tick boxes follow IntelliJ IDEA: ticking one runs no Git command at all.
 * It only records that the file belongs in the next commit. Git's index is
 * left exactly as the user arranged it, and only the commit itself writes.
 *
 * Because a refresh rebuilds the file list from scratch, the answer cannot be
 * stored as "which paths are ticked". It is stored as the two ways a file can
 * differ from its default: a tracked change the user took out, and an
 * unversioned file the user put in. A file appearing later then arrives with
 * the right default rather than the one it happened to have last time.
 */
import { repoStore, describe } from './repo.svelte';
import { toasts } from './toasts.svelte';
import { toChange } from '../changes';
import type { Change } from '../changes';
import type { HeadCommit } from '../git/types';

class CommitStore {
  message = $state('');
  amend = $state(false);
  /** The message being written before "Amend" replaced it with HEAD's. */
  private draft = '';

  /** Tracked changes the user took out of the commit. */
  private excluded = $state<Set<string>>(new Set());
  /** Unversioned files the user put into the commit. */
  private included = $state<Set<string>>(new Set());

  /** Collapsed group and folder keys. */
  collapsed = $state<Set<string>>(new Set());
  groupByDirectory = $state(false);

  head = $state<HeadCommit | null>(null);
  busy = $state<string | null>(null);

  private all = $derived((repoStore.status?.files ?? []).map(toChange));

  changes = $derived(this.all.filter((c) => c.kind !== 'unversioned'));
  unversioned = $derived(this.all.filter((c) => c.kind === 'unversioned'));

  /**
   * Git refuses a partial commit while a merge is unfinished, so during one
   * the whole index goes in and the boxes stop meaning anything.
   */
  forced = $derived(!!repoStore.status?.operation);

  conflicts = $derived(this.all.filter((c) => c.kind === 'conflict'));

  checked = $derived.by(() => {
    if (this.forced) return new Set(this.all.map((c) => c.path));
    const set = new Set<string>();
    for (const change of this.changes) if (!this.excluded.has(change.path)) set.add(change.path);
    for (const change of this.unversioned) if (this.included.has(change.path)) set.add(change.path);
    return set;
  });

  checkedPaths = $derived(this.all.filter((c) => this.checked.has(c.path)).map((c) => c.path));

  /** Amending replaces a commit, so there is one even with nothing ticked. */
  canCommit = $derived(
    !this.busy &&
      !!this.message.trim() &&
      (this.checkedPaths.length > 0 || (this.amend && !!this.head?.exists))
  );

  /** Why the Commit button is off, phrased for a tooltip. */
  blockedReason = $derived.by(() => {
    if (this.busy) return this.busy;
    if (!this.message.trim()) return 'Write a commit message first.';
    if (this.checkedPaths.length === 0 && !(this.amend && this.head?.exists)) {
      return 'Tick at least one file to commit.';
    }
    return null;
  });

  isChecked(path: string) {
    return this.checked.has(path);
  }

  /** Tri-state for a group or folder row. */
  groupState(paths: string[]): 'all' | 'some' | 'none' {
    if (paths.length === 0) return 'none';
    let on = 0;
    for (const path of paths) if (this.checked.has(path)) on++;
    return on === 0 ? 'none' : on === paths.length ? 'all' : 'some';
  }

  setChecked(changes: Change[], on: boolean) {
    if (this.forced) return;
    const excluded = new Set(this.excluded);
    const included = new Set(this.included);
    for (const change of changes) {
      if (change.kind === 'unversioned') {
        if (on) included.add(change.path);
        else included.delete(change.path);
      } else {
        if (on) excluded.delete(change.path);
        else excluded.add(change.path);
      }
    }
    this.excluded = excluded;
    this.included = included;
  }

  toggle(change: Change) {
    this.setChecked([change], !this.checked.has(change.path));
  }

  toggleGroup(changes: Change[]) {
    this.setChecked(changes, this.groupState(changes.map((c) => c.path)) !== 'all');
  }

  toggleCollapsed(key: string) {
    const next = new Set(this.collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.collapsed = next;
  }

  collapseAll(keys: string[]) {
    this.collapsed = new Set(keys);
  }

  expandAll() {
    this.collapsed = new Set();
  }

  /** Forget everything typed and ticked. Called when the repository changes. */
  reset() {
    this.message = '';
    this.draft = '';
    this.amend = false;
    this.excluded = new Set();
    this.included = new Set();
    this.head = null;
    this.headFor = null;
  }

  /** The commit `head` describes, so a moved HEAD is noticed. */
  private headFor: string | null = null;
  private loadingHead = false;

  /**
   * Keep the amend target in step with HEAD.
   *
   * HEAD moves for reasons that have nothing to do with this panel: a branch
   * switch, a squash, a commit made elsewhere. Reading it from the oid the
   * store already holds means the panel never offers to amend a commit that
   * is no longer there.
   */
  async syncHead(oid: string | null) {
    if (oid === this.headFor || this.loadingHead) return;
    const repo = repoStore.repo;
    if (!repo) return;
    this.headFor = oid;
    this.loadingHead = true;
    try {
      this.head = await repo.headCommit();
    } catch {
      this.head = null; // the panel simply offers no amend
    } finally {
      this.loadingHead = false;
    }
  }

  /**
   * Ticking "Amend" swaps in the message of the commit being replaced, and
   * unticking gives back whatever was being written before.
   */
  setAmend(on: boolean) {
    if (on === this.amend) return;
    if (on) {
      this.draft = this.message;
      if (this.head?.message) this.message = this.head.message;
    } else {
      this.message = this.draft;
      this.draft = '';
    }
    this.amend = on;
  }

  private async run<T>(label: string, work: () => Promise<T>): Promise<T | null> {
    this.busy = label;
    try {
      return await work();
    } catch (err) {
      toasts.error(`${label} failed`, describe(err));
      return null;
    } finally {
      this.busy = null;
    }
  }

  /** Commit the ticked files. Returns the new hash, or null if it failed. */
  async commit(): Promise<string | null> {
    const repo = repoStore.repo;
    if (!repo || !this.canCommit) return null;
    const paths = this.checkedPaths;
    const amend = this.amend;

    const result = await this.run('Committing', () => repo.commit(paths, this.message, amend));
    if (!result) {
      await repoStore.refresh();
      return null;
    }

    this.message = '';
    this.draft = '';
    this.amend = false;
    // Committed paths are gone, so their ticks mean nothing. Anything still
    // in the working tree keeps the state the user gave it.
    const done = new Set(paths);
    this.excluded = new Set([...this.excluded].filter((p) => !done.has(p)));
    this.included = new Set([...this.included].filter((p) => !done.has(p)));

    // The panel's own effect reloads the amend target: HEAD has just moved.
    await repoStore.refresh();

    const short = result.commit.slice(0, 7);
    toasts.success(
      amend ? `Amended commit ${short}` : `Committed ${result.files} ${result.files === 1 ? 'file' : 'files'} as ${short}`,
      result.partial ? null : 'The merge meant everything staged went in, not just the ticked files.'
    );
    return result.commit;
  }

  async push(options: { remote?: string; setUpstream?: boolean } = {}) {
    const repo = repoStore.repo;
    if (!repo) return false;
    const result = await this.run('Pushing', () => repo.push(options));
    await repoStore.refresh();
    if (!result) return false;
    toasts.success(`Pushed ${result.branch}`, result.output || null);
    return true;
  }

  async rollback(paths: string[]) {
    const repo = repoStore.repo;
    if (!repo || paths.length === 0) return false;
    const result = await this.run('Rolling back', () => repo.rollback(paths));
    await repoStore.refresh();
    if (!result) return false;
    toasts.success(
      `Rolled back ${paths.length} ${paths.length === 1 ? 'file' : 'files'}`,
      result.unstaged > 0
        ? `${result.unstaged} newly added ${result.unstaged === 1 ? 'file is' : 'files are'} now unversioned. Nothing was deleted.`
        : null
    );
    return true;
  }
}

export const commitStore = new CommitStore();
