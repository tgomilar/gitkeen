<script lang="ts">
  import { repoStore } from '../state/repo.svelte';
  import { pluralize } from '../format';

  const status = $derived(repoStore.status);

  const operationLabel: Record<string, string> = {
    rebase: 'Rebase in progress',
    merge: 'Merge in progress',
    'cherry-pick': 'Cherry-pick in progress',
    revert: 'Revert in progress',
    bisect: 'Bisect in progress'
  };

  const conflicts = $derived(status?.files.filter((f) => f.state === 'conflicted').length ?? 0);
  const untracked = $derived(status?.files.filter((f) => f.state === 'untracked').length ?? 0);
</script>

<footer class="status">
  {#if repoStore.busy}
    <span class="busy"><span class="spinner" aria-hidden="true"></span>{repoStore.busy}…</span>
  {:else if repoStore.refreshing}
    <span class="busy"><span class="spinner" aria-hidden="true"></span>Reading repository…</span>
  {:else}
    <span class="item">{repoStore.commits.length.toLocaleString()} commits</span>
    <span class="item">{repoStore.layout.laneCount} lanes</span>
  {/if}

  {#if status?.operation}
    <span class="item warn">{operationLabel[status.operation] ?? status.operation}</span>
  {/if}

  {#if conflicts > 0}
    <span class="item bad">{pluralize(conflicts, 'conflict')}</span>
  {/if}

  <span class="spacer"></span>

  {#if repoStore.dirtyFileCount > 0}
    <span class="item warn">{pluralize(repoStore.dirtyFileCount, 'change')}</span>
  {:else}
    <span class="item">working tree clean</span>
  {/if}

  {#if untracked > 0}
    <span class="item dim">{untracked} untracked</span>
  {/if}

  {#if repoStore.info}
    <span class="item dim mono" title={repoStore.info.root}>git {repoStore.info.gitVersion}</span>
  {/if}
</footer>

<style>
  .status {
    display: flex;
    align-items: center;
    gap: 14px;
    height: 22px;
    padding: 0 10px;
    background: var(--bg-panel);
    border-top: 1px solid var(--border);
    color: var(--text-dim);
    font-size: 11px;
  }

  .spacer { flex: 1; }
  .item.dim { color: var(--text-faint); }
  .item.warn { color: var(--warning); }
  .item.bad { color: var(--danger); font-weight: 600; }

  .busy { display: flex; align-items: center; gap: 6px; color: var(--text); }

  .spinner {
    width: 9px;
    height: 9px;
    border: 1.5px solid var(--border-strong);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg); } }
</style>
