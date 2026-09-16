<script lang="ts">
  import GraphRow from './GraphRow.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import { repoStore } from '../state/repo.svelte';
  import { commitMenuItems } from '../actions';
  import type { MenuItem } from '../menu';

  const ROW_H = 24;
  const OVERSCAN = 10;
  const LANE = 14;
  const GRAPH_PAD = 8;

  let viewport = $state<HTMLDivElement | null>(null);
  let scrollTop = $state(0);
  let viewportHeight = $state(600);

  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);

  const rows = $derived(repoStore.visibleRows);
  const totalHeight = $derived(rows.length * ROW_H);

  const graphWidth = $derived(
    Math.max(40, GRAPH_PAD * 2 + Math.max(1, repoStore.layout.laneCount) * LANE)
  );

  const first = $derived(Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN));
  const last = $derived(Math.min(rows.length, Math.ceil((scrollTop + viewportHeight) / ROW_H) + OVERSCAN));
  const slice = $derived(rows.slice(first, last));

  const headHash = $derived(repoStore.head?.oid ?? null);

  function onscroll() {
    if (viewport) scrollTop = viewport.scrollTop;
  }

  function measure() {
    if (viewport) viewportHeight = viewport.clientHeight;
  }

  $effect(() => {
    if (!viewport) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  });

  /** Keep the keyboard cursor on screen as it moves. */
  export function revealCursor() {
    const hash = repoStore.cursor;
    if (!hash || !viewport) return;
    const index = rows.findIndex((r) => r.commit.hash === hash);
    if (index === -1) return;
    const top = index * ROW_H;
    const bottom = top + ROW_H;
    if (top < viewport.scrollTop) viewport.scrollTop = top;
    else if (bottom > viewport.scrollTop + viewport.clientHeight) {
      viewport.scrollTop = bottom - viewport.clientHeight;
    }
  }

  function selectFromEvent(hash: string, event: MouseEvent) {
    if (event.button === 2) {
      // Right-click keeps an existing multi-selection intact.
      if (!repoStore.selectedSet.has(hash)) repoStore.select(hash, 'replace');
      return;
    }
    if (event.shiftKey) repoStore.select(hash, 'range');
    else if (event.metaKey || event.ctrlKey) repoStore.select(hash, 'toggle');
    else repoStore.select(hash, 'replace');
  }

  function openMenu(hash: string, event: MouseEvent) {
    event.preventDefault();
    selectFromEvent(hash, event);
    const commit = repoStore.commitByHash(hash);
    if (!commit) return;
    menu = { x: event.clientX, y: event.clientY, items: commitMenuItems(commit, repoStore.selection) };
  }
</script>

<div class="graph-view">
  <div class="head-row">
    <div class="col-graph" style="width: {graphWidth}px" aria-hidden="true"></div>
    <div class="col-subject">Commit</div>
    <div class="col-author">Author</div>
    <div class="col-date">Date</div>
    <div class="col-hash">Hash</div>
  </div>

  <div
    class="viewport"
    bind:this={viewport}
    onscroll={onscroll}
    role="listbox"
    aria-label="Commit history"
    tabindex="-1"
  >
    {#if rows.length === 0}
      <div class="empty">
        {#if repoStore.commits.length === 0}
          <p>This repository has no commits yet.</p>
        {:else}
          <p>No commit matches “{repoStore.filter}”.</p>
          <button class="link" onclick={() => (repoStore.filter = '')}>Clear the filter</button>
        {/if}
      </div>
    {:else}
      <div class="spacer" style="height: {totalHeight}px">
        {#each slice as row, i (row.commit.hash)}
          <GraphRow
            {row}
            top={(first + i) * ROW_H}
            {graphWidth}
            {headHash}
            selected={repoStore.selectedSet.has(row.commit.hash)}
            cursor={repoStore.cursor === row.commit.hash}
            onselect={(e) => selectFromEvent(row.commit.hash, e)}
            oncontextmenu={(e) => openMenu(row.commit.hash, e)}
          />
        {/each}
      </div>
    {/if}
  </div>

  {#if repoStore.truncated}
    <div class="truncation">
      Showing the most recent {repoStore.commits.length.toLocaleString()} commits.
    </div>
  {/if}
</div>

{#if menu}
  <ContextMenu x={menu.x} y={menu.y} items={menu.items} onclose={() => (menu = null)} />
{/if}

<style>
  .graph-view {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    background: var(--bg-panel);
  }

  .head-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) 150px 74px 62px;
    column-gap: 10px;
    padding: 0 10px 0 0;
    height: 22px;
    align-items: center;
    border-bottom: 1px solid var(--border);
    background: var(--bg-panel);
    color: var(--text-faint);
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.055em;
  }

  .col-graph { padding-left: 8px; }
  .col-author, .col-date, .col-hash { text-align: right; }
  .col-author { text-align: left; }

  .viewport {
    flex: 1;
    min-height: 0;
    overflow: auto;
    outline: none;
  }

  .spacer { position: relative; }

  .empty {
    display: grid;
    place-content: center;
    gap: 6px;
    height: 100%;
    color: var(--text-dim);
    text-align: center;
  }

  .link {
    background: none;
    border: 0;
    color: var(--accent);
    text-decoration: underline;
  }

  .truncation {
    padding: 3px 10px;
    border-top: 1px solid var(--border);
    color: var(--text-faint);
    font-size: 11px;
  }
</style>
