/**
 * The file currently open in the diff viewer.
 *
 * The viewer is opened from two places, the commit panel and the commit
 * details pane, so what it shows lives here rather than in either of them.
 */
import { repoStore, describe } from './repo.svelte';
import { confirm } from './dialogs.svelte';
import { toasts } from './toasts.svelte';
import type { FileDiff } from '../git/types';
import type { GitRepository } from '../git/repository';

const MODE_KEY = 'gitkeen.diff-mode';

export type DiffMode = 'unified' | 'split';

export interface DiffRequest {
  file: string;
  origPath?: string | null;
  /** The commit to show, or null for the working tree against HEAD. */
  hash?: string | null;
  /** Names the other side outright, when it is not the commit's parent. */
  base?: string | null;
  /**
   * Which half of the working tree is on show: the index against HEAD
   * (`staged`) or the worktree against the index (`unstaged`). Both are null
   * for a commit diff.
   */
  side?: 'staged' | 'unstaged' | null;
  /**
   * True when the file can be staged or unstaged a hunk at a time. Set by the
   * caller, which knows whether the change is one that a hunk diff can cover.
   */
  stageable?: boolean;
  /** What the header says this diff belongs to, such as a short hash. */
  source: string;
}

class DiffStore {
  request = $state<DiffRequest | null>(null);
  diff = $state<FileDiff | null>(null);
  loading = $state(false);
  error = $state<string | null>(null);

  mode = $state<DiffMode>((localStorage.getItem(MODE_KEY) as DiffMode | null) ?? 'unified');

  /** How many lines the viewer has been asked to draw so far. */
  shown = $state(0);

  open = $derived(this.request !== null);

  setMode(mode: DiffMode) {
    this.mode = mode;
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      /* storage disabled: the choice simply does not outlive the session */
    }
  }

  /** A token identifying the request in flight, so a stale answer is dropped. */
  private token = 0;

  async show(request: DiffRequest) {
    const repo = repoStore.repo;
    if (!repo) return;

    this.request = request;
    this.resetRequest();
    const mine = ++this.token;
    const diff = await this.fetch(repo, request, mine);
    if (mine === this.token) {
      this.diff = diff;
      this.loading = false;
    }
  }

  /**
   * Point the working tree view at the other half of a partially staged
   * file, without closing and reopening anything.
   */
  async setSide(side: 'staged' | 'unstaged') {
    if (!this.request || this.request.hash != null) return;
    const request = { ...this.request!, side };
    this.request = request;
    this.resetRequest();

    const repo = repoStore.repo;
    if (!repo) return;
    const mine = ++this.token;
    const diff = await this.fetch(repo, request, mine);
    if (mine === this.token) {
      this.diff = diff;
      this.loading = false;
    }
  }

  /** Stage or unstage the ticked hunks, then read the result back. */
  /**
   * Throw away the chosen hunks or lines from the working tree, after asking.
   * The file's content is saved first, so the Undo panel can bring it back.
   */
  async rollbackHunks(hunks: FileDiff['hunks']) {
    const repo = repoStore.repo;
    const request = this.request;
    if (!repo || !request || request.hash != null || hunks.length === 0) return false;
    const lines = hunks.reduce((n, h) => n + h.lines.filter((l) => l.kind !== 'context' && !l.skip).length, 0);
    const ok = await confirm({
      title: `Roll back ${lines === 1 ? 'this line' : `these ${lines} lines`}?`,
      message: `The change goes out of ${request.file} in the working tree. What is staged is not touched.`,
      tone: 'warning',
      facts: [{ label: 'To undo it', value: 'Restore it from the Undo panel.' }],
      confirmLabel: 'Roll back'
    });
    if (!ok) return false;
    try {
      this.loading = true;
      await repo.rollbackHunks(request.file, hunks);
    } catch (err) {
      toasts.error('Could not roll back the selection', describe(err));
      return false;
    } finally {
      this.loading = false;
    }
    await repoStore.refresh();
    toasts.success(`Rolled back ${lines === 1 ? 'a line' : `${lines} lines`} of ${request.file}`, 'The Undo panel can bring it back.');
    await this.setSide('unstaged');
    if (this.diff && this.diff.hunks.length === 0 && !this.diff.binary) this.close();
    return true;
  }

  async stageHunks(hunks: FileDiff['hunks'], side: 'staged' | 'unstaged') {
    const repo = repoStore.repo;
    const request = this.request;
    if (!repo || !request || request.hash != null) return false;
    try {
      this.loading = true;
      await repo.stageHunks(request.file, side, hunks);
    } catch (err) {
      toasts.error(`Could not ${side === 'staged' ? 'unstage' : 'stage'} the selection`, describe(err));
      return false;
    } finally {
      this.loading = false;
    }

    // The index moved, so the panel and the working tree both changed.
    await repoStore.refresh();

    // Reload the side that was edited. If that side has nothing left to show,
    // the whole change moved to the other half, so land there instead.
    const flip = side === 'staged' ? 'unstaged' : 'staged';
    await this.setSide(side);
    if (this.diff && this.diff.hunks.length === 0) {
      await this.setSide(flip);
    }
    return true;
  }

  /** Stage or unstage the whole file on one click, from the viewer. */
  async stageWholeFile(on: boolean) {
    const repo = repoStore.repo;
    const request = this.request;
    if (!repo || !request || request.hash != null) return false;
    try {
      this.loading = true;
      await repo.stage([request.file], on);
    } catch (err) {
      toasts.error(on ? 'Could not stage the file' : 'Could not unstage the file', describe(err));
      return false;
    } finally {
      this.loading = false;
    }
    await repoStore.refresh();
    await this.setSide(on ? 'staged' : 'unstaged');
    return true;
  }

  showMore() {
    this.shown += MORE_LINES;
  }

  close() {
    this.token++; // any answer still in flight is no longer wanted
    this.request = null;
    this.diff = null;
    this.error = null;
    this.loading = false;
  }

  private resetRequest() {
    this.diff = null;
    this.error = null;
    this.loading = true;
    this.shown = INITIAL_LINES;
  }

  private async fetch(repo: GitRepository, request: DiffRequest, mine: number) {
    try {
      const diff = await repo.fileDiff({
        file: request.file,
        origPath: request.origPath ?? null,
        hash: request.hash ?? null,
        base: request.base ?? null,
        side: request.side ?? null
      });
      return mine === this.token ? diff : null;
    } catch (err) {
      if (mine === this.token) this.error = describe(err);
      return null;
    }
  }
}

/**
 * A long diff is drawn in pieces. Putting twenty thousand rows into the page
 * at once costs more time than anyone spends reading them.
 */
export const INITIAL_LINES = 800;
export const MORE_LINES = 2000;

export const diffStore = new DiffStore();