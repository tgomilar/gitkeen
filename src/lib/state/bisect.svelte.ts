/**
 * A bisect: Git checks out commits between a good one and a bad one, the
 * user says which way each one goes, and the range halves each time until
 * the first bad commit is left.
 */
import { repoStore, describe } from './repo.svelte';
import { toasts } from './toasts.svelte';
import type { BisectState } from '../git/types';

class BisectStore {
  state = $state<BisectState>({ running: false });
  busy = $state(false);

  async load() {
    const repo = repoStore.repo;
    if (!repo) return;
    try {
      this.state = await repo.bisectState();
    } catch {
      this.state = { running: false };
    }
  }

  private async run(label: string, step: () => Promise<BisectState>) {
    if (this.busy) return;
    this.busy = true;
    try {
      this.state = await step();
      await repoStore.refresh();
      const found = this.state.found;
      if (found) {
        repoStore.select(found, 'replace');
        repoStore.loadDetails(found);
        toasts.success(`The first bad commit is ${found.slice(0, 7)}`, 'It is selected in the graph. Stop the bisect to go back to your branch.');
      } else if (this.state.onlySkipped) {
        toasts.info('Only skipped commits are left', 'Git cannot narrow it down further. The bad commit is one of those.');
      }
    } catch (err) {
      toasts.error(`Could not ${label}`, describe(err));
      await repoStore.refresh();
    } finally {
      this.busy = false;
    }
  }

  start(good: string, bad = 'HEAD') {
    const repo = repoStore.repo;
    if (!repo) return;
    return this.run('start the bisect', () => repo.bisectStart(good, bad));
  }

  mark(verdict: 'good' | 'bad' | 'skip') {
    const repo = repoStore.repo;
    if (!repo) return;
    return this.run(`mark the commit ${verdict}`, () => repo.bisectMark(verdict));
  }

  stop() {
    const repo = repoStore.repo;
    if (!repo) return;
    return this.run('stop the bisect', async () => {
      await repo.bisectReset();
      toasts.success('Bisect stopped', 'You are back where you started.');
      return { running: false };
    });
  }
}

export const bisectStore = new BisectStore();
