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
  /** Result text the user typed for a block, which wins over its choice. */
  edits = $state<Record<number, string>>({});
  /** Whether the common ancestor is shown as a read-only reference. */
  showBase = $state(false);

  open = $derived(this.request !== null);

  /** Indexes of the sections that are conflicts waiting on a choice. */
  blocks = $derived.by(() =>
    (this.offer?.sections ?? []).flatMap((section, i) => (section.type === 'conflict' ? [i] : []))
  );

  /** How many conflict blocks have neither a side chosen nor a typed result. */
  unresolved = $derived(this.blocks.filter((i) => !this.choices[i] && this.edits[i] === undefined).length);

  /** True when the choice made keeps the side that deleted the file. */
  deletes = $derived.by(() => {
    const sections = this.offer?.sections ?? [];
    return sections.some((section, i) => {
      const pick = this.choices[i];
      return section.type === 'conflict' && this.edits[i] === undefined
        && (pick === 'ours' || pick === 'theirs') && !!section.deleted?.[pick];
    });
  });

  async show(file: string, source: string) {
    const repo = repoStore.repo;
    if (!repo) return;
    this.request = { file, source };
    // The toast that said the operation stopped on a conflict has done its
    // job, and it sits over the editor's buttons in the bottom corner.
    toasts.dismissErrors();
    this.offer = null;
    this.error = null;
    this.choices = {};
    this.edits = {};
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

  /** Choose a side for one block. Anything typed for it gives way. */
  pick(index: number, side: ConflictChoice) {
    this.choices = { ...this.choices, [index]: side };
    this.forget(index);
  }

  pickAll(side: ConflictChoice) {
    const next = { ...this.choices };
    for (const index of this.blocks) next[index] = side;
    this.choices = next;
    this.edits = {};
  }

  /** Take what the user typed as the result for one block. */
  edit(index: number, text: string) {
    this.edits = { ...this.edits, [index]: text };
  }

  /** Drop the typed result, back to what the chosen side gives. */
  forget(index: number) {
    if (this.edits[index] === undefined) return;
    const next = { ...this.edits };
    delete next[index];
    this.edits = next;
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
      if (this.deletes) await repo.conflictRemove(offer.path);
      else await repo.conflictResolve(offer.path, mergeResult(offer.sections, this.choices, this.edits));
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
    this.edits = {};
    this.showBase = false;
  }
}

export const mergeStore = new MergeStore();