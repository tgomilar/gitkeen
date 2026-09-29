/**
 * The repository's working trees. Each one is a folder with its own branch
 * checked out, so two branches can be worked on side by side without
 * stashing or switching.
 */
import { repoStore, describe } from './repo.svelte';
import { toasts } from './toasts.svelte';
import type { Worktree } from '../git/types';

class WorktreeStore {
  list = $state<Worktree[]>([]);
  busy = $state(false);

  /** Branch names checked out in a worktree other than this one. */
  elsewhere = $derived(new Set(this.list.filter((t) => !t.current && t.branch).map((t) => t.branch as string)));

  async load() {
    const repo = repoStore.repo;
    if (!repo) return;
    try {
      const { worktrees } = await repo.worktrees();
      if (repo === repoStore.repo) this.list = worktrees;
    } catch {
      this.list = [];
    }
  }

  async add(dir: string, branch: string, create: boolean, from: string | null) {
    const repo = repoStore.repo;
    if (!repo || this.busy) return null;
    this.busy = true;
    try {
      const result = await repo.addWorktree(dir, branch, create, from);
      this.list = result.worktrees;
      await repoStore.refresh();
      toasts.success(`Made a worktree for ${branch}`, result.path);
      return result.path;
    } catch (err) {
      toasts.error('Could not make the worktree', describe(err));
      return null;
    } finally {
      this.busy = false;
    }
  }

  async remove(tree: Worktree, force: boolean) {
    const repo = repoStore.repo;
    if (!repo || this.busy) return false;
    this.busy = true;
    try {
      this.list = (await repo.removeWorktree(tree.path, force)).worktrees;
      await repoStore.refresh();
      toasts.success('Removed the worktree', tree.path);
      return true;
    } catch (err) {
      toasts.error('Could not remove the worktree', describe(err));
      return false;
    } finally {
      this.busy = false;
    }
  }

  async prune() {
    const repo = repoStore.repo;
    if (!repo) return;
    try {
      this.list = (await repo.pruneWorktrees()).worktrees;
    } catch (err) {
      toasts.error('Could not prune worktrees', describe(err));
    }
  }

  /** Switch Gitalia over to another worktree's folder. */
  open(tree: Worktree) {
    return repoStore.open(tree.path);
  }
}

export const worktreeStore = new WorktreeStore();
