<script lang="ts">
  /**
   * The GitHub tool window: the repository's pull requests, their checks,
   * and a pull request for the current branch.
   */
  import Icon from './Icon.svelte';
  import ChecksDot from './ChecksDot.svelte';
  import { githubStore } from '../state/github.svelte';
  import { repoStore } from '../state/repo.svelte';
  import { settingsStore } from '../state/settings.svelte';
  import { relativeTime, absoluteTime } from '../format';

  const status = $derived(githubStore.status);
  const branch = $derived(repoStore.currentBranch);
  /** The open pull request of the branch that is checked out, if there is one. */
  const mine = $derived(githubStore.pulls.find((p) => p.state === 'open' && p.head === branch && p.headRepo === `${status?.repo?.owner}/${status?.repo?.name}`));

  $effect(() => {
    if (githubStore.connected) githubStore.loadPulls();
  });

  const open = (url: string) => window.open(url, '_blank', 'noopener');
</script>

<section class="panel">
  <div class="toolbar">
    <button class="tool" onclick={() => githubStore.loadPulls()} disabled={githubStore.loadingPulls || !githubStore.connected}
      title="Read the pull requests again" aria-label="Refresh the pull requests">
      <Icon name="refresh" size={14} />
    </button>
    <span class="title">GitHub</span>
  </div>

  <div class="scroll">
    {#if !status?.repo}
      <p class="note">This repository has no remote on github.com.</p>
    {:else if !status.connected}
      <p class="repo"><b>{status.repo.owner}/{status.repo.name}</b></p>
      <p class="note">
        {status.error ?? 'Gitalia has no GitHub token.'} Add a token in
        <button class="link" onclick={() => settingsStore.show()}>Settings</button>, set
        <code>GITHUB_TOKEN</code>, or sign in with the GitHub CLI (<code>gh auth login</code>).
      </p>
    {:else}
      <p class="repo">
        <button class="link strong" onclick={() => open(`https://github.com/${status.repo?.owner}/${status.repo?.name}`)}>{status.repo.owner}/{status.repo.name}</button>
        <span class="faint">as {status.login ?? 'unknown'}</span>
      </p>

      <div class="mine">
        {#if mine}
          <p class="note">{branch} has pull request <button class="link" onclick={() => open(mine.url)}>#{mine.number}</button>.</p>
        {:else if branch && branch !== status.defaultBranch}
          <button class="primary" onclick={() => githubStore.createForCurrentBranch()} disabled={githubStore.busy}>
            New pull request for {branch}…
          </button>
        {/if}
      </div>

      <div class="states" role="group" aria-label="Which pull requests">
        {#each ['open', 'closed', 'all'] as const as s (s)}
          <button class:on={githubStore.pullState === s} aria-pressed={githubStore.pullState === s} onclick={() => githubStore.loadPulls(s)}>
            {s[0].toUpperCase() + s.slice(1)}
          </button>
        {/each}
      </div>

      {#if githubStore.pullsError}
        <p class="bad">{githubStore.pullsError}</p>
      {:else if githubStore.pulls.length === 0 && !githubStore.loadingPulls}
        <p class="note">No {githubStore.pullState === 'all' ? '' : githubStore.pullState + ' '}pull requests.</p>
      {/if}

      <ul class="pulls">
        {#each githubStore.pulls as pr (pr.number)}
          <li>
            <button class="pull" onclick={() => open(pr.url)} title="Open #{pr.number} on GitHub">
              <span class="line1">
                <ChecksDot sha={pr.headSha} />
                <span class="pr-title">{pr.title}</span>
              </span>
              <span class="line2">
                <span class="num">#{pr.number}</span>
                <span class="badge {pr.draft ? 'draft' : pr.state}">{pr.draft ? 'draft' : pr.state}</span>
                <span class="mono">{pr.head} → {pr.base}</span>
              </span>
              <span class="line2 faint">
                {pr.author}{pr.updated ? ' · ' : ''}<span title={pr.updated ? absoluteTime(pr.updated) : ''}>{pr.updated ? relativeTime(pr.updated) : ''}</span>{pr.comments ? ` · ${pr.comments} comments` : ''}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>

<style>
  .panel { display: flex; flex-direction: column; min-height: 0; height: 100%; background: var(--bg-panel); border-right: 1px solid var(--border); }
  .toolbar { display: flex; align-items: center; gap: 6px; height: 30px; padding: 0 6px; border-bottom: 1px solid var(--border); }
  .tool { display: flex; align-items: center; justify-content: center; width: 24px; height: 22px; padding: 0; background: none; border: 0; border-radius: var(--radius-sm); color: var(--text-dim); }
  .tool:hover:not(:disabled) { background: var(--bg-hover); color: var(--text); }
  .title { flex: 1; font-size: 12.5px; font-weight: 600; }
  .scroll { flex: 1; overflow: auto; padding: 8px 10px 12px; }
  .repo { display: flex; align-items: baseline; gap: 6px; margin: 0 0 8px; font-size: 12px; flex-wrap: wrap; }
  .note { margin: 0 0 8px; color: var(--text-dim); font-size: 11.5px; line-height: 1.5; }
  .bad { color: var(--danger); font-size: 11.5px; }
  .faint { color: var(--text-faint); }
  code, .mono { font-family: var(--font-mono); font-size: 10.5px; }
  .link { padding: 0; background: none; border: 0; color: var(--accent); font: inherit; cursor: pointer; }
  .link:hover { text-decoration: underline; }
  .link.strong { font-weight: 600; }
  .mine { margin-bottom: 10px; }
  .primary { width: 100%; padding: 5px 10px; background: var(--accent); border: 1px solid var(--accent); border-radius: var(--radius-sm); color: var(--accent-text); font-size: 12px; }
  .primary:hover:not(:disabled) { background: var(--accent-hover); }
  .primary:disabled { opacity: 0.6; }
  .states { display: flex; margin-bottom: 6px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); overflow: hidden; }
  .states button { flex: 1; padding: 3px 0; background: var(--bg-panel); border: 0; color: var(--text-dim); font-size: 11.5px; }
  .states button + button { border-left: 1px solid var(--border-strong); }
  .states button.on { background: var(--accent); color: var(--accent-text); }
  .pulls { margin: 0; padding: 0; list-style: none; }
  .pull { display: flex; flex-direction: column; gap: 2px; width: 100%; padding: 7px 4px; background: none; border: 0; border-top: 1px solid var(--border); color: var(--text); text-align: left; }
  .pull:hover { background: var(--bg-hover); }
  .line1 { display: flex; align-items: center; gap: 6px; font-size: 12px; }
  .pr-title { overflow-wrap: anywhere; }
  .line2 { display: flex; align-items: baseline; gap: 6px; font-size: 11px; flex-wrap: wrap; }
  .num { color: var(--text-dim); }
  .badge { padding: 0 5px; border-radius: 999px; font-size: 10px; }
  .badge.open { background: var(--success-subtle); color: var(--success); }
  .badge.merged { background: var(--ref-remote-bg); color: var(--ref-remote-text); }
  .badge.closed { background: var(--danger-subtle); color: var(--danger); }
  .badge.draft { background: var(--bg-sunken); color: var(--text-dim); }
</style>
