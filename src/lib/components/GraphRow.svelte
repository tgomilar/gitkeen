<script lang="ts">
  import type { GraphRow } from '../graph/layout';
  import { laneColor } from '../graph/layout';
  import { columnDate, absoluteTime, initials, authorColor } from '../format';

  interface Props {
    row: GraphRow;
    top: number;
    graphWidth: number;
    selected: boolean;
    cursor: boolean;
    headHash: string | null;
    onselect: (event: MouseEvent) => void;
    oncontextmenu: (event: MouseEvent) => void;
  }

  let { row, top, graphWidth, selected, cursor, headHash, onselect, oncontextmenu }: Props = $props();

  const H = 24;
  const LANE = 14;
  const PAD = 8;

  function laneX(lane: number) {
    return PAD + lane * LANE + LANE / 2;
  }

  /** Smooth S-curve between two lanes; a straight line when they match. */
  function link(fromLane: number, fromY: number, toLane: number, toY: number) {
    const x1 = laneX(fromLane);
    const x2 = laneX(toLane);
    if (x1 === x2) return `M ${x1} ${fromY} L ${x2} ${toY}`;
    const mid = (fromY + toY) / 2;
    return `M ${x1} ${fromY} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${toY}`;
  }

  const isMerge = $derived(row.commit.parents.length > 1);
  const isHead = $derived(row.commit.hash === headHash);
  const nodeX = $derived(laneX(row.lane));
</script>

<div
  class="row"
  class:selected
  class:cursor
  style="top: {top}px"
  role="option"
  aria-selected={selected}
  tabindex="-1"
  onmousedown={onselect}
  oncontextmenu={oncontextmenu}
>
  <svg class="graph" width={graphWidth} height={H} aria-hidden="true">
    {#each row.passes as line}
      <path d={link(line.lane, 0, line.lane, H)} stroke={laneColor(line.colorLane)} />
    {/each}
    {#each row.incoming as line}
      <path d={link(line.lane, 0, row.lane, H / 2)} stroke={laneColor(line.colorLane)} />
    {/each}
    {#each row.outgoing as line}
      <path d={link(row.lane, H / 2, line.lane, H)} stroke={laneColor(line.colorLane)} />
    {/each}

    {#if isHead}
      <circle class="head-ring" cx={nodeX} cy={H / 2} r="6.5" stroke={laneColor(row.lane)} />
    {/if}
    <circle
      class="node"
      class:merge={isMerge}
      cx={nodeX}
      cy={H / 2}
      r={isMerge ? 3.2 : 4}
      fill={isMerge ? 'var(--bg-panel)' : laneColor(row.lane)}
      stroke={laneColor(row.lane)}
    />
  </svg>

  <div class="commit-cell">
    {#each row.commit.refs as ref}
      <span
        class="ref {ref.kind}"
        class:is-head={ref.isHead}
        title={ref.kind === 'remote' ? `Remote branch ${ref.name}` : ref.kind === 'tag' ? `Tag ${ref.name}` : ref.name}
      >{ref.name}</span>
    {/each}
    <span class="subject" title={row.commit.subject}>{row.commit.subject}</span>
  </div>

  <div class="author" title="{row.commit.author} <{row.commit.authorEmail}>">
    <span class="avatar" style="background: {authorColor(row.commit.authorEmail)}">
      {initials(row.commit.author)}
    </span>
    <span class="author-name">{row.commit.author}</span>
  </div>

  <div class="date" title={absoluteTime(row.commit.authorDate)}>{columnDate(row.commit.authorDate)}</div>

  <div class="hash mono">{row.commit.shortHash}</div>
</div>

<style>
  .row {
    position: absolute;
    left: 0;
    right: 0;
    height: 24px;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) 150px 74px 62px;
    align-items: center;
    column-gap: 10px;
    padding-right: 10px;
    white-space: nowrap;
    cursor: default;
    user-select: none;
  }

  .row:hover { background: var(--bg-hover); }
  .row.selected { background: var(--bg-selected); }
  .row.cursor { box-shadow: inset 0 0 0 1px var(--accent); }

  .graph { display: block; flex: none; }
  .graph path { fill: none; stroke-width: 1.6; }
  .node { stroke-width: 1.6; }
  .head-ring { fill: none; stroke-width: 1.4; opacity: 0.55; }

  /* Refs sit inline before the subject, so every row's text starts at the
     same x no matter how many branches point at the commit. */
  .commit-cell {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    overflow: hidden;
  }

  .ref {
    flex: none;
    padding: 0 5px;
    border-radius: var(--radius-sm);
    font-size: 11px;
    line-height: 16px;
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ref.local { background: var(--ref-local-bg); color: var(--ref-local-text); }
  .ref.remote { background: var(--ref-remote-bg); color: var(--ref-remote-text); }
  .ref.tag { background: var(--ref-tag-bg); color: var(--ref-tag-text); }
  .ref.head { background: var(--ref-head-bg); color: var(--ref-head-text); font-weight: 600; }
  .ref.is-head { background: var(--ref-head-bg); color: var(--ref-head-text); font-weight: 600; }

  .subject {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .author {
    display: flex;
    align-items: center;
    gap: 6px;
    overflow: hidden;
    color: var(--text-dim);
    font-size: 12px;
  }

  .avatar {
    flex: none;
    display: grid;
    place-items: center;
    width: 15px;
    height: 15px;
    border-radius: 50%;
    color: #fff;
    font-size: 8.5px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .author-name { overflow: hidden; text-overflow: ellipsis; }

  .date {
    color: var(--text-dim);
    font-size: 11.5px;
    text-align: right;
  }

  .hash {
    color: var(--text-faint);
    text-align: right;
  }

  .row.selected .subject,
  .row.selected .author,
  .row.selected .date,
  .row.selected .hash { color: var(--text); }
</style>
