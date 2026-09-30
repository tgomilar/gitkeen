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
  <!-- The full logo, as in logo.svg, its dark parts in the theme's text colour. -->
  <svg class="logo" viewBox="-1 -4 349 104" role="img" aria-label="Gitkeen">
      <g transform="translate(0 19.2) scale(2.3529)" fill="none" stroke-width="2.2">
      <path d="M24 4 V25 a5 5 0 0 1 -5 5 H10" stroke="#f03c2e" />
      <path d="M24 7 H16 a7 7 0 0 0 0 14 H24" stroke="var(--text)" />
      <circle cx="24" cy="4" r="3" fill="#2f6fd0" />
      <circle cx="9" cy="14" r="3" fill="#f03c2e" />
      <circle cx="8" cy="30" r="3" fill="#2f6fd0" />
      </g>
      <g transform="translate(-34 0)">
      <path fill="#f03c2e" d="M130.871 31.836c-4.785 0-8.351 2.352-8.351 8.008 0 4.261 2.347 7.222 8.093 7.222 4.871 0 8.18-2.867 8.18-7.398 0-5.133-2.961-7.832-7.922-7.832Zm-9.57 39.95c-1.133 1.39-2.262 2.87-2.262 4.612 0 3.48 4.434 4.524 10.527 4.524 5.051 0 11.926-.352 11.926-5.043 0-2.793-3.308-2.965-7.488-3.227Zm25.761-39.688c1.563 2.004 3.22 4.789 3.22 8.793 0 9.656-7.571 15.316-18.536 15.316-2.789 0-5.312-.348-6.879-.785l-2.87 4.613 8.526.52c15.059.96 23.934 1.398 23.934 12.968 0 10.008-8.789 15.665-23.934 15.665-15.75 0-21.757-4.004-21.757-10.88 0-3.917 1.742-6 4.789-8.878-2.875-1.211-3.828-3.387-3.828-5.739 0-1.914.953-3.656 2.523-5.312 1.566-1.652 3.305-3.305 5.395-5.219-4.262-2.09-7.485-6.617-7.485-13.058 0-10.008 6.613-16.88 19.93-16.88 3.742 0 6.004.344 8.008.872h16.972v7.394l-8.007.61M218.371 65.21c-3.742 1.825-9.223 3.481-14.187 3.481-10.356 0-14.27-4.175-14.27-14.015V31.879c0-.524 0-.871-.7-.871h-6.093v-7.746c7.664-.871 10.707-4.703 11.664-14.188h8.27v12.36c0 .609 0 .87.695.87h12.27v8.704h-12.965v20.797c0 5.136 1.218 7.136 5.918 7.136 2.437 0 4.96-.609 7.047-1.39l2.351 7.66M159.152 68.586V61.71l4.438-.606c1.219-.175 1.394-.437 1.394-1.746V33.773c0-.953-.261-1.566-1.132-1.824l-4.7-1.656.957-7.047h18.016V59.36c0 1.399.086 1.57 1.395 1.746l4.437.606v6.875h-24.805" />
      <path fill="var(--text)" d="M233.98 48.42Q242.34 47.39 247.26 43.91Q252.17 40.43 252.17 35.66Q252.17 33.37 251.1 32.16Q250.02 30.95 247.95 30.95Q245.3 30.95 237.98 37.42Q236.27 38.9 235.33 39.71ZM222.93 69.89Q224.64 62.57 227.29 47.16Q227.83 44.11 228.1 42.54L230.03 31.62Q231.6 22.32 232.7 15.14Q233.8 7.95 233.8 7.14Q233.8 5.57 233.13 4.87Q232.45 4.17 230.93 4.17Q230.43 4.17 229.89 4.2Q229.36 4.22 228.73 4.26L228.46 1.61Q232.14 1.12 235.89 0.38Q239.64 -0.36 243.46 -1.44Q242.43 3.19 241.46 7.88Q240.5 12.57 239.51 17.61L236.09 35.3L237.13 34.23Q246.42 25.06 251.55 25.06Q254.82 25.06 256.96 27.56Q259.09 30.05 259.09 34Q259.09 38.85 255.32 42.58Q251.55 46.31 244.18 48.74Q248.9 56.37 252.08 60.15Q255.27 63.92 256.98 63.92Q257.65 63.92 258.58 63.31Q259.5 62.71 262.01 60.5L263.49 62.98Q259.36 67.2 257.41 68.5Q255.45 69.8 253.75 69.8Q250.69 69.8 247.46 66.16Q244.22 62.53 237.67 50.76Q236.68 50.98 235.62 51.16Q234.57 51.34 233.44 51.48L232.68 55.61Q232.27 58.39 231.85 61.45Q231.42 64.5 231.02 67.87ZM274.95 48.33 275.4 48.11Q291.39 39.93 291.39 35.48Q291.39 33.1 289.68 31.35Q287.98 29.6 285.68 29.6Q282.14 29.6 279.31 34.5Q276.48 39.39 274.95 48.33ZM288.47 45.23 274.72 52.33V52.78Q274.72 58.12 276.41 60.91Q278.09 63.69 281.28 63.69Q283.17 63.69 286.02 62.01Q288.87 60.32 293.32 56.55L294.89 59.38Q288.47 65.31 284.67 67.6Q280.88 69.89 277.78 69.89Q273.06 69.89 270.14 65.8Q267.22 61.72 267.22 55.07Q267.22 50.35 268.77 44.94Q270.32 39.53 272.79 35.48Q275.89 30.54 279.89 27.85Q283.89 25.15 288.16 25.15Q292.51 25.15 295.45 27.91Q298.4 30.68 298.4 34.63Q298.4 37.82 296.62 39.91Q294.85 42 288.47 45.23ZM309.9 48.33 310.35 48.11Q326.34 39.93 326.34 35.48Q326.34 33.1 324.63 31.35Q322.92 29.6 320.63 29.6Q317.08 29.6 314.25 34.5Q311.42 39.39 309.9 48.33ZM323.42 45.23 309.67 52.33V52.78Q309.67 58.12 311.36 60.91Q313.04 63.69 316.23 63.69Q318.12 63.69 320.97 62.01Q323.82 60.32 328.27 56.55L329.84 59.38Q323.42 65.31 319.62 67.6Q315.83 69.89 312.73 69.89Q308.01 69.89 305.09 65.8Q302.17 61.72 302.17 55.07Q302.17 50.35 303.72 44.94Q305.27 39.53 307.74 35.48Q310.84 30.54 314.84 27.85Q318.84 25.15 323.1 25.15Q327.46 25.15 330.4 27.91Q333.34 30.68 333.34 34.63Q333.34 37.82 331.57 39.91Q329.8 42 323.42 45.23ZM351.27 38.04 358.55 30.95Q362.36 27.31 364.32 26.14Q366.27 24.97 368.02 24.97Q370.99 24.97 372.85 27.58Q374.72 30.18 374.72 34.45Q374.72 38.81 372.52 47.9Q370.31 57 370.31 60.86Q370.31 62.03 370.76 62.64Q371.21 63.24 372.07 63.24Q372.47 63.24 373.08 62.91Q373.68 62.57 374.27 61.99L377.68 58.66L379.25 61.04L374.36 66.03Q372.61 67.83 370.88 68.86Q369.15 69.89 367.84 69.89Q365.6 69.89 364.18 67.94Q362.77 65.98 362.77 62.8Q362.77 58.98 365.06 49.34Q367.35 39.71 367.35 35.3Q367.35 33.64 366.65 32.63Q365.96 31.62 364.79 31.62Q363.04 31.62 354.05 39.93Q351.67 42.13 350.32 43.39L347.49 59.2Q347.4 59.65 347.23 60.55Q346.28 65.36 346.1 67.92L338.11 69.89Q341.07 57 342.8 47.48Q344.53 37.95 344.53 34.99Q344.53 33.19 344.13 32.41Q343.72 31.62 342.82 31.62Q342.28 31.62 341.05 32.25Q339.81 32.88 337.93 34.09L336.71 31.71Q337.21 31.31 338.15 30.54Q345.07 24.97 347.4 24.97Q349.65 24.97 350.73 26.66Q351.81 28.34 351.81 31.89Q351.81 33.15 351.67 34.72Q351.54 36.29 351.27 38.04Z" />
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
