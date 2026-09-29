/**
 * The file open in the blame viewer, and the way back through its history.
 *
 * "Before this" opens the version of the file just before a commit, so a
 * line can be followed back through every commit that touched it. Each step
 * is remembered, and Back returns along the same path.
 */
import { repoStore, describe } from './repo.svelte';
import type { BlameResult } from '../git/types';

export interface BlameRequest {
  file: string;
  /** The commit to read the file at, or null for the working tree. */
  rev: string | null;
}

class BlameStore {
  request = $state<BlameRequest | null>(null);
  result = $state.raw<BlameResult | null>(null);
  loading = $state(false);
  error = $state<string | null>(null);
  /** The requests stepped through with "Before this", oldest first. */
  trail = $state<BlameRequest[]>([]);
  private token = 0;

  open = $derived(this.request !== null);

  /** Open a file fresh, forgetting any earlier trail. */
  show(file: string, rev: string | null = null) {
    this.trail = [];
    return this.load({ file, rev });
  }

  /** Go to the version before a commit, keeping the way back. */
  before(hash: string, file: string) {
    if (this.request) this.trail = [...this.trail, this.request];
    return this.load({ file, rev: hash });
  }

  back() {
    const previous = this.trail.at(-1);
    if (!previous) return;
    this.trail = this.trail.slice(0, -1);
    return this.load(previous);
  }

  private async load(request: BlameRequest) {
    const repo = repoStore.repo;
    if (!repo) return;
    this.request = request;
    this.error = null;
    this.loading = true;
    const mine = ++this.token;
    try {
      const result = await repo.blame(request.file, request.rev);
      if (mine === this.token) this.result = result;
    } catch (err) {
      if (mine === this.token) {
        this.result = null;
        this.error = describe(err);
      }
    } finally {
      if (mine === this.token) this.loading = false;
    }
  }

  close() {
    this.token++;
    this.request = null;
    this.result = null;
    this.error = null;
    this.trail = [];
    this.loading = false;
  }
}

export const blameStore = new BlameStore();
