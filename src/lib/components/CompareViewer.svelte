<script lang="ts">
  /**
   * Two branches or commits compared, over the whole window.
   *
   * On the left, the commits only one side has, each list under the name of
   * the side that has them. On the right, the files that differ: since the
   * two went apart (what a merge would bring in), or tip to tip. A file opens
   * in the diff viewer between the same two commits.
   */
  import { compareStore } from '../state/compare.svelte';
  import Explain from './Explain.svelte';
  import { diffStore } from '../state/diff.svelte';
  import { repoStore } from '../state/repo.svelte';
  import { relativeTime, absoluteTime, pluralize } from '../format';
  import type { Commit, CommitFileStat } from '../git/types';

  const request = $derived(compareStore.request);
  const result = $derived(compareStore.result);

  function reveal(commit: Commit) {
    repoStore.select(commit.hash, 'replace');
    repoStore.loadDetails(commit.hash);
    compareStore.close();
  }

  function openFile(file: CommitFileStat) {
    if (!result || !request) return;
    diffStore.show({
      file: file.path,
      origPath: file.origPath,
      hash: result.to,
      base: result.from,
      source: result.mode === 'split'
        ? `${request.targetLabel} since it split from ${request.baseLabel}`
        : `${request.baseLabel} → ${request.targetLabel}`
    });
  }

  function onkeydown(event: KeyboardEvent) {
    // The diff viewer opens over this one, and owns Escape while it is open.
    if (!compareStore.open || diffStore.open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      compareStore.close();
    }
  }

  function autofocus(node: HTMLElement) {
    node.focus();
  }

  const totals = $derived.by(() => {
    let added = 0, removed = 0;
    for (const f of result?.files ?? []) {
      added += f.added ?? 0;
      removed += f.removed ?? 0;
    }
    return { added, removed };
  });
</script>

<svelte:window on:keydown={onkeydown} />

