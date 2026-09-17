<script lang="ts">
  /**
   * The statistics report.
   *
   * Written to be read as a report rather than browsed as a dashboard: the
   * headline numbers first, then activity over time, then who did the work,
   * then where the work landed. Every chart is one series against one axis,
   * because the questions here are about magnitude and trend, not identity.
   *
   * Nothing on this screen changes the repository.
   */
  import { repoStore } from '../state/repo.svelte';
  import { statsStore, RANGE_PRESETS } from '../state/stats.svelte';
  import { absoluteTime, relativeTime, pluralize } from '../format';
  import type { AuthorStats, DayStats } from '../git/types';

  const report = $derived(statsStore.report);
  const totals = $derived(report?.totals ?? null);
  const focused = $derived(statsStore.focusedAuthor);

  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  /** Compact form for a headline number: 1,284 / 12.9K / 1.4M. */
  function compact(n: number): string {
    if (Math.abs(n) < 10_000) return n.toLocaleString();
    if (Math.abs(n) < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }

  const rangeLabel = $derived(
    RANGE_PRESETS.find((r) => r.id === statsStore.range)?.label ?? 'All time'
  );

  /**
   * The activity series, as evenly spaced buckets.
   *
   * A day with no commits has to occupy its own slot, or a quiet fortnight
   * collapses and the chart shows a busier project than the one in the log.
   * Long histories are bucketed by month for the same reason in reverse:
   * thousands of day columns would say nothing at the width available.
   */
  const series = $derived.by(() => {
    if (!report || report.days.length === 0) return { unit: 'day' as const, points: [] };

    // By the span, not by the number of active days: a hundred busy days
    // spread over fifteen years is still fifteen years of columns, and the
    // day branch fills every calendar day between the first and the last.
    const spanDays =
      (fromKey(report.days[report.days.length - 1].date).getTime() -
        fromKey(report.days[0].date).getTime()) / 86_400_000;
    const byMonth = spanDays > 120;
    if (byMonth) {
      return {
        unit: 'month' as const,
        points: report.months.map((m) => ({
          key: m.month,
          label: monthLabel(m.month),
          commits: m.commits,
          added: m.added,
          removed: m.removed,
          authors: m.authors
        }))
      };
    }

    const filled: { key: string; label: string; commits: number; added: number; removed: number; authors: number }[] = [];
    const found = new Map(report.days.map((d) => [d.date, d]));
    const cursor = fromKey(report.days[0].date);
    const end = fromKey(report.days[report.days.length - 1].date);
    while (cursor <= end) {
      const key = toKey(cursor);
      const day: DayStats | undefined = found.get(key);
      filled.push({
        key,
        label: dayLabel(cursor),
        commits: day?.commits ?? 0,
        added: day?.added ?? 0,
        removed: day?.removed ?? 0,
        authors: day?.authors ?? 0
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return { unit: 'day' as const, points: filled };
  });

  function fromKey(key: string): Date {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function toKey(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function dayLabel(d: Date): string {
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function monthLabel(key: string): string {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  }

  const peak = $derived(Math.max(1, ...series.points.map((p) => p.commits)));

  /** The busiest day in the report, worth naming outright. */
  const busiest = $derived.by(() => {
    if (!report || report.days.length === 0) return null;
    return report.days.reduce((best, d) => (d.commits > best.commits ? d : best));
  });

  /**
   * The hour-by-weekday grid, as one flat list of cells.
   *
   * Per-author when a contributor is open, so "when does this person work"
   * is answerable, and repository-wide otherwise.
   */
  const clock = $derived.by(() => {
    const hours = focused?.hours ?? report?.hours ?? [];
    const weekdays = focused?.weekdays ?? report?.weekdays ?? [];
    return { hours, weekdays, peakHour: Math.max(1, ...hours), peakDay: Math.max(1, ...weekdays) };
  });

  /** The hour with the most commits, which is the point the chart makes. */
  const busiestHour = $derived.by(() => {
    const hours = clock.hours;
    let best = 0;
    for (let i = 1; i < hours.length; i++) if (hours[i] > hours[best]) best = i;
    return best;
  });

  /** Commits per active day: the honest form of "how fast is this project". */
  function cadence(commits: number, days: number): string {
    if (days === 0) return '—';
    return (commits / days).toFixed(1);
  }

  /** The share of all commits an author holds, 0–1. */
  function share(author: AuthorStats): number {
    const all = report?.totals.commits ?? 0;
    return all > 0 ? author.commits / all : 0;
  }

  const topAuthorShare = $derived(
    report && report.authors.length > 0 ? share(report.authors[0]) : 0
  );

  /** Authors shown in the table, capped so the report stays readable. */
  const shownAuthors = $derived(report?.authors.slice(0, 25) ?? []);

  /** Turn the report into a CSV a spreadsheet or a manager can take away. */
  function exportCsv() {
    if (!report) return;
    const rows: string[][] = [
      ['Contributor', 'Email', 'Commits', 'Merges', 'Lines added', 'Lines removed',
       'Files touched', 'Active days', 'First commit', 'Last commit', 'Share of commits']
    ];
    for (const a of report.authors) {
      rows.push([
        a.name, a.email, String(a.commits), String(a.merges), String(a.added), String(a.removed),
        String(a.files), String(a.activeDays),
        new Date(a.first).toISOString(), new Date(a.last).toISOString(),
        `${(share(a) * 100).toFixed(1)}%`
      ]);
    }

    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');

    const name = repoStore.info?.name ?? 'repository';
    const stamp = new Date().toISOString().slice(0, 10);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name}-contributors-${stamp}.csv`;
    // In the document, because some browsers ignore a click on a link that is
    // not in it, and revoked a tick later, because revoking the URL in the
    // same turn as the click can cancel the download before it starts.
    document.body.append(link);
    link.click();
    setTimeout(() => {
      link.remove();
      URL.revokeObjectURL(url);
    }, 0);
  }
</script>

<div class="report">
  {#if statsStore.error && !report}
    <div class="empty">
      <p class="empty-title">The statistics could not be read</p>
      <p class="empty-body">{statsStore.error}</p>
      <button class="retry" onclick={() => statsStore.load()}>Try again</button>
    </div>
  {:else if !report}
    <div class="empty">
      <p class="empty-title">{statsStore.loading ? 'Reading the history…' : 'No report yet'}</p>
      <p class="empty-body">
        {statsStore.loading
          ? 'Every number comes from one pass over the log, so this takes a moment on a large repository.'
          : 'Choose a period in the Stats panel to read the history.'}
      </p>
    </div>
  {:else if totals && totals.commits === 0}
    <div class="empty">
      <p class="empty-title">No commits in this period</p>
      <p class="empty-body">
        Nothing was committed {rangeLabel.toLowerCase() === 'all time' ? 'in this repository' : `in the ${rangeLabel.toLowerCase()}`}{statsStore.scopeRef ? ` on ${statsStore.scopeRef}` : ''}.
        Widen the period, or turn off a filter, in the Stats panel.
      </p>
    </div>
  {:else if totals}
    <header class="head" class:dim={statsStore.loading}>
      <div class="head-text">
        <h1>{repoStore.info?.name ?? 'Repository'}</h1>
        <p class="sub">
          {rangeLabel}
          {#if statsStore.scopeRef}· {statsStore.scopeRef}{:else}· all branches{/if}
          {#if totals.firstCommit && totals.lastCommit}
            · {absoluteTime(totals.firstCommit).split(',')[0]} to {absoluteTime(totals.lastCommit).split(',')[0]}
          {/if}
          {#if !statsStore.includeMerges}· merges excluded{/if}
          {#if statsStore.excludeGenerated}· generated files excluded{/if}
        </p>
      </div>
      <button class="export" onclick={exportCsv} title="Save the contributor table as a CSV file">
        Export CSV
      </button>
    </header>

    {#if report.truncated}
      <p class="notice">
        This report covers the {report.limit.toLocaleString()} most recent commits, which is
        as far as it reads. Earlier history is not counted here.
      </p>
    {/if}

    <!-- Headline numbers. Each is a single value, so each is a tile, not a chart. -->
    <section class="tiles" aria-label="Headline numbers">
      <div class="tile">
        <span class="tile-label">Commits</span>
        <span class="tile-value">{compact(totals.commits)}</span>
        <span class="tile-note">{cadence(totals.commits, totals.activeDays)} per active day</span>
      </div>
      <div class="tile">
        <span class="tile-label">Contributors</span>
        <span class="tile-value">{compact(totals.authors)}</span>
        <span class="tile-note">
          {#if report.authors.length > 0}
            top {Math.round(topAuthorShare * 100)}% of commits
          {:else}—{/if}
        </span>
      </div>
      <div class="tile">
        <span class="tile-label">Lines added</span>
        <span class="tile-value add">+{compact(totals.added)}</span>
        <span class="tile-note">{compact(Math.round(totals.added / Math.max(1, totals.commits)))} per commit</span>
      </div>
      <div class="tile">
        <span class="tile-label">Lines removed</span>
        <span class="tile-value del">−{compact(totals.removed)}</span>
        <span class="tile-note">{compact(Math.round(totals.removed / Math.max(1, totals.commits)))} per commit</span>
      </div>
      <div class="tile">
        <span class="tile-label">Files touched</span>
        <span class="tile-value">{compact(totals.filesTouched)}</span>
        <span class="tile-note">{pluralize(totals.activeDays, 'active day')}</span>
      </div>
      <div class="tile">
        <span class="tile-label">Last commit</span>
        <span class="tile-value small">{totals.lastCommit ? relativeTime(totals.lastCommit) : '—'}</span>
        <span class="tile-note">{totals.merges.toLocaleString()} merge{totals.merges === 1 ? '' : 's'} in range</span>
      </div>
    </section>

    <!-- Commits over time: one series, one axis, evenly spaced buckets. -->
    <section class="card">
      <div class="card-head">
        <h2>Commits over time</h2>
        <p class="card-sub">
          One bar per {series.unit}.
          {#if busiest}
            The busiest single day was {dayLabel(fromKey(busiest.date))},
            with {pluralize(busiest.commits, 'commit')}.
          {/if}
        </p>
      </div>

      <div class="chart" role="img"
           aria-label="Commits per {series.unit}. Peak {peak} commits.">
        {#each series.points as point (point.key)}
          <div
            class="col"
            title="{point.label}&#10;{pluralize(point.commits, 'commit')}{point.commits > 0 ? `, +${point.added.toLocaleString()} −${point.removed.toLocaleString()}` : ''}{point.authors > 0 ? `&#10;${pluralize(point.authors, 'contributor')}` : ''}"
          >
            <span class="bar" style="height: {point.commits === 0 ? 0 : Math.max(2, (point.commits / peak) * 100)}%"></span>
          </div>
        {/each}
      </div>

      <div class="axis">
        <span>{series.points[0]?.label ?? ''}</span>
        <span class="axis-peak">peak {peak} per {series.unit}</span>
        <span>{series.points[series.points.length - 1]?.label ?? ''}</span>
      </div>
    </section>

    <div class="split">
      <!-- Contributors: horizontal bars, sorted, so the ranking is the shape. -->
      <section class="card grow">
        <div class="card-head">
          <h2>Contributors</h2>
          <p class="card-sub">
            {totals.authors.toLocaleString()} {totals.authors === 1 ? 'person has' : 'people have'} committed here.
            {#if report.authors.length > shownAuthors.length}
              The top {shownAuthors.length} are listed; the CSV holds them all.
            {/if}
          </p>
        </div>

        <div class="table-wrap">
          <table class="grid">
            <thead>
              <tr>
                <th scope="col" class="who">Contributor</th>
                <th scope="col" class="num">Commits</th>
                <th scope="col" class="share-head">Share</th>
                <th scope="col" class="num">+ Lines</th>
                <th scope="col" class="num">− Lines</th>
                <th scope="col" class="num">Files</th>
                <th scope="col" class="num">Active days</th>
                <th scope="col" class="when">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {#each shownAuthors as author (author.key)}
                <tr
                  class:selected={statsStore.focused === author.key}
                  onclick={() => (statsStore.focused = statsStore.focused === author.key ? null : author.key)}
                  title="{author.email}{author.aliases.length > 0 ? `&#10;Also commits as: ${author.aliases.join(', ')}` : ''}&#10;&#10;Click to see when this contributor works."
                >
                  <td class="who">
                    <span class="person">{author.name}</span>
                    {#if author.aliases.length > 0}
                      <span class="alias">also {author.aliases.join(', ')}</span>
                    {/if}
                  </td>
                  <td class="num strong">{author.commits.toLocaleString()}</td>
                  <td class="share">
                    <span class="share-inner">
                      <span class="share-bar" aria-hidden="true">
                        <span class="share-fill" style="width: {Math.max(2, share(author) * 100)}%"></span>
                      </span>
                      <span class="share-pct">{(share(author) * 100).toFixed(1)}%</span>
                    </span>
                  </td>
                  <td class="num add">+{compact(author.added)}</td>
                  <td class="num del">−{compact(author.removed)}</td>
                  <td class="num dim">{author.files.toLocaleString()}</td>
                  <td class="num dim">{author.activeDays.toLocaleString()}</td>
                  <td class="when dim">{relativeTime(author.last)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <div class="split">
      <!-- When work happens. Sequential shading: more commits, more ink. -->
      <section class="card">
        <div class="card-head">
          <h2>When work happens</h2>
          <p class="card-sub">
            {#if focused}
              {focused.name}, by hour of the day.
              <button class="clear-focus" onclick={() => (statsStore.focused = null)}>Show everyone</button>
            {:else}
              Every contributor, by hour of the day. Click a contributor to narrow it.
            {/if}
          </p>
        </div>

        <div
          class="hours"
          role="img"
          aria-label="Commits by hour of the day. Busiest hour: {String(busiestHour).padStart(2, '0')}:00, with {pluralize(clock.hours[busiestHour] ?? 0, 'commit')}."
        >
          {#each clock.hours as count, hour (hour)}
            <div class="hour" title="{String(hour).padStart(2, '0')}:00 — {pluralize(count, 'commit')}">
              <span class="hour-bar" style="height: {count === 0 ? 0 : Math.max(3, (count / clock.peakHour) * 100)}%"></span>
              {#if hour % 6 === 0}
                <span class="hour-tick">{String(hour).padStart(2, '0')}</span>
              {/if}
            </div>
          {/each}
        </div>

        <p class="peak-note">
          Busiest hour: {String(busiestHour).padStart(2, '0')}:00, with
          {pluralize(clock.hours[busiestHour] ?? 0, 'commit')}.
        </p>

        <div class="weekdays">
          {#each clock.weekdays as count, day (day)}
            <div class="weekday" title="{WEEKDAYS[day]} — {pluralize(count, 'commit')}">
              <span class="weekday-name">{WEEKDAYS[day]}</span>
              <span class="weekday-track">
                <span class="weekday-fill" style="width: {count === 0 ? 0 : Math.max(2, (count / clock.peakDay) * 100)}%"></span>
              </span>
              <span class="weekday-count">{count.toLocaleString()}</span>
            </div>
          {/each}
        </div>
      </section>

      <!-- Where the work lands: the files history keeps returning to. -->
      <section class="card">
        <div class="card-head">
          <h2>Most changed files</h2>
          <p class="card-sub">
            A file near the top of this list is one the project keeps reopening.
          </p>
        </div>

        <div class="table-wrap short">
          <table class="grid">
            <thead>
              <tr>
                <th scope="col">File</th>
                <th scope="col" class="num">Commits</th>
                <th scope="col" class="num">+</th>
                <th scope="col" class="num">−</th>
                <th scope="col" class="num">People</th>
              </tr>
            </thead>
            <tbody>
              {#each report.files.slice(0, 20) as file (file.path)}
                <tr title="{file.path}&#10;Last changed {relativeTime(file.last)}">
                  <td class="path">
                    <span class="file-name">{file.path.split('/').pop()}</span>
                    <span class="file-dir">{file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''}</span>
                  </td>
                  <td class="num strong">{file.commits.toLocaleString()}</td>
                  <td class="num add">+{compact(file.added)}</td>
                  <td class="num del">−{compact(file.removed)}</td>
                  <td class="num dim">{file.authors.toLocaleString()}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    </div>

    {#if report.extensions.length > 0}
      <section class="card">
        <div class="card-head">
          <h2>Where the lines go</h2>
          <p class="card-sub">Lines written and deleted, grouped by file type.</p>
        </div>
        <div class="exts">
          {#each report.extensions as ext (ext.ext)}
            {@const total = ext.added + ext.removed}
            {@const widest = Math.max(1, ...report.extensions.map((e) => e.added + e.removed))}
            <div class="ext" title="{ext.ext === '(none)' ? 'No extension' : `.${ext.ext}`} — {pluralize(ext.files, 'file')}, +{ext.added.toLocaleString()} −{ext.removed.toLocaleString()}">
              <span class="ext-name">{ext.ext === '(none)' ? '(none)' : `.${ext.ext}`}</span>
              <span class="ext-track">
                <span class="ext-fill" style="width: {Math.max(2, (total / widest) * 100)}%"></span>
              </span>
              <span class="ext-count">{compact(total)}</span>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <section class="card">
      <div class="card-head">
        <h2>Latest commits</h2>
        <p class="card-sub">The most recent work in this period.</p>
      </div>
      <div class="table-wrap short">
        <table class="grid">
          <thead>
            <tr>
              <th scope="col">Commit</th>
              <th scope="col">Contributor</th>
              <th scope="col" class="num">Files</th>
              <th scope="col" class="num">+</th>
              <th scope="col" class="num">−</th>
              <th scope="col" class="when">When</th>
            </tr>
          </thead>
          <tbody>
            {#each report.recent as commit (commit.hash)}
              <tr title={commit.subject}>
                <td class="subject">
                  <span class="hash">{commit.shortHash}</span>
                  <span class="text">{commit.subject}</span>
                </td>
                <td class="dim">{commit.author}</td>
                <td class="num dim">{commit.files}</td>
                <td class="num add">+{compact(commit.added)}</td>
                <td class="num del">−{compact(commit.removed)}</td>
                <td class="when dim">{relativeTime(commit.date)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    <p class="footnote">
      Read {absoluteTime(report.generatedAt)} from {pluralize(totals.commits, 'commit')}.
      Dates are commit dates, which is what the period filters on: a rebased commit
      counts from when it was rebased, not when it was written. Line counts ignore
      binary files. A merge commit is counted as a commit but contributes no lines,
      because the changes it brings in are already counted on the commits it merges.
    </p>
  {/if}
</div>

<style>
  .report {
    height: 100%;
    overflow: auto;
    padding: 14px 16px 20px;
    background: var(--bg-app);
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 100%;
    padding: 0 40px;
    text-align: center;
  }

  .empty-title { margin: 0; font-size: 14px; font-weight: 600; }

  .empty-body {
    max-width: 460px;
    margin: 0;
    color: var(--text-dim);
    font-size: 12.5px;
    line-height: 1.5;
  }

  .retry {
    margin-top: 6px;
    padding: 4px 12px;
    background: var(--bg-raised);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    font-size: 12px;
  }
  .retry:hover { border-color: var(--accent); color: var(--accent); }

  .head {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 12px;
    transition: opacity 0.15s ease;
  }
  /* A refetch holds the previous render rather than flashing a skeleton. */
  .head.dim { opacity: 0.6; }

  .head-text { flex: 1; min-width: 0; }

  h1 {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .sub {
    margin: 2px 0 0;
    color: var(--text-dim);
    font-size: 11.5px;
  }

  .export {
    flex: none;
    padding: 4px 10px;
    background: var(--bg-raised);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    font-size: 11.5px;
  }
  .export:hover { border-color: var(--accent); color: var(--accent); }

  .notice {
    margin: 0 0 12px;
    padding: 6px 10px;
    border-left: 2px solid var(--warning);
    border-radius: var(--radius-sm);
    background: var(--warning-subtle);
    color: var(--text);
    font-size: 11.5px;
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 8px;
    margin-bottom: 12px;
  }

  .tile {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 9px 11px;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  .tile-label {
    color: var(--text-faint);
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  /* Proportional figures: these are headline numbers, not a column. */
  .tile-value {
    font-size: 22px;
    font-weight: 600;
    line-height: 1.2;
    letter-spacing: -0.02em;
  }
  .tile-value.small { font-size: 15px; font-weight: 600; }
  .tile-value.add { color: var(--success); }
  .tile-value.del { color: var(--danger); }

  .tile-note { color: var(--text-faint); font-size: 11px; }

  .card {
    flex: 1;
    min-width: 0;
    margin-bottom: 12px;
    padding: 11px 13px 12px;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }
  .card.grow { flex: 1; }

  .card-head { margin-bottom: 9px; }

  h2 {
    margin: 0;
    font-size: 12.5px;
    font-weight: 600;
  }

  .card-sub {
    margin: 2px 0 0;
    color: var(--text-dim);
    font-size: 11.5px;
  }

  .clear-focus {
    margin-left: 4px;
    padding: 0;
    background: none;
    border: 0;
    color: var(--accent);
    font-size: 11.5px;
    text-decoration: underline;
  }

  .split { display: flex; gap: 12px; align-items: flex-start; }
  .split > .card { flex: 1; }

  /* Commits over time. */
  .chart {
    display: flex;
    align-items: flex-end;
    justify-content: flex-start;
    gap: 1px;
    height: 132px;
    padding-top: 4px;
    border-bottom: 1px solid var(--border);
  }

  .col {
    flex: 1;
    /* Capped, so a short history draws bars rather than slabs across the
       card. Wide marks read as blocks of colour, not as a measurement. */
    max-width: 24px;
    min-width: 1px;
    height: 100%;
    display: flex;
    align-items: flex-end;
  }
  .col:hover .bar { background: var(--accent-hover); }

  .bar {
    width: 100%;
    min-height: 0;
    background: var(--accent);
    /* Rounded at the data end, square on the baseline. */
    border-radius: 2px 2px 0 0;
  }

  .axis {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    margin-top: 5px;
    color: var(--text-faint);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
  }
  .axis-peak { color: var(--text-dim); }

  /* Hour-of-day columns. */
  .hours {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 78px;
    border-bottom: 1px solid var(--border);
  }

  .hour {
    position: relative;
    flex: 1;
    height: 100%;
    display: flex;
    align-items: flex-end;
  }
  .hour:hover .hour-bar { background: var(--accent-hover); }

  .hour-bar {
    width: 100%;
    background: var(--accent);
    border-radius: 2px 2px 0 0;
  }

  .hour-tick {
    position: absolute;
    bottom: -14px;
    left: 0;
    color: var(--text-faint);
    font-size: 9.5px;
    font-variant-numeric: tabular-nums;
  }

  .peak-note {
    margin: 19px 0 0;
    color: var(--text-dim);
    font-size: 11px;
  }

  .weekdays {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 9px;
  }

  .weekday {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 11px;
  }

  .weekday-name {
    flex: none;
    width: 26px;
    color: var(--text-dim);
  }

  .weekday-track {
    flex: 1;
    height: 7px;
    border-radius: 3px;
    background: var(--bg-sunken);
  }

  .weekday-fill {
    display: block;
    height: 100%;
    border-radius: 3px;
    background: var(--accent);
  }

  .weekday-count {
    flex: none;
    min-width: 32px;
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  /* Tables. */
  .table-wrap { overflow: auto; }
  .table-wrap.short { max-height: 310px; }

  .grid {
    width: 100%;
    border-collapse: collapse;
    font-size: 11.5px;
  }

  .grid th {
    position: sticky;
    top: 0;
    z-index: 1;
    padding: 0 8px 5px 0;
    background: var(--bg-panel);
    border-bottom: 1px solid var(--border);
    color: var(--text-faint);
    font-size: 10px;
    font-weight: 500;
    text-align: left;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    white-space: nowrap;
  }

  .grid td {
    padding: 4px 8px 4px 0;
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }
  .grid tbody tr:last-child td { border-bottom: 0; }
  .grid tbody tr:hover { background: var(--bg-hover); }
  .grid tbody tr.selected { background: var(--bg-selected); }

  /* Numbers in a column align, so these do get tabular figures. */
  .num {
    width: 1%;
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
    text-align: right;
    white-space: nowrap;
  }
  th.num { text-align: right; }

  .strong { color: var(--text); font-weight: 600; }
  .dim { color: var(--text-dim); }
  .add { color: var(--success); }
  .del { color: var(--danger); }

  .who { min-width: 140px; max-width: 260px; }

  .person {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  }

  .alias {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-faint);
    font-size: 10.5px;
  }

  .share { width: 132px; }

  .share-inner {
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .share-bar {
    flex: 1;
    min-width: 40px;
    height: 6px;
    border-radius: 3px;
    background: var(--bg-sunken);
  }

  .share-fill {
    display: block;
    height: 100%;
    border-radius: 3px;
    background: var(--accent);
  }

  .share-pct {
    flex: none;
    min-width: 40px;
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .share-head { text-align: left; }

  .when { white-space: nowrap; font-size: 11px; }

  .path { min-width: 0; max-width: 260px; }

  .file-name {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  }

  .file-dir {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-faint);
    font-size: 10.5px;
  }

  .subject { min-width: 0; max-width: 340px; }

  .hash {
    margin-right: 6px;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: 10.5px;
  }

  .subject .text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* File types. */
  .exts { display: flex; flex-direction: column; gap: 3px; }

  .ext {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11.5px;
  }

  .ext-name {
    flex: none;
    width: 64px;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 10.5px;
  }

  .ext-track {
    flex: 1;
    height: 8px;
    border-radius: 3px;
    background: var(--bg-sunken);
  }

  .ext-fill {
    display: block;
    height: 100%;
    border-radius: 3px;
    background: var(--accent);
  }

  .ext-count {
    flex: none;
    min-width: 46px;
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .footnote {
    margin: 0;
    color: var(--text-faint);
    font-size: 10.5px;
    line-height: 1.45;
  }
</style>
