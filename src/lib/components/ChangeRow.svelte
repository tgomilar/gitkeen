<script lang="ts">
  /**
   * One changed file.
   *
   * The whole row is a label, so a click anywhere on it ticks the box. The
   * colour of the name carries the file's state, the way IntelliJ IDEA does
   * it: blue for edited, green for new, grey and struck through for deleted,
   * brown for a file Git has never seen.
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
    disabled: boolean;
    ontoggle: () => void;
    onmenu: (event: MouseEvent) => void;
  }

  let { change, indent, showDir, checked, disabled, ontoggle, onmenu }: Props = $props();
</script>

<label
  class="row {change.kind}"
  style="padding-left: {indent}px"
  title={describeChange(change)}
  oncontextmenu={onmenu}
>
  <TriCheckbox
    checkState={checked ? 'all' : 'none'}
    {disabled}
    label="Include {change.path} in the commit"
    onchange={ontoggle}
  />
  <span class="glyph" aria-hidden="true"><Icon name={fileIcon(change.name)} size={14} /></span>
  <span class="name">{change.name}</span>
  {#if change.file.origPath}
    <span class="from" title="Renamed from {change.file.origPath}">← {change.file.origPath}</span>
  {:else if showDir && change.dir}
    <span class="dir">{change.dir}</span>
  {/if}
  {#if change.kind === 'conflict'}
    <span class="flag">conflict</span>
  {:else if change.staged}
    <!-- Ticking a box never stages, so a file already in the index is worth
         pointing out: the user put it there by other means. -->
    <span class="flag staged" title="Already staged. {KIND_LABEL[change.kind]}.">staged</span>
  {/if}
</label>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 22px;
    padding-right: 8px;
    white-space: nowrap;
    cursor: default;
  }
  .row:hover { background: var(--bg-hover); }

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
