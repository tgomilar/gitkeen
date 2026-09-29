/**
 * The file open in the merge editor.
 *
 * A conflicted file is not something the commit panel can stage and forget:
 * the user has to choose, per conflict, whose side wins. The editor reads
 * the file apart into sections, collects one choice per block, and only then
 * writes a result back. Writing is the last step, so closing the editor at
 * any point leaves the conflict exactly as it was.
 */
import { repoStore, describe } from './repo.svelte';
import { toasts } from './toasts.svelte';
import { mergeResult } from '../merge';
import type { ConflictChoice, MergeOffer } from '../git/types';

class MergeStore {
  /** The file being resolved, and what the header should say about why. */
  request = $state<{ file: string; source: string } | null>(null);
  offer = $state<MergeOffer | null>(null);
  loading = $state(false);
  error = $state<string | null>(null);
  busy = $state(false);

  /** Which side each conflict block keeps, keyed by section index. */
  choices = $state<Record<number, ConflictChoice>>({});
  /** Whether the common ancestor is shown as a read-only reference. */
  showBase = $state(false);

  open = $derived(this.request !== null);

  /** Indexes of the sections that are conflicts waiting on a choice. */
  blocks = $derived.by(() =>
    (this.offer?.sections ?? []).flatMap((section, i) => (section.type === 'conflict' ? [i] : []))
  );

  /** How many conflict blocks have not been given a side yet. */
  unresolved = $derived(this.blocks.filter((i) => !this.choices[i]).length);

  async show(file: string, source: string) {
    const repo = repoStore.repo;
    if (!repo) return;
    this.request = { file, source };
    this.offer = null;
    this.error = null;
    this.choices = {};
    this.showBase = false;
    this.loading = true;
    try {
      this.offer = await repo.conflictRead(file);
    } catch (err) {
      this.error = describe(err);
    } finally {
      this.loading = false;
    }
  }

  pick(index: number, side: ConflictChoice) {
    this.choices = { ...this.choices, [index]: side };
  }

  pickAll(side: ConflictChoice) {
    const next = { ...this.choices };
    for (const index of this.blocks) next[index] = side;
    this.choices = next;
  }

  /**
   * Write the assembled file back and hand it to Git as resolved.
   *
   * `conflicts.resolve` writes the working tree then runs the marker check
   * before staging, so a block left unchosen (markers still in place) is
   * refused rather than committed.
   */
  async apply() {
    const repo = repoStore.repo;
    const offer = this.offer;
    if (!repo || !offer || this.busy) return false;
    try {
      this.busy = true;
      await repo.conflictResolve(offer.path, mergeResult(offer.sections, this.choices));
    } catch (err) {
      toasts.error('Could not save the merged file', describe(err));
      return false;
    } finally {
      this.busy = false;
    }
    await repoStore.refresh();
    this.close();
    toasts.success(
      'Conflict resolved',
      repoStore.status?.files.some((f) => f.state === 'conflicted')
        ? 'Other files still have conflicts.'
        : 'You can continue the operation from the status bar.'
    );
    return true;
  }

  close() {
    this.request = null;
    this.offer = null;
    this.error = null;
    this.choices = {};
    this.showBase = false;
  }
}

export const mergeStore = new MergeStore();