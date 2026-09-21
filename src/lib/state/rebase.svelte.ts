/**
 * The interactive rebase editor's state.
 *
 * A dialog of its own rather than one of the shared ones: this is a list the
 * user edits, not a question with an answer, and it has to survive being
 * rearranged before anything is run.
 */
import { repoStore, describe } from './repo.svelte';
import { toasts } from './toasts.svelte';
import type { RebaseCommit, RebaseCommand } from '../git/types';

export interface RebaseRow {
  hash: string;
  shortHash: string;
  author: string;
  date: number;
  /** The message the commit has now, shown when nothing has replaced it. */
  original: string;
  subject: string;
  command: RebaseCommand;
  /** Set only when the row was reworded, or a squash target was retitled. */
  message: string | null;
}

class RebaseStore {
  open = $state(false);
  busy = $state(false);
  /** Oldest first, which is the order Git runs the todo list in. */
  rows = $state<RebaseRow[]>([]);
  base = $state<string | null>(null);
  branch = $state<string | null>(null);
  published = $state<string[]>([]);
  /** The row whose message is being edited, or null. */
  editing = $state<string | null>(null);

  /** The commit the span starts at, kept so the run can name it again. */
  private from: string | null = null;

  /**
   * A plan is worth running only if it changes something. Rebasing a span
   * back into the order it was already in rewrites every hash for nothing.
   */
  changed = $derived(
    this.rows.some((r, i) => r.command !== 'pick' || r.hash !== this.original[i])
  );

  /** The hashes as they arrived, to compare the current order against. */
  private original: string[] = [];

  /** Reasons the plan cannot run, shown under the list rather than on submit. */
  problems = $derived.by(() => {
    const out: string[] = [];
    const kept = this.rows.filter((r) => r.command !== 'drop');
    if (kept.length === 0) {
      out.push('Every commit is dropped, which would leave nothing to apply.');
    } else if (kept[0].command === 'squash' || kept[0].command === 'fixup') {
      out.push('The oldest commit kept cannot be folded upwards: there is nothing above it to fold into.');
    }
    return out;
  });

  async show(from: string) {
    this.busy = true;
    try {
      const span = await repoStore.rebaseSpan(from);
      if (!span.ok) {
        toasts.error('This cannot be rebased', span.problems.join(' '));
        return;
      }
      const commits: RebaseCommit[] = span.commits ?? [];
      if (commits.length === 0) {
        toasts.info('Nothing to rebase', 'No commits were found in that span.');
        return;
      }
      this.from = from;
      this.original = commits.map((c) => c.hash);
      this.rows = commits.map((c) => ({
        hash: c.hash,
        shortHash: c.shortHash,
        author: c.author,
        date: c.date,
        original: c.message,
        subject: c.subject,
        command: 'pick' as RebaseCommand,
        message: null
      }));
      this.base = span.base ?? null;
      this.branch = span.branch ?? null;
      this.published = span.published ?? [];
      this.editing = null;
      this.open = true;
    } catch (err) {
      toasts.error('Could not read the commits', describe(err));
    } finally {
      this.busy = false;
    }
  }

  close() {
    this.open = false;
    this.rows = [];
    this.editing = null;
    this.from = null;
  }

  setCommand(hash: string, command: RebaseCommand) {
    this.rows = this.rows.map((r) => (r.hash === hash ? { ...r, command } : r));
    // A row that is no longer reworded has no business keeping a new message.
    if (command !== 'reword') {
      this.rows = this.rows.map((r) => (r.hash === hash && command !== 'pick' ? { ...r, message: null } : r));
    }
  }

  setMessage(hash: string, message: string) {
    this.rows = this.rows.map((r) => (r.hash === hash ? { ...r, message } : r));
  }

  move(hash: string, delta: -1 | 1) {
    const at = this.rows.findIndex((r) => r.hash === hash);
    const to = at + delta;
    if (at === -1 || to < 0 || to >= this.rows.length) return;
    const next = [...this.rows];
    [next[at], next[to]] = [next[to], next[at]];
    this.rows = next;
  }

  /** Put every row back as it arrived, order included. */
  reset() {
    const byHash = new Map(this.rows.map((r) => [r.hash, r]));
    this.rows = this.original
      .map((hash) => byHash.get(hash))
      .filter((r): r is RebaseRow => !!r)
      .map((r) => ({ ...r, command: 'pick' as RebaseCommand, message: null }));
    this.editing = null;
  }

  async run() {
    if (!this.from || this.problems.length > 0) return;
    const plan = this.rows.map((r) => ({
      hash: r.hash,
      command: r.command,
      message: r.message ?? undefined
    }));
    this.busy = true;
    try {
      const ok = await repoStore.rebase(this.from, plan);
      if (ok) this.close();
    } finally {
      this.busy = false;
    }
  }
}

export const rebaseStore = new RebaseStore();
