/**
 * The operation log: what rewrote or deleted history, and the way back.
 *
 * Every entry has a recovery point on the server, saved before the operation
 * ran. Restoring one puts the branch, tag or stash back where it was, and the
 * restore is logged in turn, so it can be undone the same way.
 */
import { repoStore, describe } from './repo.svelte';
import { toasts } from './toasts.svelte';
import { confirm } from './dialogs.svelte';
import type { RecoveryEntry } from '../git/types';

class RecoveryStore {
  entries = $state<RecoveryEntry[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);
  busy = $state<string | null>(null);

  async load() {
    const repo = repoStore.repo;
    if (!repo) return;
    this.loading = true;
    this.error = null;
    try {
      const { entries } = await repo.recoveryList();
      if (repo === repoStore.repo) this.entries = entries;
    } catch (err) {
      this.error = describe(err);
    } finally {
      this.loading = false;
    }
  }

  /** Ask, then put back what one entry changed. */
  async restore(entry: RecoveryEntry) {
    const repo = repoStore.repo;
    if (!repo || this.busy) return;
    const short = entry.before.slice(0, 7);
    const { kind, name } = entry.target;
    const onBranch = kind === 'branch' && name === repoStore.currentBranch;
    const ok = await confirm({
      title: `Restore: ${entry.label}`,
      message:
        kind === 'remote'
          ? `A force push cannot be taken back without pushing again, so the old remote commit becomes a new local branch. Push it yourself if you want the remote back.`
          : kind === 'file'
            ? `This writes back what ${name} held before the rollback. What it holds now is saved first, so the restore can be undone from here too.`
            : `This puts ${kind === 'stash' ? 'the stash back on the stash list' : `${name} back at ${short}`}. The restore is logged too, so it can be undone from here.`,
      facts: [
        { label: kind === 'remote' ? 'Remote branch' : kind[0].toUpperCase() + kind.slice(1), value: name },
        ...(kind === 'file' ? [] : [{ label: 'Goes back to', value: short }]),
        ...(onBranch
          ? [{ label: 'Your changes', value: 'Kept. Git refuses the restore rather than overwrite a file you changed.' }]
          : [])
      ],
      tone: 'warning',
      confirmLabel: 'Restore'
    });
    if (!ok) return;

    this.busy = entry.id;
    try {
      const result = await repo.recoveryRestore(entry.id);
      await repoStore.refresh();
      toasts.success(
        result.recreated ? `${result.name} is back` : `${result.name} is back at ${result.at.slice(0, 7)}`,
        kind === 'remote' ? 'It is a local branch. Push it to put the remote back.' : null
      );
    } catch (err) {
      toasts.error('Could not restore', describe(err));
    } finally {
      this.busy = null;
      await this.load();
    }
  }
}

export const recoveryStore = new RecoveryStore();
