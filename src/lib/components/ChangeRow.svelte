<script lang="ts">
  /**
   * One changed file.
   *
   * The box and the name do different things, as they do in IntelliJ IDEA. The
   * box decides whether the file joins the commit. The name selects the file,
   * and opens its diff on a double click or on Enter.
   *
   * The colour of the name carries the file's state: blue for edited, green
   * for new, grey and struck through for deleted, brown for a file Git has
   * never seen.
   */
  import Icon from './Icon.svelte';
  import TriCheckbox from './TriCheckbox.svelte';
  import { fileIcon, describeChange, KIND_LABEL } from '../changes';
  import type { Change } from '../changes';

  interface Props {
    change: Change;
    /** Left padding in pixels, set by the depth in the folder tree. */
    indent: number;
    /** Flat lists put the folder beside the name; a tree already shows it. */
    showDir: boolean;
    checked: boolean;
    selected: boolean;
    disabled: boolean;
    ontoggle: () => void;
    onselect: () => void;
    onopen: () => void;
    onmenu: (event: MouseEvent) => void;
  }

  let {
    change, indent, showDir, checked, selected, disabled,
    ontoggle, onselect, onopen, onmenu
  }: Props = $props();

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      onopen();
    }
  }
</script>

<div class="row {change.kind}" class:selected style="padding-left: {indent}px">
  <TriCheckbox
    checkState={checked ? 'all' : 'none'}
    {disabled}
    label="Include {change.path} in the commit"
    onchange={ontoggle}
  />
  <button
    class="open"
    title="{describeChange(change)}&#10;&#10;Double click to see the diff."
    onclick={onselect}
    ondblclick={onopen}
    oncontextmenu={onmenu}
    {onkeydown}
  >
    <span class="glyph" aria-hidden="true"><Icon name={fileIcon(change.name)} size={14} /></span>
    <span class="name">{change.name}</span>
    {#if change.file.origPath}
      <span class="from">← {change.file.origPath}</span>
    {:else if showDir && change.dir}
      <span class="dir">{change.dir}</span>
    {:else}
      <span class="dir"></span>
    {/if}
    {#if change.kind === 'conflict'}
      <span class="flag">conflict</span>
    {:else if change.staged}
      <!-- Ticking a box never stages, so a file already in the index is worth
           pointing out: the user put it there by other means. -->
      <span class="flag staged" title="Already staged. {KIND_LABEL[change.kind]}.">staged</span>
    {/if}
  </button>
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 22px;
    padding-right: 8px;
    white-space: nowrap;
  }
  .row:hover { background: var(--bg-hover); }
  .row.selected { background: var(--bg-selected); }

  .open {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    height: 100%;
    padding: 0;
    background: none;
    border: 0;
    text-align: left;
  }

  .glyph { flex: none; display: flex; color: var(--text-faint); }

  .name {
    flex: none;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 12.5px;
  }

  .modified .name, .renamed .name { color: var(--change-modified); }
  .added .name { color: var(--change-added); }
  .deleted .name { color: var(--change-deleted); text-decoration: line-through; }
  .conflict .name { color: var(--change-conflict); font-weight: 600; }
  .unversioned .name { color: var(--change-unversioned); }

  .dir, .from {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-faint);
    font-size: 11.5px;
  }

  .flag {
    flex: none;
    padding: 0 5px;
    border-radius: var(--radius-sm);
    background: var(--danger-subtle);
    color: var(--danger);
    font-size: 10px;
    line-height: 15px;
  }

  .flag.staged {
    background: var(--bg-sunken);
    color: var(--text-faint);
  }
</style>
