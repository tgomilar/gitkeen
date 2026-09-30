<script lang="ts">
  import { repoStore } from '../state/repo.svelte';
  import { pluralize } from '../format';
  import { abortOperation, continueOperation, resolveNextConflict } from '../actions';
  import { bisectStore } from '../state/bisect.svelte';
  import { lfsStore } from '../state/lfs.svelte';

  // A bisect moves HEAD with every answer, so its state is read again then.
  $effect(() => {
    if (repoStore.status?.operation === 'bisect') {
      void repoStore.head?.oid;
      bisectStore.load();
    }
  });
  const bisect = $derived(bisectStore.state);

  // Whether the repository uses LFS, and whether its files are here, can
  // change with any checkout or pull.
  $effect(() => {
    void repoStore.head?.oid;
    void repoStore.info?.root;
    lfsStore.load();
  });

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

  {#if status?.operation === 'bisect'}
    <!-- A bisect is a question and answer, not an operation to continue. -->
    <span class="item warn">Bisecting</span>
    {#if bisect.found}
      <span class="item">first bad commit: <b class="mono">{bisect.found.slice(0, 7)}</b></span>
    {:else if bisect.onlySkipped}
      <span class="item dim">only skipped commits are left</span>
    {:else}
      <span class="item dim" title="The commit checked out for you to test">testing <span class="mono">{bisect.current?.slice(0, 7) ?? '…'}</span>{#if bisect.steps != null}, about {pluralize(bisect.steps, 'step')} left{/if}</span>
      <button class="act" onclick={() => bisectStore.mark('good')} disabled={bisectStore.busy} title="This commit works">Good</button>
      <button class="act danger" onclick={() => bisectStore.mark('bad')} disabled={bisectStore.busy} title="This commit is broken">Bad</button>
      <button class="act" onclick={() => bisectStore.mark('skip')} disabled={bisectStore.busy} title="This commit cannot be tested">Skip</button>
    {/if}
    <button class="act" onclick={() => bisectStore.stop()} disabled={bisectStore.busy} title="End the bisect and go back to your branch">Stop</button>
  {:else if status?.operation}
    <!-- A stopped operation is the one state a user can get stranded in, so
         the way out of it lives here rather than behind a menu. -->
    <span class="item warn">{operationLabel[status.operation] ?? status.operation}</span>
    {#if status.rebaseStop === 'edit'}
      <span class="item dim" title="The stopped commit is amended with whatever the working tree holds, plus any message you wrote for it in the plan.">stops to amend</span>
    {/if}
    <button
      class="act"
      onclick={continueOperation}
      disabled={!!repoStore.busy || conflicts > 0}
      title={conflicts > 0
        ? `Resolve ${pluralize(conflicts, 'conflicted file')} first`
        : status.rebaseStop === 'edit'
          ? 'Amend the stopped commit (files or message), then carry on with the plan'
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
    <button
      class="act"
      onclick={resolveNextConflict}
      disabled={!!repoStore.busy}
      title="Open the first conflicted file in the merge editor"
    >Resolve…</button>
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
  {#if lfsStore.used}
    <button class="act lfs" class:warn={lfsStore.missing > 0 || !lfsStore.status?.installed || !lfsStore.status?.ready}
      onclick={() => lfsStore.show()}
      title={!lfsStore.status?.installed ? 'This repository uses Git LFS, but git-lfs is not installed'
        : !lfsStore.status?.ready ? 'Git LFS is not set up for this repository'
        : lfsStore.missing > 0 ? `${lfsStore.missing} LFS files are only pointers. Click to download them.`
        : 'Files stored in Git LFS'}>
      LFS{lfsStore.missing > 0 ? ` · ${lfsStore.missing} not downloaded` : !lfsStore.status?.installed ? ' · not installed' : !lfsStore.status?.ready ? ' · not set up' : ''}
    </button>
  {/if}
</footer>

<style>
  .act.lfs.warn { color: var(--warning); }

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
