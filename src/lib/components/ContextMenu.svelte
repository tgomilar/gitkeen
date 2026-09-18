<script lang="ts">
  /** A fast, keyboard-navigable context menu. No animation by design. */
  import type { MenuItem } from '../menu';
  import Icon from './Icon.svelte';

  interface Props {
    x: number;
    y: number;
    items: MenuItem[];
    onclose: () => void;
  }

  let { x, y, items, onclose }: Props = $props();

  let menu = $state<HTMLDivElement | null>(null);
  let active = $state(firstEnabled());
  /** Measured once the menu is in the DOM, so it can be kept on screen. */
  let size = $state({ w: 0, h: 0 });

  const pos = $derived({
    x: size.w && x + size.w > window.innerWidth - 8
      ? Math.max(8, window.innerWidth - size.w - 8)
      : x,
    y: size.h && y + size.h > window.innerHeight - 8
      ? Math.max(8, window.innerHeight - size.h - 8)
      : y
  });

  function firstEnabled() {
    return items.findIndex((i) => !i.separator && !i.disabled);
  }

  function step(delta: number) {
    let i = active;
    for (let n = 0; n < items.length; n++) {
      i = (i + delta + items.length) % items.length;
      if (!items[i].separator && !items[i].disabled) { active = i; return; }
    }
  }

  function choose(item: MenuItem) {
    if (item.disabled || item.separator || !item.action) return;
    onclose();
    item.action();
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); onclose(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); step(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); step(-1); }
    else if (event.key === 'Enter') { event.preventDefault(); choose(items[active]); }
  }

  // Measure once mounted; `pos` then keeps the menu inside the window.
  $effect(() => {
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    if (rect.width !== size.w || rect.height !== size.h) {
      size = { w: rect.width, h: rect.height };
    }
    menu.focus();
  });
</script>

<svelte:window on:resize={onclose} />

<div
  class="scrim"
  role="presentation"
  onmousedown={onclose}
  oncontextmenu={(e) => { e.preventDefault(); onclose(); }}
></div>

<div
  bind:this={menu}
  class="menu"
  role="menu"
  tabindex="-1"
  style="left: {pos.x}px; top: {pos.y}px"
  {onkeydown}
>
  {#each items as item, i}
    {#if item.separator}
      <div class="sep" role="separator"></div>
    {:else}
      <button
        class="item"
        class:danger={item.danger}
        class:active={i === active}
        role="menuitem"
        disabled={item.disabled}
        onmouseenter={() => (active = i)}
        onclick={() => choose(item)}
      >
        <span class="glyph">
          {#if item.icon}<Icon name={item.icon} />{/if}
        </span>
        <span class="label">{item.label}</span>
        {#if item.hint}<span class="hint">{item.hint}</span>{/if}
      </button>
    {/if}
  {/each}
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 60;
  }

  .menu {
    position: fixed;
    z-index: 61;
    min-width: 210px;
    max-width: 320px;
    padding: 4px;
    background: var(--bg-raised);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-menu);
    outline: none;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 4px 8px;
    background: none;
    border: 0;
    border-radius: var(--radius-sm);
    text-align: left;
    white-space: nowrap;
  }

  .item.active:not(:disabled) { background: var(--accent); color: var(--accent-text); }
  .item.danger { color: var(--danger); }
  .item.danger.active { background: var(--danger); color: #fff; }
  .item:disabled { color: var(--text-faint); cursor: default; }

  /*
    Reserved whether or not the item has an icon, so every label in a menu
    starts at the same place and the column does not jump.
  */
  .glyph {
    flex: none;
    display: flex;
    width: 13px;
    color: var(--text-faint);
  }

  .item.active .glyph, .item.danger .glyph { color: inherit; }
  .item:disabled .glyph { color: var(--text-faint); }

  .label { flex: 1; overflow: hidden; text-overflow: ellipsis; }

  .hint {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
  }
  .item.active .hint { color: inherit; opacity: 0.75; }

  .sep {
    height: 1px;
    margin: 4px 6px;
    background: var(--border);
  }
</style>
