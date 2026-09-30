/**
 * Git LFS for the open repository: which files it stores outside Git, and
 * whether their content has been downloaded.
 */
import { repoStore, describe } from './repo.svelte';
import { toasts } from './toasts.svelte';
import type { LfsStatus } from '../git/types';

class LfsStore {
  status = $state<LfsStatus | null>(null);
  open = $state(false);
  busy = $state<string | null>(null);

  /** True when the repository uses LFS at all, so the status bar mentions it. */
  used = $derived(!!this.status && (this.status.patterns.length > 0 || this.status.files.length > 0));
  /** LFS files whose content is not here, only their pointer. */
  missing = $derived(this.status?.files.filter((f) => !f.downloaded).length ?? 0);

  async load() {
    const repo = repoStore.repo;
    if (!repo) return;
    try {
      const status = await repo.lfs('status');
      if (repo === repoStore.repo) this.status = status;
    } catch {
      this.status = null;
    }
  }

  show() {
    this.open = true;
    this.load();
  }

  hide() {
    this.open = false;
  }

  private async run(label: string, done: string, step: () => Promise<LfsStatus>) {
    if (this.busy) return;
    this.busy = label;
    try {
      this.status = await step();
      await repoStore.refresh();
      toasts.success(done);
    } catch (err) {
      toasts.error(`Could not ${label.toLowerCase()}`, describe(err));
    } finally {
      this.busy = null;
    }
  }

  install() {
    const repo = repoStore.repo;
    if (repo) return this.run('Set up Git LFS', 'Git LFS is set up for this repository', () => repo.lfs('install'));
  }

  pull() {
    const repo = repoStore.repo;
    if (repo) return this.run('Download the LFS files', 'Downloaded the LFS files', () => repo.lfs('pull'));
  }

  track(pattern: string, on: boolean) {
    const repo = repoStore.repo;
    if (!repo) return;
    return this.run(
      on ? `Track ${pattern}` : `Stop tracking ${pattern}`,
      on ? `${pattern} files now go to Git LFS. Commit .gitattributes to keep it.` : `${pattern} is no longer tracked. Commit .gitattributes to keep it.`,
      () => repo.lfsTrack(pattern, on)
    );
  }
}

export const lfsStore = new LfsStore();
