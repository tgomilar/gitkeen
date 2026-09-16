<script lang="ts">
  /**
   * The shelf: work set aside, waiting to come back.
   *
   * Each row is one shelved change. Opening it lists the files it holds, and
   * clicking a file shows what is in it, so the shelf can be read before
   * anything is taken off it.
   */
  import Icon from './Icon.svelte';
  import { repoStore } from '../state/repo.svelte';
  import { commitStore } from '../state/commit.svelte';
  import { fileIcon } from '../changes';
  import { relativeTime, absoluteTime, pluralize } from '../format';
  import { showShelvedDiff } from '../actions';
  import type { Stash } from '../git/types';

  interface Props {
    open: boolean;
    ontoggle: () => void;
    onmenu: (stash: Stash, event: MouseEvent) => void;
  }

  let { open, ontoggle, onmenu }: Props = $props();

  const stashes = $derived(repoStore.stashes);
</script>

<div class="group-head">
  <button class="disclosure" onclick={ontoggle} aria-expanded={open} disabled={stashes.length === 0}>
    <span class="chevron" class:open aria-hidden="true">›</span>
    <span class="glyph" aria-hidden="true"><Icon name="shelve" size={13} /></span>
    <span class="title">Shelf</span>
    <span class="count">
      {stashes.length === 0 ? 'empty' : pluralize(stashes.length, 'change')}
    </span>
  </button>
</div>

{#if open}
  {#each stashes as stash (stash.sha)}
    {@const shown = commitStore.shelfOpen.has(stash.sha)}
    {@const files = commitStore.shelfFiles[stash.sha]}
    <div class="stash">
      <button
        class="row"
        onclick={() => commitStore.toggleShelf(stash)}
        oncontextmenu={(e) => onmenu(stash, e)}
        aria-expanded={shown}
        title="{stash.message || '(no name)'}&#10;{stash.branch ? `On ${stash.branch}` : ''} {absoluteTime(stash.date)}&#10;&#10;Right click for what you can do with it."
      >
        <span class="chevron" class:open={shown} aria-hidden="true">›</span>
        <span class="name">{stash.message || '(no name)'}</span>
        {#if stash.hasUntracked}
          <span class="flag" title="This shelved change also holds files that were not under version control">+new</span>
        {/if}
        <span class="when">{relativeTime(stash.date)}</span>
      </button>

      {#if shown}
        {#if !files}
          <p class="pending">Reading…</p>
        {:else if files.length === 0}
          <p class="pending">This shelved change holds no files.</p>
        {:else}
          {#each files as file (file.path)}
            <button
              class="file"
              onclick={() => showShelvedDiff(stash, file)}
              title="{file.path}&#10;&#10;Click to see what is in it."
            >
              <span class="glyph" aria-hidden="true"><Icon name={fileIcon(file.path)} size={13} /></span>
              <span class="file-name" class:untracked={file.untracked}>
                {file.path.split('/').pop()}
              </span>
              <span class="dir">{file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''}</span>
              {#if file.binary}
                <span class="stat bin">binary</span>
              {:else}
                <span class="stat add">+{file.added}</span>
                <span class="stat del">−{file.removed}</span>
              {/if}
            </button>
          {/each}
        {/if}
      {/if}
    </div>
  {/each}
{/if}

<style>
  .group-head {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 8px;
    margin-top: 3px;
  }
  .group-head:hover { background: var(--bg-hover); }

  .disclosure {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    height: 100%;
    padding: 0;
    background: none;
    border: 0;
    text-align: left;
  }
  .disclosure:disabled { cursor: default; }

  .chevron {
    flex: none;
    width: 10px;
    color: var(--text-faint);
    transition: transform 0.1s ease;
  }
  .chevron.open { transform: rotate(90deg); }

  .glyph { flex: none; display: flex; color: var(--text-faint); }

  .title { flex: none; font-size: 12.5px; font-weight: 600; }

  .count {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-faint);
    font-size: 11.5px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: 22px;
    padding: 0 8px 0 18px;
    background: none;
    border: 0;
    text-align: left;
    white-space: nowrap;
  }
  .row:hover { background: var(--bg-hover); }

  .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 12.5px;
  }

  .flag {
    flex: none;
    padding: 0 5px;
    border-radius: var(--radius-sm);
    background: var(--bg-sunken);
    color: var(--change-unversioned);
    font-size: 10px;
    line-height: 15px;
  }

  .when { flex: none; color: var(--text-faint); font-size: 11px; }

  .file {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: 21px;
    padding: 0 8px 0 40px;
    background: none;
    border: 0;
    text-align: left;
    white-space: nowrap;
  }
  .file:hover { background: var(--bg-hover); }

  .file-name {
    flex: none;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--change-modified);
    font-size: 12px;
  }
  .file-name.untracked { color: var(--change-unversioned); }

  .dir {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-faint);
    font-size: 11px;
  }

  .stat {
    flex: none;
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
  }
  .stat.add { color: var(--success); }
  .stat.del { color: var(--danger); }
  .stat.bin { color: var(--text-faint); }

  .pending {
    margin: 0;
    padding: 3px 8px 3px 40px;
    color: var(--text-faint);
    font-size: 11.5px;
  }
</style>
