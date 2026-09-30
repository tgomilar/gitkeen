/**
 * The submodules this repository records: other repositories kept inside
 * it, each pinned to a commit.
 */
import { repoStore, describe } from './repo.svelte';
import { toasts } from './toasts.svelte';
import type { Submodule } from '../git/types';

class SubmoduleStore {
  list = $state<Submodule[]>([]);
  busy = $state(false);

  async load() {
    const repo = repoStore.repo;
    if (!repo) return;
    try {
      const { submodules } = await repo.submodules();
      if (repo === repoStore.repo) this.list = submodules;
    } catch {
      this.list = [];
    }
  }

  /** Check out the recorded commit, cloning the submodule first if needed. */
  async update(paths: string[] | null) {
    const repo = repoStore.repo;
    if (!repo || this.busy) return;
    this.busy = true;
    try {
      this.list = (await repo.updateSubmodules(paths)).submodules;
      await repoStore.refresh();
      toasts.success(paths?.length === 1 ? `Updated ${paths[0]}` : 'Updated the submodules', 'Each is at the commit this repository records.');
    } catch (err) {
      toasts.error('Could not update the submodules', describe(err));
    } finally {
      this.busy = false;
    }
  }

  /** Open a submodule as a repository of its own. */
  open(sub: Submodule) {
    const root = repoStore.info?.root;
    if (root) return repoStore.open(`${root}/${sub.path}`);
  }
}

export const submoduleStore = new SubmoduleStore();
