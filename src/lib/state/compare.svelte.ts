/**
 * Two branches or commits side by side: the commits only one of them has,
 * and the files that differ between them.
 */
import { repoStore, describe } from './repo.svelte';
import type { CompareResult } from '../git/types';

export interface CompareRequest {
  base: string;
  target: string;
  /** Short names for the header, such as a branch name or a short hash. */
  baseLabel: string;
  targetLabel: string;
  mode: 'split' | 'tips';
}

class CompareStore {
  request = $state<CompareRequest | null>(null);
  result = $state.raw<CompareResult | null>(null);
  loading = $state(false);
  error = $state<string | null>(null);
  private token = 0;

  open = $derived(this.request !== null);

  show(base: string, target: string, labels?: { base?: string; target?: string }) {
    return this.load({
      base,
      target,
      baseLabel: labels?.base ?? base.slice(0, 12),
      targetLabel: labels?.target ?? target.slice(0, 12),
      mode: 'split'
    });
  }

  setMode(mode: 'split' | 'tips') {
    if (this.request && this.request.mode !== mode) return this.load({ ...this.request, mode });
  }

  /** Look at it from the other side. */
  swap() {
    const r = this.request;
    if (r) return this.load({ ...r, base: r.target, target: r.base, baseLabel: r.targetLabel, targetLabel: r.baseLabel });
  }

  private async load(request: CompareRequest) {
    const repo = repoStore.repo;
    if (!repo) return;
    this.request = request;
    this.error = null;
    this.loading = true;
    const mine = ++this.token;
    try {
      const result = await repo.compare(request.base, request.target, request.mode);
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
    this.loading = false;
  }
}

export const compareStore = new CompareStore();
