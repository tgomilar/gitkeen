<script lang="ts">
  /**
   * The diff of one file, over the whole window.
   *
   * It covers the application rather than taking a share of the layout,
   * because a side-by-side diff needs every pixel of width it can get. This is
   * what IntelliJ IDEA's Show Diff window does, and Escape closes it.
   */
  import { diffStore, INITIAL_LINES } from '../state/diff.svelte';
  import { pairLines, rowSegments, unifiedSegments, limitHunks } from '../diff';
  import type { DiffHunk } from '../git/types';

  const request = $derived(diffStore.request);
  const diff = $derived(diffStore.diff);
  const split = $derived(diffStore.mode === 'split');

  const limited = $derived(
    diff ? limitHunks(diff.hunks, diffStore.shown || INITIAL_LINES) : { hunks: [], hidden: 0 }
  );

  const STATUS_LABEL: Record<string, string> = {
    added: 'Added',
    deleted: 'Deleted',
    modified: 'Modified',
    renamed: 'Renamed'
  };

  /** Rows for a hunk, with the changed words already worked out. */
  function rowsOf(hunk: DiffHunk) {
    return pairLines(hunk).map((row) => ({ row, segments: rowSegments(row) }));
  }

  /** The same marks, laid out for the unified view. */
  function linesOf(hunk: DiffHunk) {
    const marks = unifiedSegments(hunk);
    return hunk.lines.map((line, n) => ({ line, segments: marks[n] }));
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      diffStore.close();
    }
  }

  /** Focus the panel on open, so Escape and scrolling work without a click. */
  function autofocus(node: HTMLElement) {
    node.focus();
  }
</script>

<svelte:window on:keydown={onkeydown} />

