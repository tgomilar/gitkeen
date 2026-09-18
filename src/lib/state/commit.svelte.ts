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
import { choose, prompt } from './dialogs.svelte';
import { toChange } from '../changes';
import type { Change } from '../changes';
import { checkMessage, describeRules } from '../git/commit-rules';
import type {
  HeadCommit, Stash, StashFile, SuggestProviders, KeyStatus, SuggestedGroup
} from '../git/types';

class CommitStore {
  message = $state('');
  amend = $state(false);
  /** The message being written before "Amend" replaced it with HEAD's. */
  private draft = '';

  /** Tracked changes the user took out of the commit. */
  private excluded = $state<Set<string>>(new Set());
  /** Unversioned files the user put into the commit. */
  private included = $state<Set<string>>(new Set());

  /**
   * Which AI providers the backend has a key for. Null until asked, empty
   * when none are set, which is what hides the Suggest button.
   */
  suggestProviders = $state<SuggestProviders | null>(null);

  /**
   * How the ticked change could be split, when the last suggestion thought it
   * held more than one piece of work. Advice only: nothing is re-ticked and
   * nothing is committed on its own.
   */
  splitGroups = $state<SuggestedGroup[]>([]);

  /** Collapsed group and folder keys. */
  collapsed = $state<Set<string>>(new Set());
  groupByDirectory = $state(false);
  /** The row the user last clicked. It drives the diff viewer. */
  selected = $state<string | null>(null);

  /** Shelved changes the user has opened, and the files each one holds. */
  shelfOpen = $state<Set<string>>(new Set());
  shelfFiles = $state<Record<string, StashFile[]>>({});

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

  /**
   * The rules this repository holds commit messages to, and how the message
   * being typed measures up. Both are read straight from the open repository,
   * so opening a different project changes what the panel asks for.
   */
  rules = $derived(repoStore.info?.commitRules ?? null);

  messageCheck = $derived(checkMessage(this.message, this.rules));

  /** The one-line format reminder shown under the message box. */
  rulesHint = $derived(describeRules(this.rules));

  /** Amending replaces a commit, so there is one even with nothing ticked. */
  canCommit = $derived(
    !this.busy &&
      !!this.message.trim() &&
      this.messageCheck.blocking.length === 0 &&
      (this.checkedPaths.length > 0 || (this.amend && !!this.head?.exists))
  );

