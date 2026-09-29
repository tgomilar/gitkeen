<script lang="ts">
  /**
   * The Undo tool window: every operation that rewrote or deleted history,
   * newest first, each with the way back.
   *
   * The list is read again whenever HEAD or the branch list changes, because
   * that is when a new entry can have been written.
   */
  import Icon from './Icon.svelte';
  import { repoStore } from '../state/repo.svelte';
  import { recoveryStore } from '../state/recovery.svelte';
  import { relativeTime, absoluteTime } from '../format';

  // Anything that moves a ref can add an entry: read the log again after it.
  $effect(() => {
    void repoStore.head?.oid;
    void repoStore.branches;
    void repoStore.stashes;
    recoveryStore.load();
  });

  const KIND: Record<string, string> = { branch: 'branch', tag: 'tag', stash: 'stash', remote: 'remote' };
</script>

<section class="panel">
  <div class="toolbar">
    <button
      class="tool"
      onclick={() => recoveryStore.load()}
      disabled={recoveryStore.loading}
      title="Read the log again"
      aria-label="Refresh the operation log"
    >
      <Icon name="refresh" size={14} />
    </button>
    <span class="title">Undo</span>
  </div>

  <div class="scroll">
    <p class="intro">
      Before an operation rewrites or deletes history, Gitalia saves where things were. Restore puts
      them back.
    </p>

    {#if recoveryStore.error}
      <p class="bad">{recoveryStore.error}</p>
    {:else if recoveryStore.entries.length === 0 && !recoveryStore.loading}
      <p class="empty">
        Nothing to undo yet. Resets, squashes, drops, moves, rebases, amends, deleted branches, tags
        and stashes, and force pushes appear here.
      </p>
    {/if}

    <ul class="entries">
      {#each recoveryStore.entries as entry (entry.id)}
        <li class="entry" class:gone={!entry.restorable}>
          <div class="what">{entry.label}</div>
          <div class="meta">
            <span title={absoluteTime(entry.time)}>{relativeTime(entry.time)}</span>
            <span class="mono" title="Where the {KIND[entry.target.kind]} pointed before">was {entry.before.slice(0, 7)}</span>
          </div>
          <button
            class="restore"
            disabled={!entry.restorable || !!recoveryStore.busy || !!repoStore.status?.operation}
            title={!entry.restorable
              ? 'The recovery point is gone'
              : repoStore.status?.operation
                ? `Finish or abandon the ${repoStore.status.operation} first`
                : entry.target.kind === 'remote'
                  ? 'Make the old remote commit a local branch'
                  : `Put ${entry.target.name} back where it was`}
            onclick={() => recoveryStore.restore(entry)}
          >{recoveryStore.busy === entry.id ? 'Restoring…' : 'Restore'}</button>
        </li>
      {/each}
    </ul>
  </div>
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    background: var(--bg-panel);
    border-right: 1px solid var(--border);
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 6px;
    border-bottom: 1px solid var(--border);
  }

  .tool {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 22px;
    padding: 0;
    background: none;
    border: 0;
    border-radius: var(--radius-sm);
    color: var(--text-dim);
  }
  .tool:hover:not(:disabled) { background: var(--bg-hover); color: var(--text); }

  .title { flex: 1; font-size: 12.5px; font-weight: 600; }

  .scroll { flex: 1; overflow: auto; padding: 8px 10px 12px; }

  .intro, .empty {
    margin: 0 0 10px;
    color: var(--text-faint);
    font-size: 11.5px;
    line-height: 1.45;
  }
  .bad { color: var(--danger); font-size: 11.5px; }

  .entries { margin: 0; padding: 0; list-style: none; }

  .entry {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 2px 8px;
    padding: 7px 0;
    border-top: 1px solid var(--border);
  }
  .entry.gone { opacity: 0.55; }

  .what { grid-column: 1; font-size: 12px; overflow-wrap: anywhere; }
  .meta {
    grid-column: 1;
    display: flex;
    gap: 8px;
    color: var(--text-faint);
    font-size: 11px;
  }
  .mono { font-family: var(--font-mono); font-size: 10.5px; }

  .restore {
    grid-column: 2;
    grid-row: 1 / span 2;
    align-self: center;
    padding: 3px 9px;
    background: var(--bg-sunken);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    color: var(--text);
    font-size: 11.5px;
  }
  .restore:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .restore:disabled { opacity: 0.5; cursor: default; }
</style>
