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
  import type { DiffHunk, DiffLine } from '../git/types';
  import TriCheckbox from './TriCheckbox.svelte';
  import { blameStore } from '../state/blame.svelte';

  const request = $derived(diffStore.request);
  const diff = $derived(diffStore.diff);
  const split = $derived(diffStore.mode === 'split');

  const limited = $derived(
    diff ? limitHunks(diff.hunks, diffStore.shown || INITIAL_LINES) : { hunks: [], hidden: 0 }
  );

  /** A working tree diff means there is an index to move between sides of. */
  const working = $derived(request !== null && request.hash == null);
  /** The two tabs that switch a diff between its staged and unstaged half. */
  const tabs = $derived(!!request?.stageable && working);
  /** Whether the viewer can stage or unstage single hunks right now. */
  const hunkable = $derived(
    tabs && !!diff && !diff.binary && !diff.empty && diff.hunks.length > 0 && !diffStore.loading
  );

  /** Which hunks are coming with the next stage or unstage. */
  let selected = $state<Set<number>>(new Set());
  /**
   * Changed lines left out of a chosen hunk, by the hunk's `oldStart` and
   * the line's index in it. A hunk not listed here comes whole.
   */
  let skipped = $state<Map<number, Set<number>>>(new Map());
  let staging = $state(false);

  // Every new diff starts with its hunks all chosen: the one-tick flow is
  // "uncheck what stays behind, then stage".
  $effect(() => {
    const hunks = diff?.hunks ?? [];
    selected = hunks.length > 0 ? new Set(hunks.map((h) => h.oldStart)) : new Set();
    skipped = new Map();
  });

  // Only hunks that are drawn can be chosen: one the user has not seen must
  // not ride along with "Stage selected". A line left out travels as `skip`,
  // and the server keeps it out of the index change.
  const selectedHunks = $derived(
    limited.hunks
      .filter((h) => selected.has(h.oldStart))
      .map((h) => {
        const out = skipped.get(h.oldStart);
        return out && out.size > 0
          ? { ...h, lines: h.lines.map((l, i) => (out.has(i) ? { ...l, skip: true } : l)) }
          : h;
      })
  );

  /** Whether a hunk comes whole, in part, or not at all. */
  function hunkState(hunk: DiffHunk): 'all' | 'some' | 'none' {
    if (!selected.has(hunk.oldStart)) return 'none';
    return (skipped.get(hunk.oldStart)?.size ?? 0) > 0 ? 'some' : 'all';
  }

  function toggleHunk(oldStart: number) {
    const hunk = limited.hunks.find((h) => h.oldStart === oldStart);
    const next = new Set(selected);
    // A hunk taken in part becomes whole first, like any mixed tick box.
    if (hunk && hunkState(hunk) === 'all') next.delete(oldStart);
    else next.add(oldStart);
    selected = next;
    const lines = new Map(skipped);
    lines.delete(oldStart);
    skipped = lines;
  }

  const changedIndexes = (hunk: DiffHunk) =>
    hunk.lines.flatMap((l, i) => (l.kind === 'context' ? [] : [i]));

  /** True when this changed line comes with the next stage or unstage. */
  function lineIn(hunk: DiffHunk, line: DiffLine) {
    return selected.has(hunk.oldStart) && !skipped.get(hunk.oldStart)?.has(hunk.lines.indexOf(line));
  }

  /** Include or leave out one changed line. */
  function toggleLine(hunk: DiffHunk, line: DiffLine) {
    const i = hunk.lines.indexOf(line);
    if (i === -1 || line.kind === 'context') return;
    const next = new Map(skipped);
    const nextSelected = new Set(selected);
    let out: Set<number>;
    if (!selected.has(hunk.oldStart)) {
      // Picking a line of an unchosen hunk takes that line alone.
      out = new Set(changedIndexes(hunk).filter((n) => n !== i));
      nextSelected.add(hunk.oldStart);
    } else {
      out = new Set(skipped.get(hunk.oldStart) ?? []);
      if (out.has(i)) out.delete(i);
      else out.add(i);
    }
    if (out.size === changedIndexes(hunk).length) {
      // Every line left out: the hunk is not chosen at all.
      nextSelected.delete(hunk.oldStart);
      next.delete(hunk.oldStart);
    } else {
      next.set(hunk.oldStart, out);
    }
    selected = nextSelected;
    skipped = next;
  }

  /** Lines can be picked one at a time where hunks can. */
  const pickable = $derived(hunkable && working);
  const lineTitle = (hunk: DiffHunk, line: DiffLine) =>
    lineIn(hunk, line)
      ? `Leave this line out of ${request?.side === 'staged' ? 'the unstage' : 'the stage'}`
      : `Include this line in ${request?.side === 'staged' ? 'the unstage' : 'the stage'}`;

  async function applySelection() {
    if (staging || selectedHunks.length === 0) return;
    staging = true;
    try {
      await diffStore.stageHunks(selectedHunks, request?.side ?? 'unstaged');
    } finally {
      staging = false;
    }
  }

  async function stageWhole(on: boolean) {
    if (staging) return;
    staging = true;
    try {
      await diffStore.stageWholeFile(on);
    } finally {
      staging = false;
    }
  }

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
    // The blame viewer opens over this one and owns the keyboard while open.
    if (blameStore.open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      diffStore.close();
      return;
    }
    // S presses "Stage selected" (or "Unstage selected" on the Staged tab).
    const mod = event.metaKey || event.ctrlKey || event.altKey || event.shiftKey;
    const target = event.target as HTMLElement | null;
    const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    if (!mod && !typing && event.key.toLowerCase() === 's' && hunkable && working) {
      event.preventDefault();
      applySelection();
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
          {#if tabs}
            <div class="sides" role="group" aria-label="Part of the working tree">
              <button
                class:on={(request.side ?? 'unstaged') === 'unstaged'}
                onclick={() => diffStore.setSide('unstaged')}
                aria-pressed={(request.side ?? 'unstaged') === 'unstaged'}
              >Working tree</button>
              <button
                class:on={request.side === 'staged'}
                onclick={() => diffStore.setSide('staged')}
                aria-pressed={request.side === 'staged'}
              >Staged</button>
            </div>
          {/if}
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
          <button
            class="blame"
            onclick={() => blameStore.show(request.file, request.hash ?? null)}
            title="Who last changed each line of this file"
          >Blame</button>
          <button class="close" onclick={() => diffStore.close()} title="Close (Escape)" aria-label="Close">×</button>
        </div>
      </header>

      {#if working && diff && !diff.binary && !diff.empty}
        <footer class="stagebar">
          {#if hunkable}
            <span class="count">
              {selectedHunks.length === limited.hunks.length && limited.hunks.length > 0
                ? `${limited.hunks.length} ${limited.hunks.length === 1 ? 'hunk' : 'hunks'}`
                : `${selectedHunks.length} of ${limited.hunks.length} ${limited.hunks.length === 1 ? 'hunk' : 'hunks'}`}{selectedHunks.some((h) => h.lines.some((l) => l.skip))
                ? ', some lines left out'
                : ''}
            </span>
            <button disabled={!selectedHunks.length || staging || diffStore.loading} onclick={applySelection} title="S">
              {request.side === 'staged' ? 'Unstage selected' : 'Stage selected'}
            </button>
            {#if limited.hidden > 0}
              <span class="count faint">the rest is not drawn yet</span>
            {/if}
          {/if}
          <button
            class="whole"
            disabled={staging}
            onclick={() => stageWhole(request.side !== 'staged')}
          >
            {request.side === 'staged' ? 'Unstage file' : 'Stage file'}
          </button>
        </footer>
      {/if}

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
                {#if hunkable}
                  <span class="hunk-tick" title={request.side === 'staged' ? 'Unstage this hunk' : 'Stage this hunk'}>
                    <TriCheckbox
                      checkState={hunkState(hunk)}
                      label={request.side === 'staged' ? 'Unstage this hunk' : 'Stage this hunk'}
                      disabled={staging}
                      onchange={() => toggleHunk(hunk.oldStart)}
                    />
                  </span>
                {/if}
                <span class="mono">@@ −{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@</span>
                {#if hunk.heading}<span class="heading">{hunk.heading}</span>{/if}
              </div>

              {#if split}
                {#each rowsOf(hunk) as { row, segments }, n (n)}
                  <div class="row">
                    {#if pickable && row.left && row.left.kind !== 'context'}
                      {@const line = row.left}
                      <button class="num pick" class:out={!lineIn(hunk, line)} title={lineTitle(hunk, line)}
                        onclick={() => toggleLine(hunk, line)}>{line.oldNumber ?? ''}</button>
                    {:else}
                      <span class="num">{row.left?.oldNumber ?? ''}</span>
                    {/if}
                    <span class="side {row.left ? row.left.kind : 'blank'}"
                      class:out={pickable && !!row.left && row.left.kind !== 'context' && !lineIn(hunk, row.left)}>
                      {#if segments.left}
                        {#each segments.left as segment}<span
                          class:word={segment.changed}>{segment.text}</span>{/each}
                      {:else if row.left}{row.left.text}{/if}
                    </span>
                    {#if pickable && row.right && row.right.kind !== 'context'}
                      {@const line = row.right}
                      <button class="num pick" class:out={!lineIn(hunk, line)} title={lineTitle(hunk, line)}
                        onclick={() => toggleLine(hunk, line)}>{line.newNumber ?? ''}</button>
                    {:else}
                      <span class="num">{row.right?.newNumber ?? ''}</span>
                    {/if}
                    <span class="side {row.right ? row.right.kind : 'blank'}"
                      class:out={pickable && !!row.right && row.right.kind !== 'context' && !lineIn(hunk, row.right)}>
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
                    {#if pickable && line.kind !== 'context'}
                      <button class="num pick" class:out={!lineIn(hunk, line)} title={lineTitle(hunk, line)}
                        onclick={() => toggleLine(hunk, line)}>{line.oldNumber ?? ''}</button>
                    {:else}
                      <span class="num">{line.oldNumber ?? ''}</span>
                    {/if}
                    <span class="num">{line.newNumber ?? ''}</span>
                    <span class="side {line.kind}" class:out={pickable && line.kind !== 'context' && !lineIn(hunk, line)}>
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
  .blame {
    padding: 3px 10px;
    background: var(--bg-panel);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    font-size: 11.5px;
  }
  .blame:hover { color: var(--text); }

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

  .sides,
  .modes {
    display: flex;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .sides button,
  .modes button {
    padding: 3px 10px;
    background: var(--bg-panel);
    border: 0;
    color: var(--text-dim);
    font-size: 11.5px;
  }
  .sides button:hover,
  .modes button:hover { background: var(--bg-hover); color: var(--text); }
  .sides button.on,
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

  .stagebar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 7px 10px;
    background: var(--bg-panel);
    border-bottom: 1px solid var(--border);
  }
  .stagebar button {
    padding: 3px 12px;
    background: var(--bg-raised);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    color: var(--text);
    font-size: 11.5px;
  }
  .stagebar button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .stagebar button.whole { margin-left: auto; }
  .stagebar button:disabled { opacity: 0.55; cursor: default; }
  .stagebar .count { color: var(--text-dim); font-family: var(--font-mono); font-size: 11px; }
  .stagebar .count.faint { color: var(--text-faint); }

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
    align-items: center;
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

  .hunk-tick {
    display: grid;
    place-items: center;
    flex: none;
  }
  /* A changed line's number doubles as its pick: click it to leave the line
     out of the stage, or to bring it back. */
  button.num.pick {
    border: 0;
    border-left: 3px solid var(--accent);
    font: inherit;
    color: inherit;
    text-align: right;
    cursor: pointer;
  }
  button.num.pick:hover { background: var(--accent-subtle); }
  button.num.pick.out { border-left-color: transparent; color: var(--text-faint); }
  .side.out { opacity: 0.45; text-decoration: line-through; }

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
