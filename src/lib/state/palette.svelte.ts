/**
 * The command palette: one searchable list of everything the app can do.
 *
 * The list is rebuilt whenever the palette is open, so the commands always
 * match what is selected and what branch is checked out. Running one closes
 * the palette and hands over to the command, which keeps its own
 * confirmation and dialogs.
 */
import { repoStore } from './repo.svelte';
import { commitStore } from './commit.svelte';
import { settingsStore } from './settings.svelte';
import { rebaseStore } from './rebase.svelte';
import { consoleStore } from './console.svelte';
import type { Commit } from '../git/types';
import type { IconName } from '../components/Icon.svelte';
import { toasts } from './toasts.svelte';
import { checkForUpdates } from '../updates';
import { isDesktop } from '../git/transport';
import {
  switchToBranch,
  createBranchFrom,
  squashCommits,
  dropCommits,
  createTag,
  commitAndPush,
  mergeBranch,
  pullBranch,
  pushBranch,
  forcePushBranch,
  cherryPickCommits,
  revertCommits,
  resetToCommit,
  stashChanges,
  canSquash,
  defaultRemote,
  blameFile,
  startBisect,
  newWorktree,
  savePatch,
  applyPatchFile,
  exportBundle,
  importBundle
} from '../actions';
import { bisectStore } from './bisect.svelte';
import { compareStore } from './compare.svelte';
import { submoduleStore } from './submodules.svelte';
import { lfsStore } from './lfs.svelte';
import { githubStore } from './github.svelte';
import { appearance, PALETTES, TEXT_SIZES } from './appearance.svelte';

/** What the app has to let commands drive, provided by the shell. */
export interface PaletteBindings {
  setDock(panel: 'branches' | 'commit' | 'stats' | 'undo' | 'github' | 'help'): void;
  /** Focus the commit panel's message box, opening the panel first. */
  openCommit(): void;
  focusSearch(): void;
  focusGraph(): void;
  toggleTheme(): void;
}

const NOOP: PaletteBindings = {
  setDock() {},
  openCommit() {},
  focusSearch() {},
  focusGraph() {},
  toggleTheme() {}
};

export interface PaletteCommand {
  id: string;
  label: string;
  /** Extra words to match that are not shown, like "checkout" for "switch". */
  keywords: string;
  icon: IconName | null;
  hint: string;
  group: string;
  danger: boolean;
  disabled: boolean;
  run: () => void | Promise<unknown>;
}

/** How well a command matches the query; -1 means it does not. */
function rank(candidate: string, query: string): number {
  const hay = candidate.toLowerCase();
  const q = query.toLowerCase();
  if (hay === q) return 0;
  if (hay.startsWith(q)) return 1;
  if (hay.includes(` ${q}`)) return 2;
  if (hay.includes(q)) return 3;
  return -1;
}

class PaletteStore {
  open = $state(false);
  query = $state('');
  active = $state(0);

  private bindings = $state<PaletteBindings>(NOOP);

  /** The whole command set, rebuilt reactively so it tracks the selection. */
  all = $derived.by(() => commands(this.bindings));

  filtered = $derived.by(() => {
    const q = this.query.trim();
    if (!q) return this.all;
    const scored = this.all
      .map((c, i) => ({ c, i, s: rank(`${c.label} ${c.keywords}`, q) }))
      .filter((m) => m.s >= 0);
    scored.sort((a, b) => a.s - b.s || a.i - b.i);
    return scored.map((m) => m.c);
  });

  shown = $derived(this.filtered.slice(0, 48));

  bind(bindings: PaletteBindings) {
    this.bindings = bindings;
  }

  toggle() {
    if (this.open) this.close();
    else this.show();
  }

  /** Open the palette, optionally with the search already typed. */
  show(query = '') {
    this.query = query;
    this.active = 0;
    this.open = true;
  }

  close() {
    this.open = false;
  }

  step(delta: number) {
    const n = this.shown.length;
    if (n === 0) return;
    this.active = (this.active + delta + n) % n;
  }

  /** Run the highlighted command, closing the palette first. */
  run() {
    const command = this.shown[this.active];
    if (!command || command.disabled) return false;
    this.close();
    // Actions report their own failures; this catches the one that throws
    // before it gets the chance, so nothing rejects unobserved.
    Promise.resolve()
      .then(() => command.run())
      .catch((err) => toasts.error(`Could not ${command.label.replace(/…$/, '').toLowerCase()}`, String(err?.message ?? err)));
    return true;
  }
}

