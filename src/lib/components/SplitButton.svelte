<script lang="ts">
  /**
   * A button with a second, rarer action behind a caret.
   *
   * The pattern IntelliJ uses for Push: the ordinary action stays one click
   * away, and the one that can destroy work is deliberately a click further,
   * where it still has to be found rather than stumbled into.
   */
  import ContextMenu from './ContextMenu.svelte';
  import Icon from './Icon.svelte';
  import type { IconName } from './Icon.svelte';
  import type { MenuItem } from '../menu';

  interface Props {
    label: string;
    icon?: IconName;
    title?: string;
    disabled?: boolean;
    onclick: () => void;
    /** What the caret opens. Given none, the caret is not shown at all. */
    items: MenuItem[];
  }

  let { label, icon, title, disabled = false, onclick, items }: Props = $props();

  let menu = $state<{ x: number; y: number } | null>(null);

  function openMenu(event: MouseEvent) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    // Aligned to the group's left edge, so the menu hangs under the whole
    // button rather than under the sliver the caret occupies.
    const group = (event.currentTarget as HTMLElement).parentElement;
    const left = group?.getBoundingClientRect().left ?? rect.left;
    menu = { x: left, y: rect.bottom + 2 };
  }
</script>

<div class="split">
  <button class="main" {disabled} {title} onclick={() => onclick()}>
    {#if icon}<Icon name={icon} />{/if}{label}
  </button>
  {#if items.length > 0}
    <button
      class="caret"
      {disabled}
      onclick={openMenu}
      aria-haspopup="menu"
      aria-expanded={!!menu}
      aria-label="{label}: more options"
      title="More push options"
    >
      <span aria-hidden="true">▾</span>
    </button>
  {/if}
</div>

{#if menu}
  <ContextMenu x={menu.x} y={menu.y} {items} onclose={() => (menu = null)} />
{/if}

<style>
  .split {
    display: flex;
    align-items: stretch;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
  }
  .split:hover:not(:has(.main:disabled)) { border-color: var(--border); background: var(--bg-hover); }

  .main, .caret {
    background: none;
    border: 0;
    color: var(--text-dim);
  }

  .main {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px 4px 9px;
    border-radius: var(--radius-sm) 0 0 var(--radius-sm);
  }

  .caret {
    display: grid;
    place-items: center;
    width: 17px;
    padding: 0;
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    font-size: 9px;
    /* A hairline so the two halves read as two targets, not one wide button. */
    box-shadow: inset 1px 0 0 var(--border);
  }

  .split:hover .main:not(:disabled), .split:hover .caret:not(:disabled) { color: var(--text); }
  .main:hover:not(:disabled), .caret:hover:not(:disabled) { background: var(--bg-active); }

  .main:disabled, .caret:disabled { opacity: 0.45; cursor: default; }
</style>
