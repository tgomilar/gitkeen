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
    | 'commit' | 'refresh' | 'rollback' | 'expand' | 'collapse' | 'tree' | 'shelve' | 'stats'
    // File kinds, so a changed file is recognisable before its name is read.
    | 'file' | 'doc' | 'markup' | 'code' | 'image'
    // Context menu actions.
    | 'switch' | 'copy' | 'delete' | 'rename' | 'revert' | 'reset' | 'cherry-pick'
    | 'squash' | 'diff' | 'plus' | 'check' | 'unshelve' | 'exclude' | 'include'
    | 'fetch' | 'close' | 'branch-plus' | 'settings' | 'ai' | 'push' | 'force-push';

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
  {:else if name === 'stats'}
    <!-- Three columns of different heights: a report on what the history did. -->
    <path d="M2.2 13.8h11.6" />
    <path d="M4.6 13.6V8.4" />
    <path d="M8 13.6V3.2" />
    <path d="M11.4 13.6V6.1" />
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
  {:else if name === 'shelve'}
    <!-- A tray with work being lowered into it, to be taken out later. -->
    <path d="M8 1.9v5.6" />
    <path d="M5.6 5.3 8 7.7l2.4-2.4" />
    <path d="M2.2 9.4h3.1a2.7 2.7 0 0 0 5.4 0h3.1" />
    <path d="M2.2 9.4v3.7a1 1 0 0 0 1 1h9.6a1 1 0 0 0 1-1V9.4" />
  {:else if name === 'tree'}
    <!-- A folder with its files indented under it. -->
    <path d="M2.6 3.2h3.3l1 1.2h6.5" />
    <path d="M3.4 3.2v8.2a1 1 0 0 0 1 1h2.2" />
    <path d="M6.6 7.4h6.8" />
    <path d="M6.6 12.4h6.8" />
  {:else if name === 'ai'}
    <!--
      A four-pointed spark, the common mark for a suggestion written for you.
      A cogwheel here would read as settings in general, when everything behind
      this button is about the model that writes commit messages.
    -->
    <path d="M6.4 2.2 7.5 5.1a1.4 1.4 0 0 0 .8.8l2.9 1.1-2.9 1.1a1.4 1.4 0 0 0-.8.8l-1.1 2.9-1.1-2.9a1.4 1.4 0 0 0-.8-.8L1.6 7l2.9-1.1a1.4 1.4 0 0 0 .8-.8z" />
    <path d="M11.6 9.4l.5 1.4a1 1 0 0 0 .6.6l1.4.5-1.4.5a1 1 0 0 0-.6.6l-.5 1.4-.5-1.4a1 1 0 0 0-.6-.6L9.1 12l1.4-.5a1 1 0 0 0 .6-.6z" />
  {:else if name === 'settings'}
    <!-- A cogwheel: the usual mark for settings, so it needs no label. -->
    <circle cx="8" cy="8" r="2.1" />
    <path d="M8 1.4l.9 1.6 1.8-.4.3 1.8 1.8.4-.6 1.7 1.4 1.1-1.4 1.1.6 1.7-1.8.4-.3 1.8-1.8-.4L8 14.6l-.9-1.6-1.8.4-.3-1.8-1.8-.4.6-1.7L2.4 8.4l1.4-1.1-.6-1.7 1.8-.4.3-1.8 1.8.4z" />
  {:else if name === 'branch-plus'}
    <!-- The branch glyph with a plus where the new branch would start. -->
    <circle cx="4.2" cy="3.4" r="1.6" />
    <circle cx="4.2" cy="12.6" r="1.6" />
    <path d="M4.2 5v6" />
    <path d="M11.4 11.2V9.6a3 3 0 0 0-3-3h-2.6" />
    <path d="M11.4 1.8v4.6" />
    <path d="M9.1 4.1h4.6" />
  {:else if name === 'push'}
    <!-- The fetch cloud with the arrow turned around: work going up. -->
    <path d="M4.9 10.4a2.7 2.7 0 0 1 .2-5.4 3.6 3.6 0 0 1 6.8 1 2.3 2.3 0 0 1-.4 4.4" />
    <path d="M8 13.7V7.6" />
    <path d="M5.9 9.7 8 7.6l2.1 2.1" />
  {:else if name === 'force-push'}
    <!-- The same, struck through: the push that replaces what is there. -->
    <path d="M4.9 10.4a2.7 2.7 0 0 1 .2-5.4 3.6 3.6 0 0 1 6.8 1 2.3 2.3 0 0 1-.4 4.4" />
    <path d="M8 13.7V7.6" />
    <path d="M5.9 9.7 8 7.6l2.1 2.1" />
    <path d="M2.4 13.6 13.6 2.4" />
  {:else if name === 'fetch'}
    <!-- The cloud again, with what it holds coming down to this machine. -->
    <path d="M4.9 10.4a2.7 2.7 0 0 1 .2-5.4 3.6 3.6 0 0 1 6.8 1 2.3 2.3 0 0 1-.4 4.4" />
    <path d="M8 7.6v6.1" />
    <path d="M5.9 11.6 8 13.7l2.1-2.1" />
  {:else if name === 'close'}
    <path d="M4 4l8 8" />
    <path d="M12 4l-8 8" />
  {:else if name === 'switch'}
    <!-- Two arrows passing each other: leaving one ref for another. -->
    <path d="M2.4 5.4h9.1" />
    <path d="M9.3 3.2l2.2 2.2-2.2 2.2" />
    <path d="M13.6 10.6H4.5" />
    <path d="M6.7 8.4 4.5 10.6l2.2 2.2" />
  {:else if name === 'copy'}
    <!-- Two sheets, the front one offset: the second is the copy. -->
    <rect x="5.6" y="5.6" width="8" height="8" rx="1" />
    <path d="M10.4 2.4H3.4a1 1 0 0 0-1 1v7" />
  {:else if name === 'delete'}
    <!-- A bin with its lid and one stave. -->
    <path d="M2.6 4.4h10.8" />
    <path d="M6.4 4.4V3a.6.6 0 0 1 .6-.6h2a.6.6 0 0 1 .6.6v1.4" />
    <path d="M3.9 4.4l.6 8.4a1 1 0 0 0 1 .9h5a1 1 0 0 0 1-.9l.6-8.4" />
    <path d="M8 6.8v4.4" />
  {:else if name === 'rename'}
    <!-- A pencil: the name is edited in place. -->
    <path d="M11.1 2.6a1.5 1.5 0 0 1 2.1 2.1l-7.5 7.5-2.8.7.7-2.8z" />
    <path d="M10.1 3.6l2.1 2.1" />
  {:else if name === 'revert'}
    <!-- An arrow curving back on itself: the change is undone by a new one. -->
    <path d="M2.8 6.6h7.3a3.4 3.4 0 0 1 0 6.8H6.4" />
    <path d="M5.2 3.8 2.6 6.6l2.6 2.8" />
  {:else if name === 'reset'}
    <!-- A branch tip dragged back to an earlier node on the line. -->
    <circle cx="12.2" cy="8" r="1.8" />
    <path d="M10.4 8H5.6" />
    <path d="M7.4 5.6 5 8l2.4 2.4" />
    <path d="M2.6 4.2v7.6" />
  {:else if name === 'cherry-pick'}
    <!-- One commit lifted off its line and carried across. -->
    <circle cx="4.2" cy="11.8" r="1.7" />
    <path d="M1.9 11.8h.6" />
    <path d="M5.9 11.8h.6" />
    <path d="M4.2 10.1V7.4a2 2 0 0 1 2-2h4.4" />
    <path d="M8.8 3.4l2.1 2-2.1 2" />
  {:else if name === 'squash'}
    <!-- Several commits pressed down into one. -->
    <circle cx="8" cy="11.9" r="1.8" />
    <path d="M4.6 6.4 8 9.2l3.4-2.8" />
    <path d="M4.6 2.9 8 5.7l3.4-2.8" />
  {:else if name === 'diff'}
    <!-- A line added and a line removed, which is what a diff shows. -->
    <path d="M4.2 2.9v5.2" />
    <path d="M1.6 5.5h5.2" />
    <path d="M9.2 10.5h5.2" />
  {:else if name === 'plus'}
    <path d="M8 3.2v9.6" />
    <path d="M3.2 8h9.6" />
  {:else if name === 'check'}
    <path d="M3.2 8.4 6.4 11.6l6.4-7.2" />
  {:else if name === 'unshelve'}
    <!-- The shelve tray, with the work coming back up out of it. -->
    <path d="M8 7.7V2.1" />
    <path d="M5.6 4.5 8 2.1l2.4 2.4" />
    <path d="M2.2 9.4h3.1a2.7 2.7 0 0 0 5.4 0h3.1" />
    <path d="M2.2 9.4v3.7a1 1 0 0 0 1 1h9.6a1 1 0 0 0 1-1V9.4" />
  {:else if name === 'exclude'}
    <!-- An empty box: the file is taken out of the commit. -->
    <rect x="2.8" y="2.8" width="10.4" height="10.4" rx="1.2" />
  {:else if name === 'include'}
    <!-- The same box, ticked: the file goes in. -->
    <rect x="2.8" y="2.8" width="10.4" height="10.4" rx="1.2" />
    <path d="M5.4 8.1 7.2 9.9l3.5-3.9" />
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