function commands(b: PaletteBindings): PaletteCommand[] {
  const out: PaletteCommand[] = [];
  const add = (
    o: Omit<PaletteCommand, 'keywords' | 'icon' | 'hint' | 'group' | 'danger' | 'disabled'>
      & Partial<Pick<PaletteCommand, 'keywords' | 'icon' | 'hint' | 'group' | 'danger' | 'disabled'>>
  ) => {
    out.push({
      keywords: '',
      icon: null,
      hint: '',
      group: 'Repository',
      danger: false,
      disabled: false,
      ...o
    } as PaletteCommand);
  };

  const cursor = repoStore.cursor;
  const cursorCommit = cursor ? repoStore.commitByHash(cursor) : undefined;
  const selection = repoStore.selection
    .map((h) => repoStore.commitByHash(h))
    .filter((c): c is Commit => !!c);
  /** What the commit commands act on: the selection, or the cursor alone. */
  const commits = selection.length > 0 ? selection : cursorCommit ? [cursorCommit] : [];
  const branch = repoStore.currentBranch;
  const publishable = !!repoStore.status?.upstream || !!defaultRemote();

  add({
    id: 'refresh',
    label: 'Refresh repository',
    keywords: 'reload reread',
    icon: 'refresh',
    hint: '⌘R',
    run: () => repoStore.refresh()
  });
  add({
    id: 'fetch',
    label: 'Fetch all remotes',
    icon: 'fetch',
    hint: '⌘⇧F',
    run: () => repoStore.fetch()
  });
  add({
    id: 'pull',
    label: 'Pull…',
    icon: 'pull',
    hint: '⌘⇧L',
    disabled: repoStore.head?.detached === true,
    run: () => pullBranch()
  });
  add({
    id: 'push',
    label: 'Push…',
    icon: 'push',
    hint: '⌘⇧U',
    disabled: !publishable,
    run: () => pushBranch()
  });
  add({
    id: 'force-push',
    label: 'Force push…',
    icon: 'force-push',
    group: 'Repository',
    danger: true,
    disabled: !repoStore.status?.upstream,
    run: () => forcePushBranch()
  });
  add({
    id: 'settings',
    label: 'Open settings',
    keywords: 'keys ai providers theme',
    icon: 'settings',
    group: 'Repository',
    run: () => settingsStore.show()
  });
  add({
    id: 'console',
    label: consoleStore.open ? 'Close the console' : 'Open the console',
    keywords: 'terminal git command line shell',
    icon: 'console',
    group: 'Repository',
    run: () => consoleStore.toggle()
  });
  add({
    id: 'theme',
    label: 'Toggle dark / light theme',
    keywords: 'appearance night',
    icon: 'settings',
    group: 'Repository',
    run: () => b.toggleTheme()
  });
  add({
    id: 'close-repo',
    label: 'Close repository',
    icon: 'close',
    group: 'Repository',
    run: () => repoStore.close()
  });

  add({
    id: 'commit',
    label: 'Commit…',
    keywords: 'stage staged message',
    icon: 'commit',
    hint: '⌘⇧K',
    group: 'Changes',
    run: () => b.openCommit()
  });
  add({
    id: 'commit-push',
    label: 'Commit and push…',
    keywords: 'commit push together',
    icon: 'push',
    group: 'Changes',
    disabled: !commitStore.canCommit,
    run: () => commitAndPush()
  });
  add({
    id: 'stash',
    label: 'Stash all changes…',
    icon: 'stash',
    group: 'Changes',
    disabled: repoStore.dirtyFileCount === 0 && commitStore.checkedPaths.length === 0,
    run: () => stashChanges([...commitStore.changes, ...commitStore.unversioned])
  });

  // Branch commands list every usable branch by name, so switching and
  // merging are one or two keystrokes away.
  for (const local of repoStore.branches.local) {
    const isCurrent = local.name === branch;
    add({
      id: `switch-${local.name}`,
      label: `Switch to ${local.name}`,
      keywords: `checkout branch ${isCurrent ? 'current' : ''}`,
      icon: 'switch',
      hint: '⌘B',
      group: 'Branches',
      disabled: isCurrent,
      run: () => switchToBranch(local.name)
    });
    if (!isCurrent) {
      add({
        id: `compare-${local.name}`,
        label: `Compare ${local.name} with ${branch ?? 'HEAD'}`,
        keywords: 'compare diff ahead behind branch',
        icon: 'diff',
        group: 'Branches',
        run: () => compareStore.show(branch ? `refs/heads/${branch}` : 'HEAD', `refs/heads/${local.name}`, { base: branch ?? 'HEAD', target: local.name })
      });
    }
    // A branch cannot be merged into itself, so the current one is not
    // offered at all rather than shown greyed out.
    if (!isCurrent) {
      add({
        id: `merge-${local.name}`,
        label: `Merge ${local.name} into ${branch ?? 'HEAD'}…`,
        keywords: 'merge branch',
        icon: 'merge',
        group: 'Branches',
        run: () => mergeBranch(local.name)
      });
    }
  }
  add({
    id: 'create-branch',
    label: 'Create branch…',
    keywords: 'new checkout',
    icon: 'branch-plus',
    hint: '⌘⇧B',
    group: 'Branches',
    run: () => createBranchFrom(cursor ?? undefined, cursor ? 'the selected commit' : 'HEAD')
  });

  // The label already names a single commit by its hash.
  const selectedText = commits.length === 1 ? '' : `${commits.length} commits`;
  const target =
    commits.length === 1
      ? cursorCommit?.subject ?? 'the selected commit'
      : `${commits.length} selected commits`;

  add({
    id: 'cherry-pick',
    label: commits.length === 1 ? `Cherry-pick ${cursorCommit?.shortHash}…` : 'Cherry-pick the selected commits…',
    keywords: 'apply copy commit',
    icon: 'cherry-pick',
    hint: selectedText,
    group: 'History',
    disabled: commits.length === 0,
    run: () => cherryPickCommits(commits)
  });
  add({
    id: 'revert',
    label: commits.length === 1 ? `Revert ${cursorCommit?.shortHash}…` : 'Revert the selected commits…',
    keywords: 'undo',
    icon: 'revert',
    hint: 'R',
    group: 'History',
    disabled: commits.length === 0,
    run: () => revertCommits(commits)
  });
  // One commit squashes into its parent, so the pair is what gets checked
  // and folded, exactly as if both had been selected.
  const parent = commits.length === 1
    ? repoStore.commits.find((c) => c.hash === commits[0].parents[0])
    : undefined;
  const squashing = commits.length === 1 ? (parent ? [commits[0], parent] : []) : commits;
  add({
    id: 'squash',
    label: commits.length === 1 ? `Squash ${cursorCommit?.shortHash} into the one below…` : `Squash ${commits.length} commits…`,
    keywords: 'fold combine merge together',
    icon: 'squash',
    group: 'History',
    disabled: !canSquash(squashing).ok,
    run: () => squashCommits(squashing)
  });
  add({
    id: 'drop',
    label: commits.length === 1 ? `Drop ${cursorCommit?.shortHash}…` : `Drop ${commits.length} commits…`,
    keywords: 'delete remove throw away',
    icon: 'drop',
    group: 'History',
    danger: true,
    disabled: commits.length === 0,
    run: () => dropCommits(commits)
  });
  add({
    id: 'reset',
    label: 'Reset to the selected commit…',
    keywords: 'undo hard soft mixed move head',
    icon: 'reset',
    group: 'History',
    disabled: !cursorCommit,
    run: () => resetToCommit(cursorCommit!)
  });
  add({
    id: 'rebase',
    label: 'Interactive rebase from the selected commit…',
    keywords: 'edit reword squash reorder history todo',
    icon: 'rebase',
    group: 'History',
    disabled: !cursor,
    run: () => rebaseStore.show(cursor!)
  });
  add({
    id: 'tag',
    label: 'Create tag at the selected commit…',
    keywords: 'annotate version release',
    icon: 'tag',
    group: 'History',
    disabled: !cursorCommit,
    run: () => createTag(cursor ?? null, target)
  });
  add({
    id: 'copy-hash',
    label: 'Copy the selected commit hash',
    keywords: 'full sha clipboard',
    icon: 'copy',
    group: 'History',
    disabled: !cursorCommit,
    run: () => {
      void navigator.clipboard.writeText(cursorCommit!.hash);
      toasts.success('Copied the hash', cursorCommit!.shortHash);
    }
  });

  add({
    id: 'view-commit',
    label: 'Show the commit panel',
    keywords: 'changes files message commit box',
    icon: 'commit',
    group: 'View',
    run: () => b.setDock('commit')
  });
  add({
    id: 'view-branches',
    label: 'Show the branches list',
    keywords: 'sidebar refs tags',
    icon: 'branch',
    group: 'View',
    run: () => b.setDock('branches')
  });
  add({
    id: 'view-stats',
    label: 'Show the statistics report',
    keywords: 'activity contributors report charts',
    icon: 'stats',
    group: 'View',
    run: () => b.setDock('stats')
  });
  add({
    id: 'view-help',
    label: 'Show help and keyboard shortcuts',
    keywords: 'help guide shortcuts keys how info',
    icon: 'help',
    group: 'View',
    hint: '?',
    run: () => b.setDock('help')
  });
  if (isDesktop) {
    add({
      id: 'check-updates',
      label: 'Check for updates',
      keywords: 'update upgrade new version release',
      icon: 'refresh',
      group: 'View',
      run: () => checkForUpdates()
    });
  }
  if (repoStore.status?.operation === 'bisect') {
    for (const [verdict, label] of [['good', 'Bisect: this commit works'], ['bad', 'Bisect: this commit is broken'], ['skip', 'Bisect: skip this commit']] as const) {
      add({ id: `bisect-${verdict}`, label, keywords: `bisect ${verdict} mark test`, icon: 'commit', group: 'History', run: () => bisectStore.mark(verdict) });
    }
    add({ id: 'bisect-stop', label: 'Bisect: stop and go back', keywords: 'bisect reset end', icon: 'close', group: 'History', run: () => bisectStore.stop() });
  } else {
    add({
      id: 'bisect-start',
      label: 'Bisect: the selected commit works, HEAD is broken…',
      keywords: 'bisect find bug regression broke',
      icon: 'commit',
      group: 'History',
      disabled: !cursorCommit || !!repoStore.status?.operation || cursorCommit.hash === repoStore.head?.oid,
      run: () => startBisect(cursorCommit!)
    });
  }
  if (submoduleStore.list.length > 0) {
    add({
      id: 'submodules-update',
      label: 'Update the submodules',
      keywords: 'submodule update init checkout recorded',
      icon: 'refresh',
      group: 'Branches',
      run: () => submoduleStore.update(null)
    });
  }
  for (const p of PALETTES) {
    add({
      id: `palette-${p.id}`,
      label: `Colour palette: ${p.name}`,
      keywords: `theme colours colors palette ${p.light} ${p.dark}`,
      icon: appearance.palette === p.id ? 'check' : null,
      hint: `${p.light} / ${p.dark}`,
      group: 'View',
      disabled: appearance.palette === p.id,
      run: () => appearance.setPalette(p.id)
    });
  }
  for (const t of TEXT_SIZES) {
    add({
      id: `text-size-${t.scale}`,
      label: `Text size: ${t.name} (${Math.round(t.scale * 100)}%)`,
      keywords: 'font zoom bigger smaller larger text size scale',
      icon: appearance.textSize === t.scale ? 'check' : null,
      hint: t.scale === 1 ? '⌘0' : '',
      group: 'View',
      disabled: appearance.textSize === t.scale,
      run: () => appearance.setTextSize(t.scale)
    });
  }
  add({
    id: 'patch-save',
    label: commits.length > 1 ? `Save ${commits.length} commits as a patch` : 'Save the selected commit as a patch',
    keywords: 'patch format-patch export email',
    icon: 'copy',
    group: 'History',
    disabled: commits.length === 0,
    run: () => savePatch(commits)
  });
  add({ id: 'patch-apply', label: 'Apply a patch file…', keywords: 'patch am apply diff import', icon: 'include', group: 'History', run: () => applyPatchFile() });
  add({ id: 'bundle-export', label: 'Export a bundle', keywords: 'bundle backup offline export all branches', icon: 'copy', group: 'Branches', run: () => exportBundle() });
  add({ id: 'bundle-import', label: 'Import a bundle…', keywords: 'bundle offline import fetch', icon: 'fetch', group: 'Branches', run: () => importBundle() });
  if (githubStore.connected) {
    add({
      id: 'github-pr',
      label: branch ? `New pull request for ${branch}…` : 'New pull request…',
      keywords: 'github pull request pr open review',
      icon: 'pull-request',
      group: 'Branches',
      disabled: !branch || branch === githubStore.status?.defaultBranch,
      run: () => githubStore.createForCurrentBranch()
    });
    add({ id: 'github-pulls', label: 'Show the pull requests', keywords: 'github pull requests pr list', icon: 'pull-request', group: 'View', run: () => b.setDock('github') });
  }
  add({
    id: 'lfs',
    label: 'Git LFS…',
    keywords: 'lfs large files track download pull binary',
    icon: 'folder',
    group: 'View',
    run: () => lfsStore.show()
  });
  add({
    id: 'worktree-new',
    label: 'New worktree…',
    keywords: 'worktree folder branch side by side parallel',
    icon: 'branch-plus',
    group: 'Branches',
    run: () => newWorktree()
  });
  add({
    id: 'blame',
    label: 'Blame a file…',
    keywords: 'annotate who changed line history author',
    icon: 'commit',
    group: 'History',
    run: () => blameFile()
  });
  add({
    id: 'undo-log',
    label: 'Open the operation log',
    keywords: 'undo restore recover reflog history lost commits',
    icon: 'rollback',
    group: 'View',
    run: () => b.setDock('undo')
  });
  add({
    id: 'focus-graph',
    label: 'Focus the commit graph',
    keywords: 'jump move selection history',
    icon: 'commit',
    hint: 'G',
    group: 'View',
    run: () => b.focusGraph()
  });
  add({
    id: 'search',
    label: 'Search commits',
    keywords: 'filter find type',
    icon: 'commit',
    hint: '⌘K',
    group: 'View',
    run: () => b.focusSearch()
  });

  return out;
}

export const paletteStore = new PaletteStore();