{#if request}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="scrim"
    role="dialog"
    aria-modal="true"
    aria-label="Diff of {request.file}"
    tabindex="-1"
    use:autofocus
  >
    <div class="panel">
      <header>
        <div class="titles">
          <div class="path" title={request.file}>
            {#if diff}
              <span class="status {diff.status}">{STATUS_LABEL[diff.status] ?? diff.status}</span>
            {/if}
            <bdi dir="ltr">{request.file}</bdi>
          </div>
          <div class="sub">
            <span>{request.source}</span>
            {#if diff?.origPath}
              <span class="from">renamed from <bdi dir="ltr">{diff.origPath}</bdi></span>
            {/if}
            {#if diff && !diff.binary}
              <span class="stat add">+{diff.added.toLocaleString()}</span>
              <span class="stat del">−{diff.removed.toLocaleString()}</span>
            {/if}
          </div>
        </div>

        <div class="tools">
          <div class="modes" role="group" aria-label="Diff layout">
            <button
              class:on={!split}
              onclick={() => diffStore.setMode('unified')}
              aria-pressed={!split}
            >Unified</button>
            <button
              class:on={split}
              onclick={() => diffStore.setMode('split')}
              aria-pressed={split}
            >Side by side</button>
          </div>
          <button class="close" onclick={() => diffStore.close()} title="Close (Escape)" aria-label="Close">×</button>
        </div>
      </header>

      <div class="body">
        {#if diffStore.loading}
          <p class="notice">Reading the diff…</p>
        {:else if diffStore.error}
          <p class="notice bad">{diffStore.error}</p>
        {:else if !diff}
          <p class="notice">Nothing to show.</p>
        {:else if diff.binary}
          <p class="notice">
            This is a binary file.<br />
            <span class="faint">Gitalia can tell you it changed, but not how. An image and file
            comparison comes later.</span>
          </p>
        {:else if diff.empty}
          <p class="notice">
            {#if diff.status === 'renamed'}
              The file was renamed. Its contents did not change.
            {:else}
              Git records a change here, but the text of the file is the same. A file
              permission change does this.
            {/if}
          </p>
        {:else}
          <div class="diff" class:split>
            {#each limited.hunks as hunk, index (index)}
              <div class="hunk-head">
                <span class="mono">@@ −{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@</span>
                {#if hunk.heading}<span class="heading">{hunk.heading}</span>{/if}
              </div>

              {#if split}
                {#each rowsOf(hunk) as { row, segments }, n (n)}
                  <div class="row">
                    <span class="num">{row.left?.oldNumber ?? ''}</span>
                    <span class="side {row.left ? row.left.kind : 'blank'}">
                      {#if segments.left}
                        {#each segments.left as segment}<span
                          class:word={segment.changed}>{segment.text}</span>{/each}
                      {:else if row.left}{row.left.text}{/if}
                    </span>
                    <span class="num">{row.right?.newNumber ?? ''}</span>
                    <span class="side {row.right ? row.right.kind : 'blank'}">
                      {#if segments.right}
                        {#each segments.right as segment}<span
                          class:word={segment.changed}>{segment.text}</span>{/each}
                      {:else if row.right}{row.right.text}{/if}
                    </span>
                  </div>
                {/each}
              {:else}
                {#each linesOf(hunk) as { line, segments }, n (n)}
                  <div class="row">
                    <span class="num">{line.oldNumber ?? ''}</span>
                    <span class="num">{line.newNumber ?? ''}</span>
                    <span class="side {line.kind}">
                      <span class="marker" aria-hidden="true"
                        >{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}</span
                      >{#if segments}{#each segments as segment}<span
                        class:word={segment.changed}>{segment.text}</span>{/each}{:else}{line.text}{/if}
                      {#if line.noNewline}<span class="no-newline">no newline at end of file</span>{/if}
                    </span>
                  </div>
                {/each}
              {/if}
            {/each}

            {#if limited.hidden > 0}
              <div class="more">
                <span>{limited.hidden.toLocaleString()} more lines are not drawn yet.</span>
                <button onclick={() => diffStore.showMore()}>Show more</button>
              </div>
            {:else if diff.truncated}
              <p class="notice faint">
                This file is too large to diff in full, so the rest is not shown.
              </p>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: flex;
    padding: 24px;
    background: var(--scrim);
  }
  .scrim:focus { outline: none; }

  .panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    background: var(--bg-panel);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-modal);
    overflow: hidden;
  }

  header {
    flex: none;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px 8px 12px;
    border-bottom: 1px solid var(--border);
  }

  .titles { flex: 1; min-width: 0; }

  .path {
    display: flex;
    align-items: center;
    gap: 7px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 12.5px;
  }

  .status {
    flex: none;
    padding: 0 6px;
    border-radius: var(--radius-sm);
    font-family: var(--font-ui);
    font-size: 10.5px;
    line-height: 16px;
    font-weight: 600;
  }
  .status.modified, .status.renamed { background: var(--ref-local-bg); color: var(--ref-local-text); }
  .status.added { background: rgba(99, 177, 117, 0.18); color: var(--success); }
  .status.deleted { background: var(--bg-sunken); color: var(--text-dim); }

  .sub {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-top: 2px;
    color: var(--text-faint);
    font-size: 11.5px;
  }
  .sub .from { font-family: var(--font-mono); font-size: 11px; }

  .stat { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
  .stat.add { color: var(--success); }
  .stat.del { color: var(--danger); }

  .tools { flex: none; display: flex; align-items: center; gap: 8px; }

  .modes {
    display: flex;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .modes button {
    padding: 3px 10px;
    background: var(--bg-panel);
    border: 0;
    color: var(--text-dim);
    font-size: 11.5px;
  }
  .modes button:hover { background: var(--bg-hover); color: var(--text); }
  .modes button.on { background: var(--accent); color: var(--accent-text); }

  .close {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    background: none;
    border: 0;
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    font-size: 17px;
    line-height: 1;
  }
  .close:hover { background: var(--bg-hover); color: var(--text); }

  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    background: var(--bg-sunken);
  }

  .diff {
    min-width: min-content;
    font-family: var(--font-mono);
    font-size: 11.5px;
    line-height: 1.55;
  }

  .hunk-head {
    display: flex;
    gap: 12px;
    padding: 3px 10px;
    background: var(--bg-raised);
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    color: var(--text-faint);
    font-size: 11px;
    position: sticky;
    left: 0;
  }
  .hunk-head:first-child { border-top: 0; }
  .heading { color: var(--text-dim); }

  .row {
    display: grid;
    grid-template-columns: 48px 48px 1fr;
    background: var(--bg-panel);
  }
  .split .row { grid-template-columns: 48px 1fr 48px 1fr; }

  .num {
    position: sticky;
    left: 0;
    padding: 0 8px 0 0;
    background: var(--bg-panel);
    border-right: 1px solid var(--border);
    color: var(--text-faint);
    font-size: 10.5px;
    text-align: right;
    font-variant-numeric: tabular-nums;
    user-select: none;
  }
  /* Only the very first column can stick; the rest scroll with the text. */
  .split .num:nth-child(3), .row .num:nth-child(2) { position: static; }

  .side {
    padding: 0 10px 0 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .marker { display: inline-block; width: 1.2ch; user-select: none; }

  .side.add { background: rgba(99, 177, 117, 0.13); }
  .side.del { background: rgba(224, 106, 92, 0.13); }
  .side.blank { background: var(--bg-sunken); }

  /* The words that actually differ, inside a line that mostly did not. */
  .add .word { background: rgba(99, 177, 117, 0.34); border-radius: 2px; }
  .del .word { background: rgba(224, 106, 92, 0.32); border-radius: 2px; }

  .no-newline {
    margin-left: 10px;
    padding: 0 5px;
    border-radius: var(--radius-sm);
    background: var(--bg-sunken);
    color: var(--text-faint);
    font-family: var(--font-ui);
    font-size: 10px;
  }

  .notice {
    margin: 0;
    padding: 34px 20px;
    color: var(--text-dim);
    font-size: 12.5px;
    line-height: 1.7;
    text-align: center;
  }
  .notice.bad { color: var(--danger); white-space: pre-wrap; }
  .notice .faint, .notice.faint { color: var(--text-faint); font-size: 11.5px; }

  .more {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 14px;
    background: var(--bg-sunken);
    color: var(--text-faint);
    font-family: var(--font-ui);
    font-size: 11.5px;
  }
  .more button {
    padding: 4px 12px;
    background: var(--bg-raised);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    color: var(--text);
    font-size: 11.5px;
  }
  .more button:hover { border-color: var(--accent); color: var(--accent); }
</style>
