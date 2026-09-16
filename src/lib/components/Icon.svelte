<script lang="ts">
  /**
   * The small glyphs used in the branch panel.
   *
   * Drawn inline rather than loaded from an icon library, because there are
   * only a few and they must take their colour from the surrounding row.
   */
  export type IconName =
    | 'branch' | 'local' | 'remote' | 'tag' | 'folder' | 'head'
    // Tool rail and commit panel toolbar.
    | 'commit' | 'refresh' | 'rollback' | 'expand' | 'collapse' | 'tree'
    // File kinds, so a changed file is recognisable before its name is read.
    | 'file' | 'doc' | 'markup' | 'code' | 'image';

  interface Props {
    name: IconName;
    size?: number;
    title?: string;
  }

  let { name, size = 13, title }: Props = $props();
</script>

<svg
  class="icon"
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill="none"
  stroke="currentColor"
  stroke-width="1.5"
  stroke-linecap="round"
  stroke-linejoin="round"
  role={title ? 'img' : 'presentation'}
  aria-label={title}
  aria-hidden={title ? undefined : 'true'}
>
  {#if name === 'branch' || name === 'head'}
    <!-- Two commits on a line, with a third branching away from it. -->
    <circle cx="4.5" cy="3.6" r="1.7" />
    <circle cx="4.5" cy="12.4" r="1.7" />
    <circle cx="11.5" cy="3.6" r="1.7" />
    <path d="M4.5 5.3v5.4" />
    <path d="M11.5 5.3v1.1a3 3 0 0 1-3 3h-1a3 3 0 0 0-3 3" />
  {:else if name === 'local'}
    <!-- A laptop: these branches live on this machine. Pairs with the cloud. -->
    <rect x="3" y="3.2" width="10" height="7.2" rx="1.1" />
    <path d="M1.6 12.9h12.8" />
  {:else if name === 'remote'}
    <!-- A cloud, for branches that live on a server. -->
    <path d="M4.6 12.2a2.9 2.9 0 0 1 .2-5.8 3.9 3.9 0 0 1 7.3 1.1 2.5 2.5 0 0 1-.4 4.7z" />
  {:else if name === 'tag'}
    <!-- A luggage tag with its eyelet. -->
    <path d="M2.4 7.6V3a.6.6 0 0 1 .6-.6h4.6a1 1 0 0 1 .7.3l5.4 5.4a1 1 0 0 1 0 1.4l-4.6 4.6a1 1 0 0 1-1.4 0L2.7 8.3a1 1 0 0 1-.3-.7z" />
    <circle cx="5.4" cy="5.4" r="1" />
  {:else if name === 'folder'}
    <path d="M2 12.4V4.2a.8.8 0 0 1 .8-.8h3l1.4 1.6h5.9a.9.9 0 0 1 .9.9v6.5a.9.9 0 0 1-.9.9H2.9a.9.9 0 0 1-.9-.9z" />
  {:else if name === 'commit'}
    <!-- A commit: one node sitting on the line of history. -->
    <circle cx="8" cy="8" r="2.6" />
    <path d="M1.8 8h3.6" />
    <path d="M10.6 8h3.6" />
  {:else if name === 'refresh'}
    <path d="M13.4 8a5.4 5.4 0 1 1-1.6-3.8" />
    <path d="M13.6 2.4v3.3h-3.3" />
  {:else if name === 'rollback'}
    <!-- The same arc, turned the other way: undo. -->
    <path d="M2.6 8a5.4 5.4 0 1 0 1.6-3.8" />
    <path d="M2.4 2.4v3.3h3.3" />
  {:else if name === 'expand'}
    <path d="M6.2 4.4 8 2.6l1.8 1.8" />
    <path d="M6.2 11.6 8 13.4l1.8-1.8" />
    <path d="M2.4 8h11.2" />
  {:else if name === 'collapse'}
    <path d="M6.2 1.8 8 3.6l1.8-1.8" />
    <path d="M6.2 14.2 8 12.4l1.8 1.8" />
    <path d="M2.4 8h11.2" />
  {:else if name === 'tree'}
    <!-- A folder with its files indented under it. -->
    <path d="M2.6 3.2h3.3l1 1.2h6.5" />
    <path d="M3.4 3.2v8.2a1 1 0 0 0 1 1h2.2" />
    <path d="M6.6 7.4h6.8" />
    <path d="M6.6 12.4h6.8" />
  {:else if name === 'file' || name === 'doc' || name === 'markup' || name === 'code' || name === 'image'}
    <path d="M3.4 2.4h5.3l3.9 3.9v7.3a.6.6 0 0 1-.6.6H3.4a.6.6 0 0 1-.6-.6V3a.6.6 0 0 1 .6-.6z" />
    <path d="M8.6 2.4v4h4" />
    {#if name === 'doc'}
      <path d="M5.2 9h5.6" />
      <path d="M5.2 11.4h3.6" />
    {:else if name === 'markup'}
      <!-- The angle brackets of a tag, the way IntelliJ marks markup files. -->
      <path d="M6.4 8.9 5 10.4l1.4 1.5" />
      <path d="M9.6 8.9 11 10.4l-1.4 1.5" />
    {:else if name === 'code'}
      <path d="M6.6 8.6 5.1 10.4l1.5 1.8" />
      <path d="M9.4 8.6l1.5 1.8-1.5 1.8" />
      <path d="M8.6 8.4l-1.2 4" />
    {:else if name === 'image'}
      <circle cx="6.2" cy="9.4" r="0.9" />
      <path d="M4 13.2l2.6-2.4 1.8 1.6 1.6-1.4 2 2" />
    {/if}
  {/if}
</svg>

<style>
  .icon {
    flex: none;
    display: block;
  }
</style>
