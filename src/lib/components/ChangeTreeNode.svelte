<script lang="ts">
  /** One node of the folder tree, when "Group by directory" is on. */
  import Self from './ChangeTreeNode.svelte';
  import Icon from './Icon.svelte';
  import TriCheckbox from './TriCheckbox.svelte';
  import ChangeRow from './ChangeRow.svelte';
  import { changesUnder } from '../changes';
  import type { Change, ChangeNode } from '../changes';

  interface Props {
    node: ChangeNode;
    depth: number;
    collapsed: Set<string>;
    disabled: boolean;
    isChecked: (path: string) => boolean;
    groupState: (paths: string[]) => 'all' | 'some' | 'none';
    ontoggleNode: (key: string) => void;
    ontoggleCheck: (changes: Change[], on: boolean) => void;
    onmenu: (change: Change, event: MouseEvent) => void;
  }

  let {
    node, depth, collapsed, disabled, isChecked, groupState,
    ontoggleNode, ontoggleCheck, onmenu
  }: Props = $props();

  const indent = $derived(8 + depth * 13);
  const open = $derived(!collapsed.has(node.path));
  const contents = $derived(node.change ? [] : changesUnder(node));
  const state = $derived(groupState(contents.map((c) => c.path)));
</script>

{#if node.change}
  {@const change = node.change}
  <ChangeRow
    {change}
    indent={indent + 14}
    showDir={false}
    checked={isChecked(change.path)}
    {disabled}
    ontoggle={() => ontoggleCheck([change], !isChecked(change.path))}
    onmenu={(e) => onmenu(change, e)}
  />
{:else}
  <div class="folder" style="padding-left: {indent}px">
    <TriCheckbox
      checkState={state}
      {disabled}
      label="Include everything in {node.path} in the commit"
      onchange={() => ontoggleCheck(contents, state !== 'all')}
    />
    <button class="disclosure" onclick={() => ontoggleNode(node.path)} aria-expanded={open}>
      <span class="chevron" class:open aria-hidden="true">›</span>
      <span class="glyph" aria-hidden="true"><Icon name="folder" size={14} /></span>
      <span class="name">{node.name}</span>
      <span class="count">{contents.length}</span>
    </button>
  </div>
  {#if open}
    {#each node.children as child (child.path + (child.change ? ':f' : ''))}
      <Self
        node={child}
        depth={depth + 1}
        {collapsed}
        {disabled}
        {isChecked}
        {groupState}
        {ontoggleNode}
        {ontoggleCheck}
        {onmenu}
      />
    {/each}
  {/if}
{/if}

<style>
  .folder {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 22px;
    padding-right: 8px;
  }
  .folder:hover { background: var(--bg-hover); }

  .disclosure {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    height: 100%;
    padding: 0;
    background: none;
    border: 0;
    text-align: left;
  }

  .chevron {
    flex: none;
    width: 10px;
    color: var(--text-faint);
    transition: transform 0.1s ease;
  }
  .chevron.open { transform: rotate(90deg); }

  .glyph { flex: none; display: flex; color: var(--text-faint); }

  .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12.5px;
  }

  .count {
    flex: none;
    color: var(--text-faint);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
</style>
