/**
 * State behind the commit panel.
 *
 * The tick boxes follow IntelliJ IDEA: ticking a file stages it, the way
 * `git add` and `git reset` do. A partially staged file can only live in the
 * index, so the tick stopped being paper the moment the panel could stage
 * hunks. The box is a Git command; the list it sits in is the record of
 * what those commands left behind.
 *
 * What is ticked is therefore read from the status: a file whose index entry
 * differs from HEAD is ticked, and anything the index does not hold stays out
 * of the commit.
 */
import { repoStore, describe } from './repo.svelte';
import { toasts } from './toasts.svelte';
import { choose, prompt } from './dialogs.svelte';
import { toChange } from '../changes';
import type { Change } from '../changes';
import { checkMessage, describeRules } from '../git/commit-rules';
import type {
  HeadCommit, PushOptions, Stash, StashFile, SuggestProviders, KeyStatus, SuggestedGroup
} from '../git/types';

class CommitStore {
  message = $state('');
  amend = $state(false);
  /** "Amend the previous commit" is off, and the draft is blank. */
  private draft = '';

  /**
   * Files the index holds beyond HEAD. A partial commit of a rename or an
   * untracked file stays a whole-file affair, so the tick is the whole file.
   */
  checked = $derived.by(() => {
    if (this.forced) return new Set(this.all.map((c) => c.path));
    const set = new Set<string>();
    for (const change of this.all) if (change.staged) set.add(change.path);
    return set;
  });

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

  /** Stashes the user has opened, and the files each one holds. */
  stashOpen = $state<Set<string>>(new Set());
  stashFiles = $state<Record<string, StashFile[]>>({});

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

  /**
   * Stage or unstage a set of files, then read the index back.
   *
   * Ticking now runs a real Git command, so the panel goes busy and the file
   * list is rebuilt from the status the commands leave behind.
   */
  async setChecked(changes: Change[], on: boolean) {
    if (this.forced) return;
    const repo = repoStore.repo;
    if (!repo) return;
    const paths = changes.filter((c) => c.staged !== on).map((c) => c.path);
    if (paths.length === 0) return;
    const result = await this.run(on ? 'Staging' : 'Unstaging', () => repo.stage(paths, on));
    if (result) await repoStore.refresh();
    // The advice described the set that was ticked when it was asked for, so
    // changing the ticks makes it wrong rather than merely out of date.
    this.splitGroups = [];
  }

  async toggle(change: Change) {
    await this.setChecked([change], !this.checked.has(change.path));
  }

  async toggleGroup(changes: Change[]) {
    await this.setChecked(changes, this.groupState(changes.map((c) => c.path)) !== 'all');
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

  /** Forget everything typed. Called when the repository changes. */
  reset() {
    this.message = '';
    this.draft = '';
    this.amend = false;
    this.splitGroups = [];
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
    // The commmitted files are gone from the status, so the index holds exactly
    // what is left. Amending keeps it, since an amend is a new commit of the
    // same index.

    // The panel's own effect reloads the amend target: HEAD has just moved.
    await repoStore.refresh();

    const short = result.commit.slice(0, 7);
    toasts.success(
      amend ? `Amended commit ${short}` : `Committed ${result.files} ${result.files === 1 ? 'file' : 'files'} as ${short}`,
      result.partial ? null : 'The merge meant everything staged went in, not just the ticked files.'
    );
    return result.commit;
  }

  /**
   * Push, reporting a rejection rather than only complaining about it.
   *
   * A push can be refused even when the branch looked up to date: someone else
   * pushes between the last fetch and this call. The caller needs to tell that
   * apart from a real failure, so it is returned rather than turned into a
   * toast, and only a genuine failure is announced here.
   */
  async push(options: PushOptions = {}): Promise<'pushed' | 'rejected' | 'failed'> {
    const repo = repoStore.repo;
    if (!repo) return 'failed';

    this.busy = options.force ? 'Force pushing' : 'Pushing';
    try {
      const result = await repo.push(options);
      toasts.success(
        result.forced ? `Force pushed ${result.branch}` : `Pushed ${result.branch}`,
        result.output || null
      );
      return 'pushed';
    } catch (err) {
      // The backend phrases both rejections; either means the remote moved,
      // which is a decision for the user rather than an error to report.
      const message = describe(err);
      if (/remote (has|moved)/i.test(message)) return 'rejected';
      toasts.error('Push failed', message);
      return 'failed';
    } finally {
      this.busy = null;
      await repoStore.refresh();
    }
  }

  /**
   * Show or hide the files inside a stash.
   *
   * The file list costs a Git call each, so it is read the first time the
   * stash is opened and kept until the stash list is read again.
   */
  async toggleStash(stash: Stash) {
    const next = new Set(this.stashOpen);
    if (next.has(stash.sha)) {
      next.delete(stash.sha);
      this.stashOpen = next;
      return;
    }
    next.add(stash.sha);
    this.stashOpen = next;

    if (this.stashFiles[stash.sha]) return;
    const repo = repoStore.repo;
    if (!repo) return;
    try {
      const { files } = await repo.stashFiles(stash.ref);
      this.stashFiles = { ...this.stashFiles, [stash.sha]: files };
    } catch (err) {
      toasts.error('Could not read the stash', describe(err));
    }
  }

  /** Stash the chosen files and take them out of the working tree. */
  async stash(message: string, paths: string[], includeUntracked: boolean) {
    const repo = repoStore.repo;
    if (!repo) return false;
    const result = await this.run('Stashing', () => repo.createStash({ message, paths, includeUntracked }));
    await repoStore.refresh();
    if (!result) return false;

    if (result.empty) {
      toasts.info('Nothing was stashed', 'Git found no change in the files you chose.');
      return false;
    }

    toasts.success(
      `Stashed ${paths.length} ${paths.length === 1 ? 'file' : 'files'}`,
      'Find it under Stashes in this panel, or with "git stash list".'
    );
    return true;
  }

  /** Put a stash back. `drop` also removes it from the stash list. */
  async unstash(stash: Stash, drop: boolean) {
    const repo = repoStore.repo;
    if (!repo) return false;
    const result = await this.run(drop ? 'Unstashing' : 'Applying the stash', () =>
      repo.applyStash(stash.ref, stash.sha, drop)
    );
    await repoStore.refresh();
    if (!result) return false;

    if (result.conflicted) {
      toasts.error(
        `The stash did not fit cleanly`,
        `${result.conflicts} ${result.conflicts === 1 ? 'file has' : 'files have'} conflicts. The stash is still there, so nothing is lost. Resolve the files, then delete it yourself.`
      );
      return false;
    }

    toasts.success(
      drop ? 'Unstashed the change' : 'Applied the stash',
      drop ? null : 'It is still in the stash list.'
    );
    return true;
  }

  async dropStash(stash: Stash) {
    const repo = repoStore.repo;
    if (!repo) return false;
    const result = await this.run('Deleting the stash', () => repo.dropStash(stash.ref, stash.sha));
    await repoStore.refresh();
    if (!result) return false;
    toasts.success('Deleted the stash');
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
