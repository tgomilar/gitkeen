<script lang="ts">
  /**
   * The blame viewer, over the whole window like the diff viewer.
   *
   * Lines are grouped by the commit that last changed them. The first line of
   * each group names the commit: its hash, author and date. Clicking the hash
   * selects that commit in the graph, and "Before this" opens the file as it
   * was just before that commit, to follow a line further back.
   */
  import { blameStore } from '../state/blame.svelte';
  import { repoStore } from '../state/repo.svelte';
  import { diffStore } from '../state/diff.svelte';
  import { relativeTime, absoluteTime, authorColor } from '../format';
  import type { BlameLine } from '../git/types';

  const ZERO = '0'.repeat(40);

  const request = $derived(blameStore.request);
  const result = $derived(blameStore.result);

  /** Consecutive lines from the same commit, drawn as one block. */
  const groups = $derived.by(() => {
    const out: { hash: string; lines: BlameLine[] }[] = [];
    for (const line of result?.lines ?? []) {
      const last = out.at(-1);
      if (last && last.hash === line.hash) last.lines.push(line);
      else out.push({ hash: line.hash, lines: [line] });
    }
    return out;
  });

  const commitCount = $derived(Object.keys(result?.commits ?? {}).length);

  function reveal(hash: string) {
    if (hash === ZERO) return;
    repoStore.select(hash, 'replace');
    repoStore.loadDetails(hash);
    blameStore.close();
    diffStore.close();
  }

  function onkeydown(event: KeyboardEvent) {
    if (!blameStore.open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      blameStore.close();
    }
  }

  function autofocus(node: HTMLElement) {
    node.focus();
  }
</script>

<svelte:window on:keydown={onkeydown} />

{#if request}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="scrim" role="dialog" aria-modal="true" aria-label="Blame of {request.file}" tabindex="-1" use:autofocus>
    <div class="panel">
      <header>
        <div class="titles">
          <div class="path" title={request.file}>
            <span class="badge">Blame</span>
            <bdi dir="ltr">{request.file}</bdi>
          </div>
          <div class="sub">
            <span>{request.rev ? `as of ${request.rev.slice(0, 7)}` : 'the working tree'}</span>
            {#if result}
              <span>{result.lines.length.toLocaleString()} lines from {commitCount.toLocaleString()} {commitCount === 1 ? 'commit' : 'commits'}</span>
            {/if}
          </div>
        </div>
        <div class="tools">
          {#if blameStore.trail.length > 0}
            <button class="tool" onclick={() => blameStore.back()} title="Back to the newer version">← Back</button>
          {/if}
          <button class="close" onclick={() => blameStore.close()} title="Close (Escape)" aria-label="Close">×</button>
        </div>
      </header>

      <div class="body">
        {#if blameStore.loading && !result}
          <p class="notice">Reading who changed what…</p>
        {:else if blameStore.error}
          <p class="notice bad">{blameStore.error}</p>
        {:else if result && result.lines.length === 0}
          <p class="notice">The file is empty.</p>
        {:else if result}
          <div class="lines" class:stale={blameStore.loading}>
            {#each groups as group, g (g)}
              {@const info = result.commits[group.hash]}
              {@const uncommitted = group.hash === ZERO}
              <div class="group" style="--who: {uncommitted ? 'var(--text-faint)' : authorColor(info?.email ?? '')}">
                {#each group.lines as line, n (line.line)}
                  <div class="row">
                    <div class="who">
                      {#if n === 0}
                        {#if uncommitted}
                          <span class="pending">Not committed yet</span>
                        {:else}
                          <button class="hash" onclick={() => reveal(group.hash)} title="{info?.summary}&#10;&#10;Select this commit in the graph">{group.hash.slice(0, 7)}</button>
                          <span class="author" title={info?.email}>{info?.author}</span>
                          <span class="when" title={info ? absoluteTime(info.time) : ''}>{info ? relativeTime(info.time) : ''}</span>
                          {#if info?.previous}
                            {@const previous = info.previous}
                            <button class="before" onclick={() => blameStore.before(previous.hash, previous.file)}
                              title="Open the file as it was just before this commit">Before this</button>
                          {/if}
                        {/if}
                      {:else if n === 1 && !uncommitted}
                        <span class="summary" title={info?.summary}>{info?.summary}</span>
                      {/if}
                    </div>
                    <span class="num">{line.line}</span>
                    <span class="text">{line.text}</span>
                  </div>
                {/each}
              </div>
            {/each}
            {#if result.truncated}
              <p class="notice faint">The file is too long to blame in full, so only its beginning is shown.</p>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
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
  .path {
    display: flex;
    align-items: center;
    gap: 7px;
    overflow: hidden;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 12.5px;
  }
  .badge {
    padding: 0 6px;
    border-radius: var(--radius-sm);
    background: var(--ref-local-bg);
    color: var(--ref-local-text);
    font-family: var(--font-ui);
    font-size: 10.5px;
    line-height: 16px;
    font-weight: 600;
  }
  .sub { display: flex; gap: 10px; margin-top: 2px; color: var(--text-faint); font-size: 11.5px; }

  .tools { flex: none; display: flex; align-items: center; gap: 8px; }
  .tool {
    padding: 3px 10px;
    background: var(--bg-panel);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    font-size: 11.5px;
  }
  .tool:hover { color: var(--text); }
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

  .body { flex: 1; overflow: auto; }
  .notice { margin: 24px; color: var(--text-dim); }
  .notice.bad { color: var(--danger); font-family: var(--font-mono); font-size: 12px; }
  .notice.faint { color: var(--text-faint); }

  .lines { font-family: var(--font-mono); font-size: 12px; line-height: 18px; }
  .lines.stale { opacity: 0.6; }

  .group { border-top: 1px solid var(--border); content-visibility: auto; contain-intrinsic-size: auto 36px; }
  .group:first-child { border-top: 0; }

  .row { display: grid; grid-template-columns: 300px 48px 1fr; }
  .row:hover { background: var(--bg-hover); }

  .who {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
    padding: 0 10px 0 8px;
    border-left: 3px solid var(--who);
    background: var(--bg-sunken);
    font-family: var(--font-ui);
    font-size: 11.5px;
    white-space: nowrap;
    overflow: hidden;
  }
  .hash {
    padding: 0;
    background: none;
    border: 0;
    color: var(--accent);
    font-family: var(--font-mono);
    font-size: 11px;
  }
  .hash:hover { text-decoration: underline; }
  .author { overflow: hidden; text-overflow: ellipsis; }
  .when { margin-left: auto; color: var(--text-faint); }
  .summary { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--text-dim); }
  .pending { color: var(--text-faint); font-style: italic; }
  .before {
    flex: none;
    padding: 0;
    background: none;
    border: 0;
    color: var(--text-faint);
    font-size: 11px;
  }
  .before:hover { color: var(--accent); text-decoration: underline; }

  .num { padding-right: 8px; color: var(--text-faint); text-align: right; user-select: none; }
  .text { padding-right: 10px; white-space: pre; }
</style>
