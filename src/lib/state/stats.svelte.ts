/**
 * State behind the Stats report.
 *
 * The report is read-only, so unlike the other stores this one never has to
 * worry about what a Git command did. Its whole job is to hold the question
 * being asked (the range, the branch, what is left out) and the answer that
 * came back, and to keep the two from drifting apart: a report always carries
 * the filters it was actually read with, not the ones in the form now.
 */
import { repoStore, describe } from './repo.svelte';
import { toasts } from './toasts.svelte';
import type { AuthorStats, StatsReport } from '../git/types';

/** The ranges offered in the panel, as `git log --since` understands them. */
export const RANGE_PRESETS = [
  { id: 'all', label: 'All time', since: null },
  { id: '7d', label: 'Last 7 days', since: '7 days ago' },
  { id: '30d', label: 'Last 30 days', since: '30 days ago' },
  { id: '90d', label: 'Last 90 days', since: '90 days ago' },
  { id: '12m', label: 'Last 12 months', since: '12 months ago' }
] as const;

export type RangeId = (typeof RANGE_PRESETS)[number]['id'];

/**
 * Paths left out of the line counts by default.
 *
 * Lockfiles, bundles and vendored trees are written by tools, not by people.
 * Counting them makes whoever last ran an install look like the most prolific
 * author in the repository, which is exactly the kind of wrong number a report
 * must not produce. The user can turn this off.
 */
export const GENERATED_PATHS = [
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/Cargo.lock',
  '**/composer.lock',
  '**/go.sum',
  '**/Gemfile.lock',
  '**/poetry.lock',
  '**/node_modules/**',
  '**/vendor/**',
  '**/dist/**',
  '**/build/**',
  '**/*.min.js',
  '**/*.min.css',
  '**/*.map'
];

/** How many commits a report will read before it gives up and says so. */
const COMMIT_LIMIT = 20000;

class StatsStore {
  report = $state<StatsReport | null>(null);
  loading = $state(false);
  error = $state<string | null>(null);

  /* The question. Changing any of these re-reads the report. */
  range = $state<RangeId>('all');
  /** Narrow to the branch the graph is scoped to, rather than every branch. */
  scopedToBranch = $state(false);
  includeMerges = $state(false);
  excludeGenerated = $state(true);

  /** The author row opened for a closer look, or null. */
  focused = $state<string | null>(null);

  /** The repository the current report describes, so a switch clears it. */
  private reportedRoot: string | null = null;
  /** The filters the current report was read with, as a comparable string. */
  private reportedQuery: string | null = null;

  /** What the panel is asking for right now. */
  private query() {
    const preset = RANGE_PRESETS.find((r) => r.id === this.range) ?? RANGE_PRESETS[0];
    const scope = this.scopedToBranch ? repoStore.scope?.ref ?? null : null;
    return {
      since: preset.since,
      until: null,
      refs: scope ? [scope] : null,
      includeMerges: this.includeMerges,
      excludePaths: this.excludeGenerated ? GENERATED_PATHS : [],
      limit: COMMIT_LIMIT
    };
  }

  private signature() {
    return JSON.stringify([repoStore.info?.root ?? null, this.query()]);
  }

  /** The branch a scoped report is narrowed to, for labelling. */
  scopeRef = $derived(this.scopedToBranch ? repoStore.scope?.ref ?? null : null);

  /** The author the report is opened on, if that author is still in it. */
  focusedAuthor = $derived.by((): AuthorStats | null => {
    if (!this.focused || !this.report) return null;
    return this.report.authors.find((a) => a.key === this.focused) ?? null;
  });

  /** Read the report. Safe to call at any time; it only ever reads. */
  async load() {
    const repo = repoStore.repo;
    if (!repo) return;
    const signature = this.signature();
    this.loading = true;
    this.error = null;
    try {
      const report = await repo.stats(this.query());
      // A newer request may have been fired while this one was in flight. This
      // applies to the very first read too: committing a superseded answer
      // would also record the question it answered, and the report would then
      // sit there claiming to answer the one now on screen.
      if (this.signature() !== signature) return;
      this.report = report;
      this.reportedRoot = repoStore.info?.root ?? null;
      this.reportedQuery = signature;
      // An author opened in a previous report may be absent from this one.
      if (this.focused && !report.authors.some((a) => a.key === this.focused)) {
        this.focused = null;
      }
    } catch (err) {
      this.error = describe(err);
      toasts.error('Could not read the statistics', this.error);
    } finally {
      this.loading = false;
    }
  }

  /** Read it only if it has never been read, or the question has changed. */
  async ensure() {
    if (this.loading) return;
    if (this.report && this.reportedQuery === this.signature()) return;
    await this.load();
  }

  /** Drop a report belonging to a repository that is no longer open. */
  syncRepo(root: string | null) {
    if (root === this.reportedRoot) return;
    this.report = null;
    this.reportedRoot = null;
    this.reportedQuery = null;
    this.focused = null;
    this.error = null;
  }

  reset() {
    this.syncRepo(null);
    this.range = 'all';
    this.scopedToBranch = false;
    this.includeMerges = false;
    this.excludeGenerated = true;
  }
}

export const statsStore = new StatsStore();
