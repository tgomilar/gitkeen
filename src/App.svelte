<script lang="ts">
  import TitleBar from './lib/components/TitleBar.svelte';
  import BranchSidebar from './lib/components/BranchSidebar.svelte';
  import ToolRail from './lib/components/ToolRail.svelte';
  import type { DockPanel } from './lib/components/ToolRail.svelte';
  import CommitPanel from './lib/components/CommitPanel.svelte';
  import GraphView from './lib/components/GraphView.svelte';
  import CommitDetails from './lib/components/CommitDetails.svelte';
  import StatusBar from './lib/components/StatusBar.svelte';
  import Welcome from './lib/components/Welcome.svelte';
  import Dialog from './lib/components/Dialog.svelte';
  import Toasts from './lib/components/Toasts.svelte';
  import ContextMenu from './lib/components/ContextMenu.svelte';
  import DiffViewer from './lib/components/DiffViewer.svelte';
  import { tick } from 'svelte';
  import { repoStore } from './lib/state/repo.svelte';
  import { commitStore } from './lib/state/commit.svelte';
  import { diffStore } from './lib/state/diff.svelte';
  import { commitMenuItems, createBranchFrom } from './lib/actions';
  import type { MenuItem } from './lib/menu';

  const THEME_KEY = 'gitalia.theme';
  const SIDEBAR_KEY = 'gitalia.sidebar-width';
  const DETAILS_KEY = 'gitalia.details-height';
  const DOCK_KEY = 'gitalia.dock';

  let theme = $state<'light' | 'dark'>(
    (localStorage.getItem(THEME_KEY) as 'light' | 'dark' | null) ?? 'dark'
  );
  let sidebarWidth = $state(Number(localStorage.getItem(SIDEBAR_KEY)) || 230);
  let detailsHeight = $state(Number(localStorage.getItem(DETAILS_KEY)) || 240);
  let dock = $state<DockPanel>(
    (localStorage.getItem(DOCK_KEY) as DockPanel | null) ?? 'branches'
  );

  let titleBar = $state<ReturnType<typeof TitleBar> | null>(null);
  let graphView = $state<ReturnType<typeof GraphView> | null>(null);
  let commitPanel = $state<ReturnType<typeof CommitPanel> | null>(null);
  let keyboardMenu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);

  $effect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  });

  $effect(() => {
    localStorage.setItem(DOCK_KEY, dock);
  });

  // Keep the cursor visible whenever it moves for any reason.
  $effect(() => {
    repoStore.cursor;
    graphView?.revealCursor();
  });

  // A commit message and its ticked files belong to one repository, so they
  // go when it does. Done here rather than inside the store, which would put
  // an import cycle between the two stores.
  let dockedRoot: string | null = null;
  $effect(() => {
    const root = repoStore.info?.root ?? null;
    if (root === dockedRoot) return;
    dockedRoot = root;
    commitStore.reset();
  });

  function toggleTheme() {
    theme = theme === 'dark' ? 'light' : 'dark';
  }

  /** Drag a divider, persisting the result. */
  function resizer(node: HTMLElement, options: { axis: 'x' | 'y'; apply: (delta: number) => void; commit: () => void }) {
    let start = 0;
    function down(event: PointerEvent) {
      event.preventDefault();
      start = options.axis === 'x' ? event.clientX : event.clientY;
      node.setPointerCapture(event.pointerId);
      node.addEventListener('pointermove', move);
      node.addEventListener('pointerup', up, { once: true });
      document.body.style.cursor = options.axis === 'x' ? 'col-resize' : 'row-resize';
    }
    function move(event: PointerEvent) {
      const current = options.axis === 'x' ? event.clientX : event.clientY;
      options.apply(current - start);
      start = current;
    }
    function up() {
      node.removeEventListener('pointermove', move);
      document.body.style.cursor = '';
      options.commit();
    }
    node.addEventListener('pointerdown', down);
    return { destroy: () => node.removeEventListener('pointerdown', down) };
  }

  function isTyping(target: EventTarget | null) {
    const el = target as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  }

  /** Open the commit context menu from the keyboard, at the app's centre. */
  function openCursorMenu() {
    const hash = repoStore.cursor;
    if (!hash) return;
    const commit = repoStore.commitByHash(hash);
    if (!commit) return;
    keyboardMenu = {
      x: Math.round(window.innerWidth / 2 - 100),
      y: Math.round(window.innerHeight / 2 - 120),
      items: commitMenuItems(commit, repoStore.selection)
    };
  }

  function onkeydown(event: KeyboardEvent) {
    const mod = event.metaKey || event.ctrlKey;
    const typing = isTyping(event.target);

    // With no repository open there is nothing to drive, so leave every
    // shortcut to the browser. Reload in particular must keep working here.
    if (!repoStore.repo) return;

    // The diff viewer covers the application, so while it is open it owns the
    // keyboard. Its own Escape handler closes it.
    if (diffStore.open) return;

    if (mod && !event.shiftKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      titleBar?.focusSearch();
      return;
    }
    if (mod && event.key.toLowerCase() === 'r') {
      event.preventDefault(); // a page reload would throw the repository away
      repoStore.refresh();
      return;
    }

    if (mod && event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      repoStore.fetch();
      return;
    }
    // ⌘K is taken by the graph search, so the commit box gets ⌘⇧K.
    if (mod && event.shiftKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      dock = 'commit';
      // The panel may not be mounted yet, so wait for the render it triggers.
      tick().then(() => commitPanel?.focusMessage());
      return;
    }
    if (mod && event.shiftKey && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      createBranchFrom(repoStore.cursor ?? undefined, repoStore.cursor ? 'the selected commit' : 'HEAD');
      return;
    }

    if (typing) {
      if (event.key === 'Escape') (event.target as HTMLElement).blur();
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        repoStore.moveCursor(1, event.shiftKey);
        break;
      case 'ArrowUp':
        event.preventDefault();
        repoStore.moveCursor(-1, event.shiftKey);
        break;
      case 'PageDown':
        event.preventDefault();
        repoStore.moveCursor(20, event.shiftKey);
        break;
      case 'PageUp':
        event.preventDefault();
        repoStore.moveCursor(-20, event.shiftKey);
        break;
      case 'Home':
        event.preventDefault();
        repoStore.moveCursor(-repoStore.visibleRows.length, event.shiftKey);
        break;
      case 'End':
        event.preventDefault();
        repoStore.moveCursor(repoStore.visibleRows.length, event.shiftKey);
        break;
      case 'Enter':
        event.preventDefault();
        openCursorMenu();
        break;
      case 'Escape':
        if (repoStore.filter) repoStore.filter = '';
        else if (repoStore.selection.length > 1 && repoStore.cursor) {
          repoStore.select(repoStore.cursor, 'replace');
        }
        break;
    }
  }
