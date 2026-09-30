<script lang="ts">
  import TitleBar from './lib/components/TitleBar.svelte';
  import BranchSidebar from './lib/components/BranchSidebar.svelte';
  import ToolRail from './lib/components/ToolRail.svelte';
  import type { DockPanel } from './lib/components/ToolRail.svelte';
  import CommitPanel from './lib/components/CommitPanel.svelte';
  import StatsPanel from './lib/components/StatsPanel.svelte';
  import StatsReport from './lib/components/StatsReport.svelte';
  import GraphView from './lib/components/GraphView.svelte';
  import CommitDetails from './lib/components/CommitDetails.svelte';
  import StatusBar from './lib/components/StatusBar.svelte';
  import Welcome from './lib/components/Welcome.svelte';
  import Dialog from './lib/components/Dialog.svelte';
  import SettingsPanel from './lib/components/SettingsPanel.svelte';
  import RebaseEditor from './lib/components/RebaseEditor.svelte';
  import { settingsStore } from './lib/state/settings.svelte';
  import { rebaseStore } from './lib/state/rebase.svelte';
  import { mergeStore } from './lib/state/merge.svelte';
  import Toasts from './lib/components/Toasts.svelte';
  import ContextMenu from './lib/components/ContextMenu.svelte';
  import DiffViewer from './lib/components/DiffViewer.svelte';
  import MergeEditor from './lib/components/MergeEditor.svelte';
  import RecoveryPanel from './lib/components/RecoveryPanel.svelte';
  import GithubPanel from './lib/components/GithubPanel.svelte';
  import { githubStore } from './lib/state/github.svelte';
  import BlameViewer from './lib/components/BlameViewer.svelte';
  import CompareViewer from './lib/components/CompareViewer.svelte';
  import LfsPanel from './lib/components/LfsPanel.svelte';
  import ConsolePanel from './lib/components/ConsolePanel.svelte';
  import { consoleStore } from './lib/state/console.svelte';
  import { lfsStore } from './lib/state/lfs.svelte';
  import { appearance, uiScale } from './lib/state/appearance.svelte';
  import { compareStore } from './lib/state/compare.svelte';
  import { blameStore } from './lib/state/blame.svelte';
  import { tick } from 'svelte';
  import { repoStore } from './lib/state/repo.svelte';
  import { commitStore } from './lib/state/commit.svelte';
  import { diffStore } from './lib/state/diff.svelte';
  import { statsStore } from './lib/state/stats.svelte';
  import { commitMenuItems, createBranchFrom, pushBranch, pullBranch, revertCommits } from './lib/actions';
  import CommandPalette from './lib/components/CommandPalette.svelte';
  import { paletteStore } from './lib/state/palette.svelte';
  import { dialogs } from './lib/state/dialogs.svelte';
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
    // Whether an AI provider is there decides if Explain is offered anywhere.
    if (root) commitStore.loadSuggestProviders();
    // Whether it is on GitHub decides if the GitHub panel and checks appear.
    if (root) githubStore.loadStatus();
    // A report describes one repository, so it goes when that one does.
    statsStore.syncRepo(root);
    // Console history is kept per repository.
    consoleStore.syncRepo(root);
  });

  // `git commit` with no message in the console opens the commit box instead.
  $effect(() => {
    const focusCommit = () => {
      dock = 'commit';
      tick().then(() => commitPanel?.focusMessage());
    };
    window.addEventListener('gitalia:focus-commit', focusCommit);
    return () => window.removeEventListener('gitalia:focus-commit', focusCommit);
  });

  // Reading statistics costs a full pass over the log, so unlike the other
  // panels it is read on demand: when Stats is opened, and again whenever the
  // filters change. `ensure` reads the filters, so this effect re-runs when
  // they do and the report follows the form without a button to press.
  $effect(() => {
    if (dock === 'stats' && repoStore.repo) statsStore.ensure();
  });

  function toggleTheme() {
    theme = theme === 'dark' ? 'light' : 'dark';
  }

  // The palette drives things that live on this screen, so it is told how.
  // The assignment is one-way: the palette stays a store, not an outlet.
  paletteStore.bind({
    setDock: (panel) => (dock = panel),
    openCommit: () => {
      dock = 'commit';
      // The panel may not be mounted yet, so wait for the render it triggers.
      tick().then(() => commitPanel?.focusMessage());
    },
    focusSearch: () => titleBar?.focusSearch(),
    focusGraph: () => graphView?.focus(),
    toggleTheme
  });

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
      // The mouse moves in screen pixels; the panel sizes are the page's own.
      options.apply((current - start) / uiScale());
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

  /** True while a dialog, an editor or Settings sits over the application. */
  function overlaid() {
    return !!dialogs.current || rebaseStore.open || mergeStore.open || settingsStore.open || blameStore.open || compareStore.open || lfsStore.open;
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

    // Text size, as in an editor: ⌘+ and ⌘− step it, ⌘0 puts it back. They
    // work on the welcome screen too, so it can be read before anything opens.
    if (mod && !event.altKey && (event.key === '=' || event.key === '+')) {
      event.preventDefault();
      appearance.stepTextSize(1);
      return;
    }
    if (mod && !event.altKey && (event.key === '-' || event.key === '_')) {
      event.preventDefault();
      appearance.stepTextSize(-1);
      return;
    }
    if (mod && !event.altKey && event.key === '0') {
      event.preventDefault();
      appearance.setTextSize(1);
      return;
    }

    // With no repository open there is nothing to drive, so leave every
    // shortcut to the browser. Reload in particular must keep working here.
    if (!repoStore.repo) return;

    // The diff viewer covers the application, so while it is open it owns the
    // keyboard. Its own Escape handler closes it.
    if (diffStore.open || blameStore.open || compareStore.open) return;

    // The palette owns the keyboard while it is open, arrows and Escape
    // included. Everything below this point is for the graph and the bar.
    if (paletteStore.open) return;

    // Ctrl+` opens and closes the console, as in an editor. It works from the
    // console's own input too, so it can be closed without the mouse.
    if (event.ctrlKey && !event.metaKey && event.code === 'Backquote') {
      event.preventDefault();
      if (!overlaid()) consoleStore.toggle();
      return;
    }

    if (mod && !event.shiftKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      titleBar?.focusSearch();
      return;
    }
    if (mod && event.key.toLowerCase() === 'r') {
      event.preventDefault(); // a page reload would throw the repository away
      // Refresh what is actually on screen. The report is read separately
      // from the rest of the repository, so it needs asking for by name.
      if (dock === 'stats') statsStore.load();
      else repoStore.refresh();
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
    // ⌘⇧P is the command palette. It cannot stack on a question the app is
    // already waiting for, or on an editor the user is in the middle of, so
    // it stays quiet while a dialog, the rebase or merge editor, or Settings
    // is on screen.
    if (mod && event.shiftKey && event.key.toLowerCase() === 'p') {
      event.preventDefault();
      if (!overlaid()) paletteStore.show();
      return;
    }
    // ⌘B switches branch: the palette, already narrowed to the branches.
    if (mod && !event.shiftKey && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      if (!overlaid()) paletteStore.show('Switch to ');
      return;
    }
    // Push has a confirmation of its own, so the shortcut cannot send anything
    // on its own. Force push is deliberately left off the keyboard.
    if (mod && event.shiftKey && event.key.toLowerCase() === 'u') {
      event.preventDefault();
      pushBranch();
      return;
    }
    // Pull takes L: the palette owns ⌘⇧P and push has to make room for it.
    // It confirms before merging anything.
    if (mod && event.shiftKey && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      pullBranch();
      return;
    }

    if (typing) {
      if (event.key === 'Escape') (event.target as HTMLElement).blur();
      return;
    }

    // Single keys. A dialog or an editor on screen owns the keyboard, and a
    // key held with a modifier belongs to the browser or the system.
    if (overlaid()) return;
    if (!mod && !event.altKey && !event.shiftKey) {
      const key = event.key.toLowerCase();
      if (key === 'g') {
        event.preventDefault();
        graphView?.focus();
        return;
      }
      if (key === 's') {
        // Stage or unstage the file selected in the commit panel.
        const change = commitStore.all.find((c) => c.path === commitStore.selected);
        if (dock === 'commit' && change) {
          event.preventDefault();
          commitStore.toggle(change);
        }
        return;
      }
      if (key === 'r') {
        // Revert asks before it does anything, so one key is enough.
        const hashes = repoStore.selection.length > 0 ? repoStore.selection : repoStore.cursor ? [repoStore.cursor] : [];
        const commits = hashes.map((h) => repoStore.commitByHash(h)).filter((c) => !!c);
        if (commits.length > 0) {
          event.preventDefault();
          revertCommits(commits);
        }
        return;
      }
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
        {:else if dock === 'stats'}
          <StatsPanel />
        {:else if dock === 'undo'}
          <RecoveryPanel />
        {:else if dock === 'github'}
          <GithubPanel />
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
        {#if dock === 'stats'}
          <!-- A report is read at width, so it takes the whole main area
               rather than sharing it with the graph. -->
          <StatsReport />
        {:else}
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
        {/if}
        {#if consoleStore.open}<ConsolePanel />{/if}
      </main>
    </div>

    <StatusBar />
  </div>
{/if}

<!-- The compare view opens files in the diff viewer, so it sits beneath it. -->
<CompareViewer />
<DiffViewer />
<MergeEditor />
<BlameViewer />
<Dialog />
<CommandPalette />
{#if rebaseStore.open}<RebaseEditor />{/if}
{#if settingsStore.open}<SettingsPanel />{/if}
{#if lfsStore.open}<LfsPanel />{/if}
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
