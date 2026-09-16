<script lang="ts">
  /**
   * The rail down the left edge, naming what the dock beside it can hold.
   *
   * Only one panel is open at a time, which is what IntelliJ IDEA does with
   * Project and Commit: they share the same space rather than competing for it.
   */
  import Icon from './Icon.svelte';
  import type { IconName } from './Icon.svelte';

  export type DockPanel = 'branches' | 'commit';

  interface Props {
    active: DockPanel;
    /**
     * Shown on the Commit button, so pending work is visible from anywhere.
     * Tracked changes only: unversioned files are not in the next commit by
     * default, and counting them would overstate what is waiting.
     */
    changeCount: number;
    onselect: (panel: DockPanel) => void;
  }

  let { active, changeCount, onselect }: Props = $props();

  const items: { id: DockPanel; label: string; icon: IconName; hint: string }[] = [
    { id: 'branches', label: 'Branches', icon: 'branch', hint: 'Branches, remotes and tags' },
    { id: 'commit', label: 'Commit', icon: 'commit', hint: 'Changed and unversioned files' }
  ];
</script>

<nav class="rail" aria-label="Tool panels">
  {#each items as item (item.id)}
    <button
      class="item"
      class:active={active === item.id}
      onclick={() => onselect(item.id)}
      aria-pressed={active === item.id}
      title={item.hint}
    >
      <span class="glyph">
        <Icon name={item.icon} size={17} />
        {#if item.id === 'commit' && changeCount > 0}
          <span class="badge" aria-hidden="true">{changeCount > 99 ? '99+' : changeCount}</span>
        {/if}
      </span>
      <span class="label">{item.label}</span>
    </button>
  {/each}
</nav>

<style>
  .rail {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 56px;
    padding: 6px 4px;
    background: var(--bg-app);
    border-right: 1px solid var(--border);
  }

  .item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 7px 2px 6px;
    background: none;
    border: 0;
    border-radius: var(--radius-md);
    color: var(--text-dim);
  }
  .item:hover { background: var(--bg-hover); color: var(--text); }

  .item.active {
    background: var(--accent-subtle);
    color: var(--accent);
  }

  .glyph { position: relative; display: flex; }

  .badge {
    position: absolute;
    top: -5px;
    left: 10px;
    min-width: 14px;
    padding: 0 3px;
    border-radius: 7px;
    background: var(--accent);
    color: var(--accent-text);
    font-size: 9px;
    font-weight: 600;
    line-height: 13px;
    text-align: center;
  }

  .label {
    font-size: 10px;
    letter-spacing: 0.01em;
    line-height: 1.2;
  }
</style>
