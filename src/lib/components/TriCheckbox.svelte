<script lang="ts">
  /**
   * A checkbox that can also say "some of these".
   *
   * A real `<input>` sits underneath, so the browser handles focus, the space
   * bar and screen readers. Only the box itself is drawn, because the native
   * one cannot show the third state and refuses to be recoloured.
   */
  interface Props {
    /** 'some' is the folder state: part of what is inside is ticked. */
    checkState: 'all' | 'some' | 'none';
    disabled?: boolean;
    label: string;
    onchange: () => void;
  }

  let { checkState, disabled = false, label, onchange }: Props = $props();

  let input = $state<HTMLInputElement | null>(null);

  // `indeterminate` exists only as a property, never as an attribute.
  $effect(() => {
    if (input) input.indeterminate = checkState === 'some';
  });
</script>

<span class="box" class:on={checkState === 'all'} class:partial={checkState === 'some'} class:disabled>
  <input
    bind:this={input}
    type="checkbox"
    checked={checkState === 'all'}
    {disabled}
    aria-label={label}
    onchange={onchange}
    onclick={(e) => e.stopPropagation()}
  />
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="1.75" y="1.75" width="12.5" height="12.5" rx="2.5" />
    {#if checkState === 'all'}
      <path class="mark" d="M4.4 8.3 6.9 10.8 11.7 5.6" />
    {:else if checkState === 'some'}
      <path class="mark" d="M4.6 8h6.8" />
    {/if}
  </svg>
</span>

<style>
  .box {
    position: relative;
    flex: none;
    display: block;
    width: 14px;
    height: 14px;
  }

  input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
  input:disabled { cursor: default; }

  svg {
    display: block;
    width: 14px;
    height: 14px;
    pointer-events: none;
  }

  rect {
    fill: var(--bg-panel);
    stroke: var(--border-strong);
    stroke-width: 1.3;
  }

  .on rect, .partial rect {
    fill: var(--accent);
    stroke: var(--accent);
  }

  .mark {
    fill: none;
    stroke: var(--accent-text);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .box:hover rect { stroke: var(--accent); }

  /* The focus ring has to be drawn here: the input it belongs to is invisible. */
  input:focus-visible + svg rect {
    stroke: var(--accent);
    stroke-width: 2;
  }

  .disabled { opacity: 0.45; }
  .disabled:hover rect { stroke: var(--border-strong); }
</style>
