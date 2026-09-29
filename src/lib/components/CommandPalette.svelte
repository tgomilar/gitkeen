<script lang="ts">
  /**
   * One searchable list of everything the app can do, opened with ⌘⇧P.
   *
   * It owns the keyboard while it is open, so the window-level shortcut
   * handler in App.svelte stands aside for it. Typing filters the list, the
   * arrows move, Enter runs, Escape closes.
   */
  import { paletteStore } from '../state/palette.svelte';
  import Icon from './Icon.svelte';

  let input = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (!paletteStore.open) return;
    requestAnimationFrame(() => {
      if (paletteStore.query === '') input?.select();
      else input?.focus();
    });
  });

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      paletteStore.close();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      paletteStore.step(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      paletteStore.step(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      paletteStore.run();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      paletteStore.step(event.shiftKey ? -1 : 1);
    }
  }
</script>

{#if paletteStore.open}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="scrim" role="presentation" onmousedown={(e) => { if (e.target === e.currentTarget) paletteStore.close(); }}>
    <div class="palette" role="dialog" aria-modal="true" aria-label="Command palette" tabindex="-1">
      <div class="field">
        <Icon name="commit" size={14} />
        <input
          bind:this={input}
          bind:value={paletteStore.query}
          placeholder="Run a command…"
          spellcheck="false"
          oninput={() => (paletteStore.active = 0)}
          onkeydown={onkeydown}
        />
        <span class="hint">⌘⇧P</span>
      </div>

      <div class="list">
        {#each paletteStore.shown as command, i (command.id)}
          <div class="slot">
            {#if i === 0 || paletteStore.shown[i - 1].group !== command.group}
              <div class="group">{command.group}</div>
            {/if}
            <button
              class="item"
              class:active={i === paletteStore.active}
              class:disabled={command.disabled}
              disabled={command.disabled}
              onmouseenter={() => (paletteStore.active = i)}
              onclick={() => { paletteStore.active = i; paletteStore.run(); }}
            >
              <span class="glyph">{#if command.icon}<Icon name={command.icon} />{/if}</span>
              <span class="label" class:danger={command.danger}>{command.label}</span>
              {#if command.hint}<span class="hint" class:danger={command.danger}>{command.hint}</span>{/if}
            </button>
          </div>
        {/each}

        {#if paletteStore.shown.length === 0}
          <div class="empty">
            Nothing matches <span class="mono">"{paletteStore.query}"</span>.
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
    z-index: 80;
    background: var(--scrim);
  }

  .palette {
    position: fixed;
    z-index: 81;
    top: 18%;
    left: 50%;
    transform: translateX(-50%);
    width: min(560px, calc(100vw - 32px));
    max-height: 60vh;
    display: flex;
    flex-direction: column;
    background: var(--bg-raised);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-modal);
    overflow: hidden;
    outline: none;
  }

  .field {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: var(--bg-panel);
    border-bottom: 1px solid var(--border);
    color: var(--text-faint);
  }
  .field input {
    flex: 1;
    min-width: 0;
    background: none;
    border: 0;
    outline: 0;
    color: var(--text);
    font-size: 13.5px;
  }
  .field input::placeholder { color: var(--text-faint); }
  .field .hint {
    flex: none;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
  }

  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 5px;
  }

  .group {
    padding: 7px 9px 3px;
    color: var(--text-faint);
    font-size: 10.5px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 9px;
    background: none;
    border: 0;
    border-radius: var(--radius-sm);
    color: var(--text);
    text-align: left;
    font-size: 12.5px;
    white-space: nowrap;
  }
  .item.active { background: var(--accent); color: var(--accent-text); }
  .item.disabled { color: var(--text-faint); cursor: default; }

  .glyph {
    flex: none;
    display: flex;
    width: 14px;
    color: var(--text-dim);
  }
  .item.active .glyph { color: inherit; }
  .item.disabled .glyph { color: var(--text-faint); }

  .label { flex: 1; overflow: hidden; text-overflow: ellipsis; }
  .label.danger { color: var(--danger); }
  .item.active .label.danger { color: inherit; }
  .item.disabled .label.danger { color: var(--text-faint); }

  .hint {
    flex: none;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-faint);
  }
  .item.active .hint { color: inherit; opacity: 0.75; }
  .hint.danger { color: var(--danger); }
  .item.active .hint.danger { color: inherit; }

  .empty {
    padding: 26px 12px;
    color: var(--text-dim);
    font-size: 12.5px;
    text-align: center;
  }
</style>