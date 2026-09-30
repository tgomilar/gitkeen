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
  <!-- At this size only the letters, as in brand/wordmark.svg; the mark would be too small to read. -->
  <svg class="logo" viewBox="125.4 0.68 303.22 88.51" role="img" aria-label="Gitkeen">
    <g transform="translate(16.63 0)">
      <path fill="#f03c2e" d="M130.871 31.836c-4.785 0-8.351 2.352-8.351 8.008 0 4.261 2.347 7.222 8.093 7.222 4.871 0 8.18-2.867 8.18-7.398 0-5.133-2.961-7.832-7.922-7.832Zm-9.57 39.95c-1.133 1.39-2.262 2.87-2.262 4.612 0 3.48 4.434 4.524 10.527 4.524 5.051 0 11.926-.352 11.926-5.043 0-2.793-3.308-2.965-7.488-3.227Zm25.761-39.688c1.563 2.004 3.22 4.789 3.22 8.793 0 9.656-7.571 15.316-18.536 15.316-2.789 0-5.312-.348-6.879-.785l-2.87 4.613 8.526.52c15.059.96 23.934 1.398 23.934 12.968 0 10.008-8.789 15.665-23.934 15.665-15.75 0-21.757-4.004-21.757-10.88 0-3.917 1.742-6 4.789-8.878-2.875-1.211-3.828-3.387-3.828-5.739 0-1.914.953-3.656 2.523-5.312 1.566-1.652 3.305-3.305 5.395-5.219-4.262-2.09-7.485-6.617-7.485-13.058 0-10.008 6.613-16.88 19.93-16.88 3.742 0 6.004.344 8.008.872h16.972v7.394l-8.007.61M218.371 65.21c-3.742 1.825-9.223 3.481-14.187 3.481-10.356 0-14.27-4.175-14.27-14.015V31.879c0-.524 0-.871-.7-.871h-6.093v-7.746c7.664-.871 10.707-4.703 11.664-14.188h8.27v12.36c0 .609 0 .87.695.87h12.27v8.704h-12.965v20.797c0 5.136 1.218 7.136 5.918 7.136 2.437 0 4.96-.609 7.047-1.39l2.351 7.66M159.152 68.586V61.71l4.438-.606c1.219-.175 1.394-.437 1.394-1.746V33.773c0-.953-.261-1.566-1.132-1.824l-4.7-1.656.957-7.047h18.016V59.36c0 1.399.086 1.57 1.395 1.746l4.437.606v6.875h-24.805" />
      <path fill="var(--logo-ink)" d="M244.55 0.68H248.52L239.55 44.79L251.54 32.13Q256.54 26.91 259.47 24.95Q262.39 22.99 264.92 22.99Q267.35 22.99 268.95 24.77Q270.55 26.55 270.55 29.2Q270.55 32 268.64 34.07Q266.72 36.14 263.07 37.22L259.74 31.86Q256.94 34.03 254.69 35.9Q252.44 37.77 251.27 38.98Q251.76 40.15 252.75 42.41Q261.81 63.67 267.8 63.67Q268.52 63.67 269.65 63.52Q270.78 63.36 272.49 62.95V66.56Q267.94 67.91 264.65 68.56Q261.36 69.22 259.38 69.22Q255.82 69.22 253.59 67.28Q251.36 65.34 248.79 59.26L242.97 45.79L238.69 50.43L235.49 68.59H224.5L236.13 8.07L227.92 7.4V4.15ZM287.76 43.76Q294.93 43.44 299.68 40.2Q304.44 36.95 304.44 32.58Q304.44 30.42 303.2 29.16Q301.96 27.9 299.88 27.9Q296.1 27.9 292.83 32.11Q289.57 36.32 287.76 43.76ZM287 47.63Q287 47.72 286.95 47.95Q286.82 49.62 286.82 50.43Q286.82 56.19 289.39 59.35Q291.95 62.5 296.68 62.5Q299.75 62.5 303.42 60.86Q307.09 59.21 311.15 56.01V61.65Q306.19 65.48 301.3 67.44Q296.41 69.4 292.04 69.4Q284.38 69.4 280.06 64.76Q275.73 60.11 275.73 51.87Q275.73 45.29 278.41 39.52Q281.09 33.76 286.14 29.47Q289.66 26.5 293.89 24.88Q298.13 23.26 302.32 23.26Q307.63 23.26 310.7 25.96Q313.76 28.66 313.76 33.35Q313.76 40.11 307.43 43.92Q301.1 47.72 289.84 47.72Q289.39 47.72 288.44 47.68Q287.49 47.63 287 47.63ZM330.57 43.76Q337.73 43.44 342.49 40.2Q347.24 36.95 347.24 32.58Q347.24 30.42 346 29.16Q344.76 27.9 342.69 27.9Q338.91 27.9 335.64 32.11Q332.37 36.32 330.57 43.76ZM329.8 47.63Q329.8 47.72 329.76 47.95Q329.62 49.62 329.62 50.43Q329.62 56.19 332.19 59.35Q334.76 62.5 339.49 62.5Q342.56 62.5 346.23 60.86Q349.9 59.21 353.96 56.01V61.65Q349 65.48 344.11 67.44Q339.22 69.4 334.85 69.4Q327.19 69.4 322.86 64.76Q318.54 60.11 318.54 51.87Q318.54 45.29 321.22 39.52Q323.9 33.76 328.95 29.47Q332.46 26.5 336.7 24.88Q340.93 23.26 345.12 23.26Q350.44 23.26 353.5 25.96Q356.57 28.66 356.57 33.35Q356.57 40.11 350.24 43.92Q343.91 47.72 332.64 47.72Q332.19 47.72 331.25 47.68Q330.3 47.63 329.8 47.63ZM378.24 23.08H381.85L380 32.22Q385.86 27.45 390.27 25.26Q394.69 23.08 398.43 23.08Q402.12 23.08 404.49 25.58Q406.85 28.08 406.85 32.13Q406.85 33.39 406.58 35.22Q406.31 37.04 405.82 39.43L403.07 52.05Q402.53 54.71 402.28 56.31Q402.03 57.91 402.03 58.9Q402.03 60.88 403.14 62.19Q404.24 63.49 405.91 63.49Q407.26 63.49 408.77 63.25Q410.28 63 411.99 62.5V66.02Q407.85 67.55 404.31 68.34Q400.77 69.13 398.07 69.13Q394.46 69.13 392.57 67.48Q390.68 65.84 390.68 62.68Q390.68 61.83 390.81 60.77Q390.95 59.71 391.35 57.68L394.64 42.41Q395.05 40.38 395.27 38.85Q395.5 37.31 395.5 36.28Q395.5 33.76 394.28 32.34Q393.07 30.92 390.95 30.92Q388.83 30.92 385.88 32.49Q382.93 34.07 379.41 37.04L373.96 68.59H362.25L369.64 31.14L361.98 30.11V26.86Z" />
      <path fill="#2f6fd0" d="M170.379 16.281c-4.961 0-7.832-2.87-7.832-7.836 0-4.957 2.871-7.656 7.832-7.656 5.05 0 7.922 2.7 7.922 7.656 0 4.965-2.871 7.836-7.922 7.836Z" />
    </g>
  </svg>
</footer>

<style>
  .act.lfs.warn { color: var(--warning); }

  /* Pushed to the right edge, whatever is shown before it. */
  .logo { flex: none; height: 16px; width: auto; margin-left: auto; }

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
