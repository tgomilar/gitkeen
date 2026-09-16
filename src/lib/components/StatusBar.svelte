<script lang="ts">
  import { repoStore } from '../state/repo.svelte';
  import { pluralize } from '../format';
  import { abortOperation } from '../actions';

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
    <!-- A stopped operation is the one state a user can get stranded in, so
         the way out of it lives here rather than behind a menu. -->
    <span class="item warn">{operationLabel[status.operation] ?? status.operation}</span>
    <button
      class="act"
      onclick={() => repoStore.continueOperation()}
      disabled={!!repoStore.busy || conflicts > 0}
      title={conflicts > 0
        ? `Resolve ${pluralize(conflicts, 'conflicted file')} first`
        : `Carry on with the ${status.operation}`}
    >Continue</button>
    <button
      class="act danger"
      onclick={abortOperation}
      disabled={!!repoStore.busy}
      title="Put the branch back as it was before the {status.operation} started"
    >Abandon…</button>
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
  .act {
    padding: 0 7px;
    background: var(--bg-raised);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    color: var(--text);
    font-size: 10.5px;
    line-height: 16px;
  }
  .act:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .act.danger:hover:not(:disabled) { border-color: var(--danger); color: var(--danger); }
  .act:disabled { opacity: 0.45; cursor: default; }

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