{#snippet commitList(commits: Commit[], truncated: boolean, owner: string, other: string)}
  <section class="side">
    <h3>
      Only on <b class="mono">{owner}</b>
      <span class="faint">{pluralize(commits.length, 'commit')}{truncated ? ' (the newest shown)' : ''}</span>
    </h3>
    {#if commits.length === 0}
      <p class="empty">Nothing {owner} has that {other} does not.</p>
    {:else}
      <ul>
        {#each commits as commit (commit.hash)}
          <li>
            <button class="commit" onclick={() => reveal(commit)} title="Select this commit in the graph">
              <span class="mono hash">{commit.shortHash}</span>
              <span class="subject">{commit.subject}</span>
              <span class="who">{commit.author}</span>
              <span class="when" title={absoluteTime(commit.authorDate)}>{relativeTime(commit.authorDate)}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/snippet}

{#if request}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="scrim" role="dialog" aria-modal="true" aria-label="Compare {request.baseLabel} with {request.targetLabel}" tabindex="-1" use:autofocus>
    <div class="panel">
      <header>
        <div class="titles">
          <div class="path">
            <span class="badge">Compare</span>
            <b class="mono">{request.baseLabel}</b>
            <button class="swap" onclick={() => compareStore.swap()} title="Swap the two sides">⇄</button>
            <b class="mono">{request.targetLabel}</b>
          </div>
          <div class="sub">
            {#if result?.mergeBase}
              <span>they split at <span class="mono">{result.mergeBase.slice(0, 7)}</span></span>
            {:else if result}
              <span>they share no history</span>
            {/if}
          </div>
        </div>
        <div class="tools">
          <div class="modes" role="group" aria-label="Which difference to show">
            <button
              class:on={request.mode === 'split'}
              aria-pressed={request.mode === 'split'}
              disabled={!!result && !result.mergeBase}
              onclick={() => compareStore.setMode('split')}
              title="What {request.targetLabel} changed since the two went apart: what a merge would bring in"
            >Since they split</button>
            <button
              class:on={request.mode === 'tips'}
              aria-pressed={request.mode === 'tips'}
              onclick={() => compareStore.setMode('tips')}
              title="Every difference between the two ends as they are now"
            >Tip to tip</button>
          </div>
          <button class="close" onclick={() => compareStore.close()} title="Close (Escape)" aria-label="Close">×</button>
        </div>
      </header>

      <div class="body" class:stale={compareStore.loading && !!result}>
        {#if compareStore.loading && !result}
          <p class="notice">Comparing…</p>
        {:else if compareStore.error}
          <p class="notice bad">{compareStore.error}</p>
        {:else if result}
          <div class="commits">
            {@render commitList(result.onlyInTarget.commits, result.onlyInTarget.truncated, request.targetLabel, request.baseLabel)}
            {@render commitList(result.onlyInBase.commits, result.onlyInBase.truncated, request.baseLabel, request.targetLabel)}
          </div>
          <section class="files">
            <div class="explain-row">
              <Explain kind="branches" args={{ base: request.base, target: request.target }}
                subject={`${request.base}..${request.target}`} label="Explain how they differ" />
            </div>
            <h3>
              {pluralize(result.files.length, 'file')} differ
              <span class="stat add">+{totals.added.toLocaleString()}</span>
              <span class="stat del">−{totals.removed.toLocaleString()}</span>
            </h3>
            {#if result.files.length === 0}
              <p class="empty">The files are the same.</p>
            {:else}
              <ul>
                {#each result.files as file (file.path)}
                  <li>
                    <button class="file" onclick={() => openFile(file)} title="Show the diff of this file">
                      <span class="name mono">{file.path}</span>
                      {#if file.origPath}<span class="from mono">← {file.origPath}</span>{/if}
                      {#if file.binary}
                        <span class="faint">binary</span>
                      {:else}
                        <span class="stat add">+{file.added}</span>
                        <span class="stat del">−{file.removed}</span>
                      {/if}
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          </section>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .explain-row { padding: 6px 12px 0; }

  .scrim {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: flex;
    padding: 24px;
    background: var(--scrim);
  }
  .scrim:focus { outline: none; }

  .panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    background: var(--bg-panel);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-modal);
    overflow: hidden;
  }

  header {
    flex: none;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px 8px 12px;
    border-bottom: 1px solid var(--border);
  }
  .titles { flex: 1; min-width: 0; }
  .path { display: flex; align-items: center; gap: 8px; font-size: 12.5px; white-space: nowrap; overflow: hidden; }
  .badge {
    padding: 0 6px;
    border-radius: var(--radius-sm);
    background: var(--ref-local-bg);
    color: var(--ref-local-text);
    font-size: 10.5px;
    line-height: 16px;
    font-weight: 600;
  }
  .swap {
    padding: 0 6px;
    background: none;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    color: var(--text-dim);
  }
  .swap:hover { color: var(--accent); border-color: var(--accent); }
  .sub { margin-top: 2px; color: var(--text-faint); font-size: 11.5px; }

  .tools { flex: none; display: flex; align-items: center; gap: 8px; }
  .modes { display: flex; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); overflow: hidden; }
  .modes button {
    padding: 3px 10px;
    background: var(--bg-panel);
    border: 0;
    color: var(--text-dim);
    font-size: 11.5px;
  }
  .modes button + button { border-left: 1px solid var(--border-strong); }
  .modes button.on { background: var(--accent); color: var(--accent-text); }
  .modes button:disabled { opacity: 0.5; }
  .close {
    width: 26px;
    height: 24px;
    padding: 0;
    background: none;
    border: 0;
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    font-size: 17px;
  }
  .close:hover { background: var(--bg-hover); color: var(--text); }

  .body { flex: 1; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); min-height: 0; }
  .body.stale { opacity: 0.6; }
  .notice { grid-column: 1 / -1; margin: 24px; color: var(--text-dim); }
  .notice.bad { color: var(--danger); font-family: var(--font-mono); font-size: 12px; }

  .commits { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--border); overflow: auto; }
  .side + .side { border-top: 1px solid var(--border); }
  .files { min-height: 0; overflow: auto; }

  h3 {
    position: sticky;
    top: 0;
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 0;
    padding: 6px 12px;
    background: var(--bg-sunken);
    border-bottom: 1px solid var(--border);
    font-size: 11.5px;
    font-weight: 500;
  }
  .faint { color: var(--text-faint); font-weight: 400; }
  .empty { margin: 10px 12px; color: var(--text-faint); font-size: 11.5px; }

  ul { margin: 0; padding: 0; list-style: none; }
  .commit, .file {
    display: flex;
    align-items: baseline;
    gap: 10px;
    width: 100%;
    padding: 3px 12px;
    background: none;
    border: 0;
    color: var(--text);
    font-size: 12px;
    text-align: left;
  }
  .commit:hover, .file:hover { background: var(--bg-hover); }
  .hash { flex: none; color: var(--accent); font-size: 11px; }
  .subject { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .who { flex: none; max-width: 30%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-dim); }
  .when { flex: none; color: var(--text-faint); font-size: 11px; }
  .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11.5px; }
  .from { color: var(--text-faint); font-size: 11px; }
  .stat { flex: none; font-family: var(--font-mono); font-size: 11px; font-variant-numeric: tabular-nums; }
  .stat.add { color: var(--success); }
  .stat.del { color: var(--danger); }
</style>
