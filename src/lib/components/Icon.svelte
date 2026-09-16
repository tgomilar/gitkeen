<script lang="ts">
  /**
   * The small glyphs used in the branch panel.
   *
   * Drawn inline rather than loaded from an icon library, because there are
   * only a few and they must take their colour from the surrounding row.
   */
  export type IconName = 'branch' | 'local' | 'remote' | 'tag' | 'folder' | 'head';

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
  {/if}
</svg>

<style>
  .icon {
    flex: none;
    display: block;
  }
</style>
