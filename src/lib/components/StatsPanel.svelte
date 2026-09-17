<script lang="ts">
  /**
   * The Stats tool window: the question the report answers.
   *
   * Controls live here, in the dock, and the report itself fills the main
   * area. That split keeps the report readable at full width, and keeps the
   * filters in the same place as the filters for every other panel.
   */
  import Icon from './Icon.svelte';
  import { repoStore } from '../state/repo.svelte';
  import { statsStore, RANGE_PRESETS } from '../state/stats.svelte';
  import { pluralize } from '../format';

  const report = $derived(statsStore.report);
  const scope = $derived(repoStore.scope);
</script>

<section class="panel">
  <div class="toolbar">
    <button
      class="tool"
      onclick={() => statsStore.load()}
      disabled={statsStore.loading}
      title="Read the statistics again (⌘R)"
      aria-label="Refresh the report"
    >
      <Icon name="refresh" size={14} />
    </button>
    <span class="title">Stats</span>
    {#if statsStore.loading}
      <span class="working"><span class="spinner" aria-hidden="true"></span>Reading…</span>
    {/if}
  </div>

  <div class="scroll">
    <fieldset class="group">
      <legend>Period</legend>
      {#each RANGE_PRESETS as preset (preset.id)}
        <label class="radio">
          <input
            type="radio"
            name="stats-range"
            value={preset.id}
            checked={statsStore.range === preset.id}
            onchange={() => (statsStore.range = preset.id)}
          />
          <span>{preset.label}</span>
        </label>
      {/each}
    </fieldset>

    <fieldset class="group">
      <legend>Include</legend>

      <label class="check" title={scope
        ? `Count only the history reachable from ${scope.ref}`
        : 'Pick a branch in the Branches panel to narrow the report to it'}>
        <input
          type="checkbox"
          checked={statsStore.scopedToBranch}
          disabled={!scope}
          onchange={(e) => (statsStore.scopedToBranch = e.currentTarget.checked)}
        />
        <span>
          Only {scope ? scope.ref : 'the selected branch'}
        </span>
      </label>

      <label class="check" title="Merge commits carry no changes of their own, so counting them inflates a commit count without adding any lines">
        <input
          type="checkbox"
          checked={statsStore.includeMerges}
          onchange={(e) => (statsStore.includeMerges = e.currentTarget.checked)}
        />
        <span>Merge commits</span>
      </label>

      <label class="check" title="Lockfiles, bundles and vendored trees are written by tools. Counting them makes whoever last ran an install look like the biggest contributor.">
        <input
          type="checkbox"
          checked={!statsStore.excludeGenerated}
          onchange={(e) => (statsStore.excludeGenerated = !e.currentTarget.checked)}
        />
        <span>Generated files</span>
      </label>
    </fieldset>

    {#if report && report.authors.length > 0}
      <div class="section-head">
        <span class="section-title">Contributors</span>
        <span class="section-count">{report.authors.length}</span>
      </div>

      {#each report.authors as author (author.key)}
        {@const share = report.totals.commits > 0
          ? author.commits / report.totals.commits
          : 0}
        <button
          class="author"
          class:selected={statsStore.focused === author.key}
          onclick={() => (statsStore.focused = statsStore.focused === author.key ? null : author.key)}
          title="{author.name} <{author.email}>&#10;{pluralize(author.commits, 'commit')}, +{author.added.toLocaleString()} −{author.removed.toLocaleString()}&#10;&#10;Click to open this contributor in the report."
        >
          <span class="name">{author.name}</span>
          <span class="bar" aria-hidden="true">
            <span class="fill" style="width: {Math.max(2, share * 100)}%"></span>
          </span>
          <span class="count">{author.commits.toLocaleString()}</span>
        </button>
      {/each}
    {/if}
  </div>

  <p class="hint">
    {#if report}
      Read from {pluralize(report.totals.commits, 'commit')}.
      {#if report.truncated}Capped at {report.limit.toLocaleString()}.{/if}
    {:else}
      A report counts history. It never changes it.
    {/if}
  </p>
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    background: var(--bg-panel);
    border-right: 1px solid var(--border);
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 6px;
    border-bottom: 1px solid var(--border);
  }

  .tool {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 22px;
    padding: 0;
    background: none;
    border: 0;
    border-radius: var(--radius-sm);
    color: var(--text-dim);
  }
  .tool:hover:not(:disabled) { background: var(--bg-hover); color: var(--text); }
  .tool:disabled { opacity: 0.4; cursor: default; }

  .title { flex: 1; font-size: 12.5px; font-weight: 600; }

  .working {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--text-faint);
    font-size: 10.5px;
  }

  .spinner {
    width: 9px;
    height: 9px;
    border: 1.5px solid var(--border-strong);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding-bottom: 8px;
  }

  .group {
    margin: 6px 8px 2px;
    padding: 0;
    border: 0;
  }

  legend {
    padding: 0;
    color: var(--text-faint);
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.055em;
  }

  .radio, .check {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 21px;
    font-size: 12.5px;
  }
  .radio:hover, .check:hover { color: var(--accent); }
  .check:has(input:disabled) { color: var(--text-faint); }
  .check:has(input:disabled):hover { color: var(--text-faint); }

  .radio input, .check input { margin: 0; accent-color: var(--accent); }

  .radio span, .check span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .section-head {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 24px;
    padding: 0 8px;
    margin-top: 8px;
    border-top: 1px solid var(--border);
    color: var(--text-faint);
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.055em;
  }
  .section-title { flex: 1; }
  .section-count { font-variant-numeric: tabular-nums; }

  .author {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    height: 24px;
    padding: 0 8px;
    background: none;
    border: 0;
    text-align: left;
  }
  .author:hover { background: var(--bg-hover); }
  .author.selected { background: var(--bg-selected); }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  }

  /* Beside the name rather than under it: under it, the fill reads as an
     underline on the text instead of as a measurement of its own. */
  .bar {
    flex: none;
    width: 46px;
    height: 6px;
    border-radius: 3px;
    background: var(--bg-sunken);
  }

  .fill {
    display: block;
    height: 100%;
    border-radius: 3px;
    background: var(--accent);
  }

  .count {
    flex: none;
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .hint {
    margin: 0;
    padding: 6px 8px;
    border-top: 1px solid var(--border);
    color: var(--text-faint);
    font-size: 10.5px;
    line-height: 1.35;
  }
</style>