</script>

<svelte:window on:keydown={onkeydown} />

{#if !repoStore.repo}
  <Welcome />
{:else}
  <div class="app">
    <TitleBar bind:this={titleBar} onclose={() => repoStore.close()} {theme} ontheme={toggleTheme} />

    <div class="body">
      <ToolRail
        active={dock}
        changeCount={repoStore.dirtyFileCount}
        onselect={(panel) => (dock = panel)}
      />

      <div class="sidebar" style="width: {sidebarWidth}px">
        {#if dock === 'commit'}
          <CommitPanel bind:this={commitPanel} />
        {:else}
          <BranchSidebar />
        {/if}
      </div>

      <div
        class="divider vertical"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize side panel"
        use:resizer={{
          axis: 'x',
          apply: (d) => (sidebarWidth = Math.min(560, Math.max(190, sidebarWidth + d))),
          commit: () => localStorage.setItem(SIDEBAR_KEY, String(sidebarWidth))
        }}
      ></div>

      <main class="main">
        <div class="graph"><GraphView bind:this={graphView} /></div>

        <div
          class="divider horizontal"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize commit details"
          use:resizer={{
            axis: 'y',
            apply: (d) => (detailsHeight = Math.min(620, Math.max(120, detailsHeight - d))),
            commit: () => localStorage.setItem(DETAILS_KEY, String(detailsHeight))
          }}
        ></div>

        <div class="details" style="height: {detailsHeight}px"><CommitDetails /></div>
      </main>
    </div>

    <StatusBar />
  </div>
{/if}

<DiffViewer />
<Dialog />
<Toasts />

{#if keyboardMenu}
  <ContextMenu
    x={keyboardMenu.x}
    y={keyboardMenu.y}
    items={keyboardMenu.items}
    onclose={() => (keyboardMenu = null)}
  />
{/if}


<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .body {
    flex: 1;
    display: flex;
    min-height: 0;
  }

  .sidebar { flex: none; min-width: 0; }

  .main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .graph { flex: 1; min-height: 0; }
  .details { flex: none; }

  .divider {
    flex: none;
    background: var(--border);
    transition: background 0.1s ease;
  }
  .divider:hover { background: var(--accent); }

  .divider.vertical {
    width: 1px;
    cursor: col-resize;
    border-left: 2px solid transparent;
    border-right: 2px solid transparent;
    background-clip: padding-box;
  }

  .divider.horizontal {
    height: 1px;
    cursor: row-resize;
    border-top: 2px solid transparent;
    border-bottom: 2px solid transparent;
    background-clip: padding-box;
  }
</style>