  /** Why the Commit button is off, phrased for a tooltip. */
  blockedReason = $derived.by(() => {
    if (this.busy) return this.busy;
    if (!this.message.trim()) return 'Write a commit message first.';
    const blocking = this.messageCheck.blocking;
    if (blocking.length > 0) {
      return blocking.length === 1
        ? blocking[0].message
        : `The message breaks ${blocking.length} rules in ${this.rules?.file}.`;
    }
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
    // The advice described the set that was ticked when it was asked for, so
    // changing the ticks makes it wrong rather than merely out of date.
    this.splitGroups = [];
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

  /** Drop the split advice, once it no longer describes what is ticked. */
  dismissSplit() {
    this.splitGroups = [];
  }

  /** Forget everything typed and ticked. Called when the repository changes. */
  reset() {
    this.message = '';
    this.draft = '';
    this.amend = false;
    this.splitGroups = [];
    this.excluded = new Set();
    this.included = new Set();
    this.selected = null;
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

  /**
   * Ask the backend whether a suggestion can be offered at all.
   *
   * Asked once when a repository opens. A missing key is not an error: it
   * simply means the button is never shown.
   */
  async loadSuggestProviders() {
    const repo = repoStore.repo;
    if (!repo) return;
    try {
      this.suggestProviders = await repo.suggestProviders();
    } catch {
      this.suggestProviders = { available: [], preferred: null, models: {} };
    }
  }

  /**
   * Connect a provider by pasting a key.
   *
   * There is no browser sign-in to offer: neither Anthropic nor OpenAI issues
   * inference keys through an authorisation flow, so a key from their console
   * is the only thing that works. It is sent straight to the backend and saved
   * outside every repository; it is never held in the browser and never read
   * back, so changing it means pasting a new one.
   */
  async connectProvider(): Promise<boolean> {
    const repo = repoStore.repo;
    if (!repo) return false;

    let status: KeyStatus;
    try {
      status = await repo.keyStatus();
    } catch (err) {
      toasts.error('Could not read the settings', describe(err));
      return false;
    }

    const labels: Record<string, string> = { anthropic: 'Anthropic', openai: 'OpenAI' };
    const chosen = await choose({
      title: 'Connect an AI provider',
      message: `Paste a key from the provider's console. It is saved in ${status.file}, outside every repository.`,
      choices: Object.entries(labels).map(([value, label]) => {
        const state = status.providers[value];
        return {
          value,
          label,
          detail: state?.source === 'environment'
            ? `Currently using ${state.variable} from the environment`
            : state?.saved
              ? 'A key is saved. Pasting a new one replaces it.'
              : `Not connected. Or set ${state?.variable ?? ''} instead.`
        };
      }),
      confirmLabel: 'Continue'
    });
    if (!chosen) return false;

    const key = await prompt({
      title: `${labels[chosen]} key`,
      message: status.providers[chosen]?.saved
        ? 'Paste a new key to replace the saved one, or leave it empty to disconnect.'
        : 'Paste the key. Leave it empty to cancel.',
      input: {
        label: 'API key',
        value: '',
        placeholder: chosen === 'anthropic' ? 'sk-ant-…' : 'sk-…',
        // An empty value means "disconnect", so it cannot be rejected here.
        validate: () => null
      },
      confirmLabel: 'Save'
    });
    if (key === null) return false;

    const saved = await this.run('Saving the key', () => repo.setKey(chosen, key));
    if (!saved) return false;

    await this.loadSuggestProviders();
    toasts.success(
      key.trim() ? `Connected ${labels[chosen]}` : `Disconnected ${labels[chosen]}`,
      key.trim() ? 'The Suggest button is ready to use.' : null
    );
    return true;
  }

  canSuggest = $derived(
    !this.busy &&
      (this.suggestProviders?.available.length ?? 0) > 0 &&
      (this.checkedPaths.length > 0 || (this.amend && !!this.head?.exists))
  );

  /**
   * Fill the message box with a suggested subject.
   *
   * What is written is only a suggestion: it lands in the box as if typed, so
   * it is checked by the same rules and edited before committing like anything
   * else. A suggestion that still breaks a rule is written anyway, because the
   * panel already shows what is wrong with it and a half-right line is easier
   * to fix than an empty box.
   */
  async suggest(provider: string | null = null): Promise<boolean> {
    const repo = repoStore.repo;
    if (!repo || !this.canSuggest) return false;

    const result = await this.run('Suggesting', () =>
      repo.suggest(this.checkedPaths, { provider, amend: this.amend })
    );
    if (!result) return false;

    this.message = result.subject;
    if (this.amend) this.draft = result.subject;
    this.splitGroups = result.groups ?? [];

    if (result.clipped) {
      toasts.info('Suggested from part of the diff', 'The change was too large to send in full.');
    }
    if (!result.ok) {
      toasts.info(
        'The suggestion breaks the commit rules',
        'It is in the box so you can correct it.'
      );
    }
    return true;
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

  /**
   * Show or hide the files inside a shelved change.
   *
   * The file list costs a Git call each, so it is read the first time the
   * change is opened and kept until the shelf is read again.
   */
  async toggleShelf(stash: Stash) {
    const next = new Set(this.shelfOpen);
    if (next.has(stash.sha)) {
      next.delete(stash.sha);
      this.shelfOpen = next;
      return;
    }
    next.add(stash.sha);
    this.shelfOpen = next;

    if (this.shelfFiles[stash.sha]) return;
    const repo = repoStore.repo;
    if (!repo) return;
    try {
      const { files } = await repo.stashFiles(stash.ref);
      this.shelfFiles = { ...this.shelfFiles, [stash.sha]: files };
    } catch (err) {
      toasts.error('Could not read the shelved change', describe(err));
    }
  }

  /** Put the chosen files on the shelf and take them out of the working tree. */
  async shelve(message: string, paths: string[], includeUntracked: boolean) {
    const repo = repoStore.repo;
    if (!repo) return false;
    const result = await this.run('Shelving', () => repo.shelve({ message, paths, includeUntracked }));
    await repoStore.refresh();
    if (!result) return false;

    if (result.empty) {
      toasts.info('Nothing was shelved', 'Git found no change in the files you chose.');
      return false;
    }

    // Shelved files are gone from the working tree, so the ticks that named
    // them mean nothing now.
    const done = new Set(paths);
    this.excluded = new Set([...this.excluded].filter((p) => !done.has(p)));
    this.included = new Set([...this.included].filter((p) => !done.has(p)));

    toasts.success(
      `Shelved ${paths.length} ${paths.length === 1 ? 'file' : 'files'}`,
      'Find it under Shelf in this panel, or with "git stash list".'
    );
    return true;
  }

  /** Put a shelved change back. `drop` also takes it off the shelf. */
  async unshelve(stash: Stash, drop: boolean) {
    const repo = repoStore.repo;
    if (!repo) return false;
    const result = await this.run(drop ? 'Unshelving' : 'Applying the shelved change', () =>
      repo.applyStash(stash.ref, stash.sha, drop)
    );
    await repoStore.refresh();
    if (!result) return false;

    if (result.conflicted) {
      toasts.error(
        `The shelved change did not fit cleanly`,
        `${result.conflicts} ${result.conflicts === 1 ? 'file has' : 'files have'} conflicts. The change is still on the shelf, so nothing is lost. Resolve the files, then drop it yourself.`
      );
      return false;
    }

    toasts.success(
      drop ? 'Unshelved the change' : 'Applied the shelved change',
      drop ? null : 'It is still on the shelf.'
    );
    return true;
  }

  async dropShelved(stash: Stash) {
    const repo = repoStore.repo;
    if (!repo) return false;
    const result = await this.run('Deleting the shelved change', () => repo.dropStash(stash.ref, stash.sha));
    await repoStore.refresh();
    if (!result) return false;
    toasts.success('Deleted the shelved change');
    return true;
  }

  /** Mark conflicted files as dealt with, so the operation can continue. */
  async markResolved(paths: string[]) {
    const repo = repoStore.repo;
    if (!repo || paths.length === 0) return false;
    const result = await this.run('Marking as resolved', () => repo.markResolved(paths));
    await repoStore.refresh();
    if (!result) return false;
    toasts.success(
      `Marked ${result.resolved} ${result.resolved === 1 ? 'file' : 'files'} as resolved`,
      repoStore.status?.files.some((f) => f.state === 'conflicted')
        ? 'Other files still have conflicts.'
        : 'You can continue the operation from the status bar.'
    );
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
