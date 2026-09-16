/**
 * The file currently open in the diff viewer.
 *
 * The viewer is opened from two places, the commit panel and the commit
 * details pane, so what it shows lives here rather than in either of them.
 */
import { repoStore, describe } from './repo.svelte';
import type { FileDiff } from '../git/types';

const MODE_KEY = 'gitalia.diff-mode';

export type DiffMode = 'unified' | 'split';

export interface DiffRequest {
  file: string;
  origPath?: string | null;
  /** The commit to show, or null for the working tree against HEAD. */
  hash?: string | null;
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
    this.diff = null;
    this.error = null;
    this.loading = true;
    this.shown = INITIAL_LINES;
    const mine = ++this.token;

    try {
      const diff = await repo.fileDiff({
        file: request.file,
        origPath: request.origPath ?? null,
        hash: request.hash ?? null
      });
      if (mine === this.token) this.diff = diff;
    } catch (err) {
      if (mine === this.token) this.error = describe(err);
    } finally {
      if (mine === this.token) this.loading = false;
    }
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
}

/**
 * A long diff is drawn in pieces. Putting twenty thousand rows into the page
 * at once costs more time than anyone spends reading them.
 */
export const INITIAL_LINES = 800;
export const MORE_LINES = 2000;

export const diffStore = new DiffStore();
