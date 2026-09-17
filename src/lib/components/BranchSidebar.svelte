<script lang="ts">
  import BranchNode from './BranchNode.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import Icon from './Icon.svelte';
  import type { IconName } from './Icon.svelte';
  import { repoStore } from '../state/repo.svelte';
  import { buildBranchTree } from '../branchTree';
  import { branchMenuItems, switchToBranch, checkoutRemoteBranch, createBranchFrom } from '../actions';
  import type { Branch } from '../git/types';
  import type { MenuItem } from '../menu';

  let query = $state('');
  // Reassigned rather than mutated, so Svelte sees the change.
  let collapsed = $state<Set<string>>(new Set());
  let sectionsClosed = $state<Set<string>>(new Set());
  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);

  function matches(branch: Branch) {
    const q = query.trim().toLowerCase();
    return !q || branch.name.toLowerCase().includes(q);
  }

  const local = $derived(repoStore.branches.local.filter(matches));
  const remote = $derived(repoStore.branches.remote.filter(matches));
  const tags = $derived(repoStore.branches.tags.filter(matches));

  const sections = $derived([
    {
      key: 'local', title: 'Local', kind: 'local' as const, icon: 'local' as IconName,
      tree: buildBranchTree(local), total: local.length
    },
    {
      key: 'remote', title: 'Remote', kind: 'remote' as const, icon: 'remote' as IconName,
      tree: buildBranchTree(remote), total: remote.length
    },
    {
      key: 'tags', title: 'Tags', kind: 'tag' as const, icon: 'tag' as IconName,
      tree: buildBranchTree(tags), total: tags.length
    }
  ]);

  function toggleNode(path: string) {
    const next = new Set(collapsed);
    if (next.has(path)) next.delete(path); else next.add(path);
    collapsed = next;
  }

  function toggleSection(key: string) {
    const next = new Set(sectionsClosed);
    if (next.has(key)) next.delete(key); else next.add(key);
    sectionsClosed = next;
  }

  /**
   * A single click narrows the commit list to that branch. It changes nothing
   * in Git, so it is safe as the plain-click action.
   */
  function selectBranch(branch: Branch, kind: 'local' | 'remote' | 'tag') {
    repoStore.setScope({ ref: branch.name, kind });
  }

  function activate(branch: Branch, kind: 'local' | 'remote' | 'tag') {
    if (kind === 'local') switchToBranch(branch.name);
    else if (kind === 'remote') checkoutRemoteBranch(branch);
    else createBranchFrom(branch.name, `tag ${branch.name}`);
  }

  function openMenu(branch: Branch, kind: 'local' | 'remote' | 'tag', event: MouseEvent) {
    event.preventDefault();
    menu = { x: event.clientX, y: event.clientY, items: branchMenuItems(branch, kind) };
  }

  const head = $derived(repoStore.head);

  /** The branch object for HEAD, when HEAD is on a branch. */
  const headBranch = $derived(
    repoStore.branches.local.find((b) => b.name === repoStore.currentBranch) ?? null
  );

  /** The ref this section holds that the commit list is narrowed to, if any. */
  function selectedRef(kind: 'local' | 'remote' | 'tag') {
    const scope = repoStore.scope;
    return scope && scope.kind === kind ? scope.ref : null;
  }

  /** Show the current branch's commits, and jump to the commit HEAD is at. */
  async function selectHead() {
    const branch = repoStore.currentBranch;
    if (branch) await repoStore.setScope({ ref: branch, kind: 'local' });
    const oid = head?.oid;
    if (oid && repoStore.layout.index.has(oid)) repoStore.select(oid, 'replace');
  }

  function openHeadMenu(event: MouseEvent) {
    event.preventDefault();
    if (!headBranch) return;
    menu = { x: event.clientX, y: event.clientY, items: branchMenuItems(headBranch, 'local') };
  }
</script>

