<script lang="ts">
  import Self from './BranchNode.svelte';
  import Icon from './Icon.svelte';
  import type { IconName } from './Icon.svelte';
  import type { TreeNode } from '../branchTree';
  import { countBranches } from '../branchTree';
  import type { Branch } from '../git/types';

  interface Props {
    node: TreeNode;
    depth: number;
    kind: 'local' | 'remote' | 'tag';
    collapsed: Set<string>;
    currentBranch: string | null;
    /** Name of the ref the commit list is narrowed to, if it is one of these. */
    selectedRef: string | null;
    ontoggle: (path: string) => void;
    onselect: (branch: Branch) => void;
    onactivate: (branch: Branch) => void;
    onmenu: (branch: Branch, event: MouseEvent) => void;
  }

  let { node, depth, kind, collapsed, currentBranch, selectedRef, ontoggle, onselect, onactivate, onmenu }: Props = $props();

  const isFolder = $derived(!node.branch && node.children.length > 0);
  const isOpen = $derived(!collapsed.has(node.path));
  const isCurrent = $derived(!!node.branch && kind === 'local' && node.branch.name === currentBranch);
  const isSelected = $derived(!!node.branch && node.branch.name === selectedRef);
  const indent = $derived(6 + depth * 12);
  /** A tag is a label on a commit, so it gets its own glyph. */
  const leafIcon = $derived<IconName>(kind === 'tag' ? 'tag' : 'branch');
</script>

{#if isFolder}
  <button
    class="node folder"
    style="padding-left: {indent}px"
    onclick={() => ontoggle(node.path)}
    aria-expanded={isOpen}
  >
    <span class="chevron" class:open={isOpen} aria-hidden="true">›</span>
    <span class="glyph"><Icon name="folder" /></span>
    <span class="name">{node.name}</span>
    <span class="count">{countBranches(node)}</span>
  </button>
  {#if isOpen}
    {#each node.children as child (child.path + (child.branch ? ':b' : ''))}
      <Self node={child} depth={depth + 1} {kind} {collapsed} {currentBranch} {selectedRef}
            {ontoggle} {onselect} {onactivate} {onmenu} />
    {/each}
  {/if}
{:else if node.branch}
  {@const branch = node.branch}
  <button
    class="node branch"
    class:current={isCurrent}
    class:selected={isSelected}
    style="padding-left: {indent}px"
    title={branch.name}
    aria-pressed={isSelected}
    onclick={() => onselect(branch)}
    ondblclick={() => onactivate(branch)}
    oncontextmenu={(e) => onmenu(branch, e)}
    onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onactivate(branch); } }}
  >
    <!-- Stands in for the folder chevron, so names line up at every depth. -->
    <span class="chevron-space" aria-hidden="true"></span>
    <span class="glyph" class:current={isCurrent} aria-hidden="true"><Icon name={leafIcon} /></span>
    <span class="name">{node.name}</span>
    {#if branch.ahead > 0 || branch.behind > 0}
      <span class="track" title="{branch.ahead} ahead, {branch.behind} behind {branch.upstream}">
        {#if branch.ahead > 0}<span class="ahead">↑{branch.ahead}</span>{/if}
        {#if branch.behind > 0}<span class="behind">↓{branch.behind}</span>{/if}
      </span>
    {:else if kind === 'local' && !branch.upstream}
      <span class="untracked" title="No upstream branch">local</span>
    {/if}
  </button>
{/if}

<style>
  .node {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: 22px;
    padding-right: 8px;
    background: none;
    border: 0;
    text-align: left;
    white-space: nowrap;
  }

  .node:hover { background: var(--bg-hover); }

  .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 12.5px;
  }

  .folder .name { color: var(--text-dim); }

  .chevron,
  .chevron-space {
    display: inline-block;
    flex: none;
    width: 10px;
    color: var(--text-faint);
  }
  .chevron { transition: transform 0.1s ease; }
  .chevron.open { transform: rotate(90deg); }

  .count {
    color: var(--text-faint);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
  }

  .glyph {
    flex: none;
    display: flex;
    color: var(--text-faint);
  }
  .glyph.current { color: var(--success); }
  .node:hover .glyph { color: var(--text-dim); }
  .node:hover .glyph.current { color: var(--success); }

  .branch.current .name { font-weight: 600; }
  .branch.current { background: var(--accent-subtle); }

  /* The branch whose commits the graph is showing. */
  .branch.selected { background: var(--bg-selected); }
  .branch.selected:hover { background: var(--bg-selected); }

  .track {
    display: flex;
    gap: 4px;
    font-family: var(--font-mono);
    font-size: 10.5px;
  }
  .ahead { color: var(--success); }
  .behind { color: var(--warning); }

  .untracked {
    color: var(--text-faint);
    font-size: 10px;
    letter-spacing: 0.03em;
  }
</style>
