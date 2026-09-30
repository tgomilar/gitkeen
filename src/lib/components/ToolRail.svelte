<script lang="ts">
  /**
   * The rail down the left edge, naming what the dock beside it can hold.
   *
   * Only one panel is open at a time, which is what IntelliJ IDEA does with
   * Project and Commit: they share the same space rather than competing for it.
   */
  import Icon from './Icon.svelte';
  import { githubStore } from '../state/github.svelte';
  import { consoleStore } from '../state/console.svelte';
  import type { IconName } from './Icon.svelte';

  export type DockPanel = 'branches' | 'commit' | 'stats' | 'undo' | 'github';

  interface Props {
    active: DockPanel;
    /**
     * Shown on the Commit button, so pending work is visible from anywhere.
     * Tracked changes only: unversioned files are not in the next commit by
     * default, and counting them would overstate what is waiting.
     */
    changeCount: number;
    onselect: (panel: DockPanel) => void;
  }

  let { active, changeCount, onselect }: Props = $props();

  // GitHub joins the rail only for a repository that has a remote there.
  const items = $derived<{ id: DockPanel; label: string; icon: IconName; hint: string }[]>([
    { id: 'branches', label: 'Branches', icon: 'branch', hint: 'Branches, remotes and tags' },
    { id: 'commit', label: 'Commit', icon: 'commit', hint: 'Changed and unversioned files' },
    { id: 'stats', label: 'Stats', icon: 'stats', hint: 'Who committed what, and when' },
    { id: 'undo', label: 'Undo', icon: 'rollback', hint: 'Operations that changed history, and the way back' },
    ...(githubStore.onGithub
      ? [{ id: 'github' as const, label: 'GitHub', icon: 'pull-request' as const, hint: 'Pull requests and checks on GitHub' }]
      : [])
  ]);
</script>

<nav class="rail" aria-label="Tool panels">
  <!-- The mark from brand/icon.svg: a lowercase "g" drawn as a branch that forks and merges back. -->
  <div class="mark" title="Gitkeen">
    <svg viewBox="0 0.68 88.51 88.51" width="30" height="30" role="img" aria-label="Gitkeen">
      <rect x="0" y="0.68" width="88.51" height="88.51" rx="19.87" fill="var(--logo-tile)" />
      <g transform="translate(12.80 11.52) scale(1.9658)" fill="none" stroke-width="2.2">
        <path d="M24 4 H16 a7 7 0 0 0 0 14 H24" stroke="var(--logo-ink)" />
        <path d="M24 4 V25 a5 5 0 0 1 -5 5 H10" stroke="var(--logo-red)" />
      </g>
      <path fill="var(--logo-blue)" transform="translate(59.98 19.38) scale(0.7000) translate(-170.42 -8.53)" d="M170.379 16.281c-4.961 0-7.832-2.87-7.832-7.836 0-4.957 2.871-7.656 7.832-7.656 5.05 0 7.922 2.7 7.922 7.656 0 4.965-2.871 7.836-7.922 7.836Z" />
      <path fill="var(--logo-red)" transform="translate(30.49 33.14) scale(0.7000) translate(-170.42 -8.53)" d="M170.379 16.281c-4.961 0-7.832-2.87-7.832-7.836 0-4.957 2.871-7.656 7.832-7.656 5.05 0 7.922 2.7 7.922 7.656 0 4.965-2.871 7.836-7.922 7.836Z" />
      <path fill="var(--logo-blue)" transform="translate(28.53 70.49) scale(0.7000) translate(-170.42 -8.53)" d="M170.379 16.281c-4.961 0-7.832-2.87-7.832-7.836 0-4.957 2.871-7.656 7.832-7.656 5.05 0 7.922 2.7 7.922 7.656 0 4.965-2.871 7.836-7.922 7.836Z" />
    </svg>
  </div>
  {#each items as item (item.id)}
    <button
      class="item"
      class:active={active === item.id}
      onclick={() => onselect(item.id)}
      aria-pressed={active === item.id}
      title={item.hint}
    >
      <span class="glyph">
        <Icon name={item.icon} size={17} />
        {#if item.id === 'commit' && changeCount > 0}
          <span class="badge" aria-hidden="true">{changeCount > 99 ? '99+' : changeCount}</span>
        {/if}
      </span>
      <span class="label">{item.label}</span>
    </button>
    {#if item.id === 'undo'}
      <!-- The console opens along the bottom, beside whichever panel is docked, so it toggles on its own. -->
      <button
        class="item"
        class:active={consoleStore.open}
        onclick={() => consoleStore.toggle()}
        aria-pressed={consoleStore.open}
        title="Git console, with suggestions as you type (Ctrl+`)"
      >
        <span class="glyph"><Icon name="console" size={17} /></span>
        <span class="label">Console</span>
      </button>
    {/if}
  {/each}
</nav>

<style>
  .rail {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 56px;
    padding: 6px 4px;
    background: var(--bg-app);
    border-right: 1px solid var(--border);
  }

  .mark {
    display: flex;
    justify-content: center;
    padding: 6px 0 10px;
    margin-bottom: 2px;
    border-bottom: 1px solid var(--border);
  }

  .item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 7px 2px 6px;
    background: none;
    border: 0;
    border-radius: var(--radius-md);
    color: var(--text-dim);
  }
  .item:hover { background: var(--bg-hover); color: var(--text); }

  .item.active {
    background: var(--accent-subtle);
    color: var(--accent);
  }

  .glyph { position: relative; display: flex; }

  .badge {
    position: absolute;
    top: -5px;
    left: 10px;
    min-width: 14px;
    padding: 0 3px;
    border-radius: 7px;
    background: var(--accent);
    color: var(--accent-text);
    font-size: 9px;
    font-weight: 600;
    line-height: 13px;
    text-align: center;
  }

  .label {
    font-size: 10px;
    letter-spacing: 0.01em;
    line-height: 1.2;
  }
</style>
