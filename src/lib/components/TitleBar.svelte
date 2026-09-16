<script lang="ts">
  import { repoStore } from '../state/repo.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import { branchMenuItems, createBranchFrom, switchToBranch } from '../actions';
  import type { MenuItem } from '../menu';

  interface Props {
    onclose: () => void;
    theme: 'light' | 'dark';
    ontheme: () => void;
  }

  let { onclose, theme, ontheme }: Props = $props();

  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
  let search = $state<HTMLInputElement | null>(null);

  export function focusSearch() {
    search?.focus();
    search?.select();
  }

  const head = $derived(repoStore.head);
  const status = $derived(repoStore.status);

  function openBranchMenu(event: MouseEvent) {
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const current = repoStore.branches.local.find((b) => b.name === repoStore.currentBranch);

    const others = repoStore.branches.local
      .filter((b) => b.name !== repoStore.currentBranch)
      .slice(0, 12)
      .map<MenuItem>((b) => ({ label: `Switch to ${b.name}`, action: () => switchToBranch(b.name) }));

    const items: MenuItem[] = current
      ? [...branchMenuItems(current, 'local'), { separator: true }, ...others]
      : [
          { label: 'HEAD is detached', disabled: true },
          { separator: true },
          {
            label: 'Create branch here…',
            action: () => createBranchFrom(head?.oid ?? undefined, `the current HEAD (${head?.oid?.slice(0, 7)})`)
          },
          { separator: true },
          ...others
        ];

    menu = { x: rect.left, y: rect.bottom + 2, items };
  }

  function openRepoMenu(event: MouseEvent) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    menu = {
      x: rect.left,
      y: rect.bottom + 2,
      items: [
        { label: 'Refresh', hint: '⌘R', action: () => repoStore.refresh() },
        { label: 'Fetch all remotes', hint: '⌘⇧F', action: () => repoStore.fetch() },
        { separator: true },
        {
          label: 'Copy repository path',
          action: () => navigator.clipboard.writeText(repoStore.info?.root ?? '')
        },
        { separator: true },
        { label: 'Close repository', action: onclose }
      ]
    };
  }
</script>

<header class="bar">
  <button class="repo" onclick={openRepoMenu} title={repoStore.info?.root}>
    <span class="repo-name">{repoStore.info?.name}</span>
    <span class="caret" aria-hidden="true">▾</span>
  </button>

  <button class="branch" class:detached={head?.detached} onclick={openBranchMenu}>
    <span class="glyph" aria-hidden="true">⑂</span>
    <span class="branch-name">
      {head?.detached ? `detached at ${head.oid?.slice(0, 7)}` : (head?.branch ?? '—')}
    </span>
    {#if status && (status.ahead > 0 || status.behind > 0)}
      <span class="track">
        {#if status.ahead > 0}<span class="ahead">↑{status.ahead}</span>{/if}
        {#if status.behind > 0}<span class="behind">↓{status.behind}</span>{/if}
      </span>
    {/if}
    <span class="caret" aria-hidden="true">▾</span>
  </button>

  <div class="ops">
    <button class="op" onclick={() => repoStore.fetch()} disabled={!!repoStore.busy}>Fetch</button>
    <button class="op" onclick={() => repoStore.refresh()} disabled={!!repoStore.busy}>Refresh</button>
    <button
      class="op"
      onclick={() => createBranchFrom(repoStore.cursor ?? undefined, repoStore.cursor ? `the selected commit` : 'HEAD')}
    >New branch</button>
  </div>

  <div class="search">
    <input
      bind:this={search}
      bind:value={repoStore.filter}
      placeholder="Search commits"
      spellcheck="false"
      autocomplete="off"
      aria-label="Search commits"
    />
    {#if repoStore.filter}
      <button class="clear" onclick={() => (repoStore.filter = '')} aria-label="Clear search">×</button>
    {:else}
      <kbd>⌘K</kbd>
    {/if}
  </div>

  <button class="theme" onclick={ontheme} title="Switch theme" aria-label="Switch theme">
    {theme === 'dark' ? '◑' : '◐'}
  </button>
</header>

{#if menu}
  <ContextMenu x={menu.x} y={menu.y} items={menu.items} onclose={() => (menu = null)} />
{/if}

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 38px;
    padding: 0 8px;
    background: var(--bg-panel);
    border-bottom: 1px solid var(--border);
  }

  .repo, .branch {
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 260px;
    padding: 4px 7px;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
  }
  .repo:hover, .branch:hover { background: var(--bg-hover); border-color: var(--border); }

  .repo-name { font-weight: 600; }

  .branch-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .branch.detached .branch-name { color: var(--warning); font-family: var(--font-mono); font-size: 11.5px; }

  .glyph { color: var(--text-faint); }
  .caret { color: var(--text-faint); font-size: 9px; }

  .track { display: flex; gap: 3px; font-family: var(--font-mono); font-size: 10.5px; }
  .ahead { color: var(--success); }
  .behind { color: var(--warning); }

  .ops {
    display: flex;
    gap: 2px;
    margin-left: 4px;
  }

  .op {
    padding: 4px 9px;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--text-dim);
  }
  .op:hover:not(:disabled) { background: var(--bg-hover); color: var(--text); border-color: var(--border); }
  .op:disabled { opacity: 0.45; cursor: default; }

  .search {
    position: relative;
    margin-left: auto;
    width: 240px;
  }

  .search input {
    width: 100%;
    padding: 4px 30px 4px 8px;
    background: var(--bg-sunken);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    font-size: 12px;
  }
  .search input:focus { background: var(--bg-panel); border-color: var(--accent); outline: none; }

  kbd {
    position: absolute;
    right: 7px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: 10px;
    pointer-events: none;
  }

  .clear {
    position: absolute;
    right: 6px;
    top: 50%;
    transform: translateY(-50%);
    padding: 0 3px;
    background: none;
    border: 0;
    color: var(--text-faint);
    font-size: 14px;
  }

  .theme {
    padding: 3px 7px;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    font-size: 14px;
  }
  .theme:hover { background: var(--bg-hover); border-color: var(--border); }
</style>