<aside class="sidebar">
  <div class="search">
    <input
      bind:value={query}
      placeholder="Filter branches"
      spellcheck="false"
      autocomplete="off"
      aria-label="Filter branches"
    />
    {#if query}
      <button class="clear" onclick={() => (query = '')} aria-label="Clear filter">×</button>
    {/if}
  </div>

  <div class="scroll">
    <!-- HEAD stays pinned at the top, so the branch you are on is never
         somewhere down a long list. -->
    <section class="head-section">
      <div class="section-head static">
        <Icon name="head" size={12} />
        <span class="section-title">HEAD (current branch)</span>
      </div>
      <button
        class="node branch current"
        class:detached={head?.detached}
        class:selected={!!repoStore.currentBranch && selectedRef('local') === repoStore.currentBranch}
        onclick={selectHead}
        oncontextmenu={openHeadMenu}
        title={head?.detached ? `Detached at ${head.oid}` : (repoStore.currentBranch ?? '')}
      >
        <span class="glyph current" aria-hidden="true"><Icon name="branch" /></span>
        <span class="name">
          {#if head?.detached}
            <span class="mono">detached at {head.oid?.slice(0, 7)}</span>
          {:else}
            {repoStore.currentBranch ?? '—'}
          {/if}
        </span>
        {#if headBranch && (headBranch.ahead > 0 || headBranch.behind > 0)}
          <span class="track" title="{headBranch.ahead} ahead, {headBranch.behind} behind {headBranch.upstream}">
            {#if headBranch.ahead > 0}<span class="ahead">↑{headBranch.ahead}</span>{/if}
            {#if headBranch.behind > 0}<span class="behind">↓{headBranch.behind}</span>{/if}
          </span>
        {:else if headBranch && !headBranch.upstream}
          <span class="untracked" title="No upstream branch">local</span>
        {/if}
      </button>
    </section>

    {#each sections as section (section.key)}
      <section>
        <button class="section-head" onclick={() => toggleSection(section.key)}
                aria-expanded={!sectionsClosed.has(section.key)}>
          <span class="chevron" class:open={!sectionsClosed.has(section.key)} aria-hidden="true">›</span>
          <Icon name={section.icon} size={12} />
          <span class="section-title">{section.title}</span>
          <span class="section-count">{section.total}</span>
        </button>

        {#if !sectionsClosed.has(section.key)}
          {#if section.tree.length === 0}
            <p class="none">{query ? 'No match' : 'None'}</p>
          {:else}
            {#each section.tree as node (node.path + (node.branch ? ':b' : ''))}
              <BranchNode
                {node}
                depth={0}
                kind={section.kind}
                {collapsed}
                currentBranch={repoStore.currentBranch}
                selectedRef={selectedRef(section.kind)}
                ontoggle={toggleNode}
                onselect={(b) => selectBranch(b, section.kind)}
                onactivate={(b) => activate(b, section.kind)}
                onmenu={(b, e) => openMenu(b, section.kind, e)}
              />
            {/each}
          {/if}
        {/if}
      </section>
    {/each}
  </div>

  <p class="hint">Click a branch to see its commits. Double-click to switch.</p>
</aside>

{#if menu}
  <ContextMenu x={menu.x} y={menu.y} items={menu.items} onclose={() => (menu = null)} />
{/if}

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    background: var(--bg-panel);
    border-right: 1px solid var(--border);
  }

  .search {
    position: relative;
    padding: 6px;
    border-bottom: 1px solid var(--border);
  }

  .search input {
    width: 100%;
    padding: 4px 22px 4px 8px;
    background: var(--bg-sunken);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    font-size: 12px;
  }
  .search input:focus { border-color: var(--accent); outline: none; background: var(--bg-panel); }

  .clear {
    position: absolute;
    right: 10px;
    top: 50%;
    transform: translateY(-50%);
    padding: 0 3px;
    background: none;
    border: 0;
    color: var(--text-faint);
    font-size: 14px;
  }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding-bottom: 8px;
  }

  .section-head {
    display: flex;
    align-items: center;
    gap: 5px;
    width: 100%;
    height: 24px;
    padding: 0 8px 0 4px;
    margin-top: 4px;
    background: none;
    border: 0;
    color: var(--text-faint);
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.055em;
  }
  .section-head:hover { color: var(--text-dim); }

  .section-title { flex: 1; text-align: left; }
  .section-count { font-variant-numeric: tabular-nums; }

  .chevron {
    display: inline-block;
    width: 10px;
    transition: transform 0.1s ease;
  }
  .chevron.open { transform: rotate(90deg); }

  .head-section {
    padding-bottom: 6px;
    margin-bottom: 2px;
    border-bottom: 1px solid var(--border);
  }

  .section-head.static {
    display: flex;
    align-items: center;
    height: 24px;
    padding: 0 8px 0 8px;
    margin-top: 4px;
    color: var(--text-faint);
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.055em;
  }

  /* Matches the rows rendered by BranchNode, which has its own styles. */
  .node {
    display: flex;
    align-items: center;
    gap: 5px;
    width: 100%;
    height: 22px;
    padding: 0 8px 0 6px;
    background: none;
    border: 0;
    text-align: left;
    white-space: nowrap;
  }
  .node:hover { background: var(--bg-hover); }

  .node .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 12.5px;
    font-weight: 600;
  }

  .node.detached .name { color: var(--warning); font-weight: 500; }

  .node.current { background: var(--accent-subtle); }
  .node.selected { background: var(--bg-selected); }
  .node.selected:hover { background: var(--bg-selected); }

  .glyph {
    flex: none;
    display: flex;
    color: var(--text-faint);
  }
  .glyph.current { color: var(--success); }

  .track { display: flex; gap: 4px; font-family: var(--font-mono); font-size: 10.5px; }
  .ahead { color: var(--success); }
  .behind { color: var(--warning); }

  .untracked {
    color: var(--text-faint);
    font-size: 10px;
    letter-spacing: 0.03em;
  }

  .none {
    margin: 0;
    padding: 2px 0 2px 20px;
    color: var(--text-faint);
    font-size: 11.5px;
  }

  .hint {
    margin: 0;
    padding: 6px 8px;
    border-top: 1px solid var(--border);
    color: var(--text-faint);
    font-size: 10.5px;
    line-height: 1.35;
  }
</style>
