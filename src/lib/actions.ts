/**
 * Every user-facing Git operation, with its safety check attached.
 *
 * Components build menus from here instead of calling the store directly, so
 * a confirmation cannot be forgotten at one call site and present at another
 * (plan section 18).
 */
import { repoStore } from './state/repo.svelte';
import { commitStore } from './state/commit.svelte';
import { confirm, prompt } from './state/dialogs.svelte';
import type { DialogFact } from './state/dialogs.svelte';
import { toasts } from './state/toasts.svelte';
import { pluralize } from './format';
import type { MenuItem } from './menu';
import { SEPARATOR } from './menu';
import type { Branch, Commit } from './git/types';
import type { Change } from './changes';
import { KIND_LABEL } from './changes';

/** Mirrors the rules `git check-ref-format` enforces, so we fail before Git does. */
export function validateBranchName(name: string): string | null {
  if (!name) return 'A branch name is required.';
  if (/\s/.test(name)) return 'Branch names cannot contain spaces.';
  if (/[~^:?*[\\]/.test(name)) return 'Branch names cannot contain ~ ^ : ? * [ or \\.';
  if (name.includes('..')) return 'Branch names cannot contain "..".';
  if (name.includes('@{')) return 'Branch names cannot contain "@{".';
  if (name.startsWith('/') || name.endsWith('/')) return 'Branch names cannot start or end with "/".';
  if (name.startsWith('-')) return 'Branch names cannot start with "-".';
  if (name.endsWith('.') || name.endsWith('.lock')) return 'Branch names cannot end with "." or ".lock".';
  if (name === 'HEAD') return 'HEAD is reserved.';
  if (repoStore.branches.local.some((b) => b.name === name)) return `Branch "${name}" already exists.`;
  return null;
}

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toasts.info(`Copied ${label}`);
  } catch {
    toasts.error('Could not copy to the clipboard');
  }
}

/** Shared guard: a checkout can be blocked or can silently carry changes along. */
async function confirmDirtyCheckout(target: string): Promise<boolean> {
  if (!repoStore.isDirty) return true;
  return confirm({
    title: 'You have uncommitted changes',
    message: `Git will carry your changes over to ${target} if it can, and refuse the checkout if a change would be overwritten.`,
    tone: 'warning',
    facts: [
      { label: 'Changed files', value: String(repoStore.dirtyFileCount), tone: 'warning' },
      { label: 'Current branch', value: repoStore.currentBranch ?? 'detached HEAD' },
      { label: 'Target', value: target }
    ],
    confirmLabel: 'Switch anyway'
  });
}

export async function switchToBranch(name: string) {
  if (repoStore.currentBranch === name) return;
  if (!(await confirmDirtyCheckout(name))) return;
  await repoStore.switchBranch(name);
}

export async function createBranchFrom(startPoint: string | undefined, describeStart: string) {
  const name = await prompt({
    title: 'Create branch',
    message: `The new branch will start at ${describeStart}.`,
    input: {
      label: 'Branch name',
      value: '',
      placeholder: 'feature/my-change',
      validate: validateBranchName
    },
    confirmLabel: 'Create and switch'
  });
  if (!name) return;
  if (repoStore.isDirty && !(await confirmDirtyCheckout(name))) return;
  await repoStore.createBranch(name, startPoint, true);
}

export async function renameBranch(branch: Branch) {
  const name = await prompt({
    title: `Rename ${branch.name}`,
    input: {
      label: 'New name',
      value: branch.name,
      validate: (value) => (value === branch.name ? 'That is the current name.' : validateBranchName(value))
    },
    confirmLabel: 'Rename'
  });
  if (!name) return;
  if (branch.upstream) {
    const ok = await confirm({
      title: 'This branch tracks a remote',
      message: 'Renaming changes only your local branch. The remote branch keeps its old name until you push the new one and delete the old one.',
      tone: 'warning',
      facts: [
        { label: 'Local', value: `${branch.name} → ${name}` },
        { label: 'Remote', value: branch.upstream, tone: 'warning' }
      ],
      confirmLabel: 'Rename locally'
    });
    if (!ok) return;
  }
  await repoStore.renameBranch(branch.name, name);
}

export async function deleteBranch(branch: Branch) {
  const inspection = await repoStore.inspectBranch(branch.name);
  const unmerged = inspection ? inspection.unmergedCommits : 0;
  const onRemote = inspection?.onRemote ?? [];
  const risky = unmerged > 0;

  const facts = [
    { label: 'Branch', value: branch.name },
    {
      label: 'Not on HEAD',
      value: risky
        ? `${pluralize(unmerged, 'commit')} would be left unreachable`
        : 'nothing, it is fully merged',
      tone: risky ? ('danger' as const) : ('normal' as const)
    },
    {
      label: 'Remote copy',
      value: onRemote.length ? onRemote.join(', ') : 'none, this is the only copy',
      tone: onRemote.length ? ('normal' as const) : ('warning' as const)
    }
  ];

  const ok = await confirm({
    title: `Delete ${branch.name}?`,
    message: risky
      ? 'This branch has commits that are not reachable from HEAD. Deleting it makes them hard to find, though they stay in the reflog for a while.'
      : 'This branch is fully merged, so no commits are lost.',
    tone: risky ? 'danger' : 'normal',
    facts,
    confirmLabel: risky ? 'Delete anyway' : 'Delete'
  });
  if (!ok) return;
  await repoStore.deleteBranch(branch.name, risky);
}

export async function checkoutRemoteBranch(remote: Branch) {
  // origin/feature/x -> feature/x
  const local = remote.name.split('/').slice(1).join('/');
  const existing = repoStore.branches.local.find((b) => b.name === local);
  if (existing) {
    await switchToBranch(local);
    return;
  }
  if (!(await confirmDirtyCheckout(local))) return;
  await repoStore.createBranch(local, remote.name, true);
}

export async function checkoutCommit(commit: Commit) {
  const ok = await confirm({
    title: 'Check out this commit?',
    message: 'HEAD will be detached, meaning it points at a commit instead of a branch. New commits made here belong to no branch until you create one.',
    tone: 'warning',
    facts: [
      { label: 'Commit', value: `${commit.shortHash}  ${commit.subject}` },
      { label: 'Leaving', value: repoStore.currentBranch ?? 'detached HEAD' },
      ...(repoStore.isDirty
        ? [{ label: 'Uncommitted', value: `${repoStore.dirtyFileCount} changed files`, tone: 'warning' as const }]
        : [])
    ],
    confirmLabel: 'Detach HEAD'
  });
  if (!ok) return;
  await repoStore.checkoutCommit(commit.hash);
}

/**
 * Can this selection be squashed? Answered from data already on screen, so
 * the menu item can be greyed out with a reason straight away. The backend
 * checks the rest (a clean working tree, and so on) before anything runs.
 *
 * `commits` arrives newest first, the order the graph shows.
 */
export function canSquash(commits: Commit[]): { ok: boolean; reason?: string } {
  if (commits.length < 2) return { ok: false, reason: 'select 2 or more' };

  const merges = commits.filter((c) => c.parents.length > 1).length;
  if (merges > 0) return { ok: false, reason: 'contains a merge' };

  for (let i = 0; i < commits.length - 1; i++) {
    if (commits[i].parents[0] !== commits[i + 1].hash) {
      return { ok: false, reason: 'not next to each other' };
    }
  }

  if (commits[commits.length - 1].parents.length === 0) {
    return { ok: false, reason: 'includes the first commit' };
  }

  return { ok: true };
}

/** Join the selected messages oldest first, the way a person would read them. */
function seedMessage(messages: { hash: string; message: string }[], order: string[]): string {
  const byHash = new Map(messages.map((m) => [m.hash, m.message]));
  return order
    .slice()
    .reverse()
    .map((hash) => (byHash.get(hash) ?? '').trim())
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Squash a run of commits into one, as IntelliJ IDEA does: combine the
 * messages, let the user edit the result, then rewrite the history.
 */
export async function squashCommits(commits: Commit[]) {
  const local = canSquash(commits);
  if (!local.ok) {
    await confirm({
      title: 'These commits cannot be squashed',
      message: 'Squashing combines a continuous run of ordinary commits into one.',
      tone: 'warning',
      facts: [
        { label: 'Selected', value: pluralize(commits.length, 'commit') },
        { label: 'Problem', value: local.reason ?? 'unknown', tone: 'warning' }
      ],
      confirmLabel: 'Close',
      cancelLabel: 'Back'
    });
    return;
  }

  const hashes = commits.map((c) => c.hash);

  // Ask Git the questions the screen cannot answer.
  const inspection = await repoStore.inspectSquash(hashes);
  if (!inspection.ok) {
    await confirm({
      title: 'These commits cannot be squashed',
      message: inspection.problems.join('\n\n'),
      tone: 'warning',
      confirmLabel: 'Close',
      cancelLabel: 'Back'
    });
    return;
  }

  const { messages } = await repoStore.commitMessages(hashes);
  const published = inspection.published ?? [];

  const facts: DialogFact[] = [
    { label: 'Commits', value: `${commits.length} become 1` },
    { label: 'Branch', value: inspection.branch ?? repoStore.currentBranch ?? 'detached HEAD' },
    { label: 'Oldest', value: `${commits[commits.length - 1].shortHash}  ${commits[commits.length - 1].subject}` },
    { label: 'Newest', value: `${commits[0].shortHash}  ${commits[0].subject}` }
  ];

  if ((inspection.replayed ?? 0) > 0) {
    facts.push({
      label: 'Rewritten',
      value: `${pluralize(inspection.replayed ?? 0, 'later commit')} will get a new hash`,
      tone: 'warning'
    });
  }

  facts.push(
    published.length > 0
      ? {
          label: 'Published',
          value: `already on ${published.join(', ')}. A force push would be needed.`,
          tone: 'danger'
        }
      : { label: 'Published', value: 'not pushed yet, so this is safe to change' }
  );

  const message = await prompt({
    title: `Squash ${commits.length} commits`,
    message: 'The commits are replaced by one commit with the message below.',
    tone: published.length > 0 ? 'warning' : 'normal',
    facts,
    input: {
      label: 'Commit message',
      value: seedMessage(messages, hashes),
      multiline: true,
      placeholder: 'Describe the combined change',
      validate: (value) => (value.trim() ? null : 'A commit message is required.')
    },
    confirmLabel: 'Squash'
  });

  if (!message) return;
  await repoStore.squash(hashes, message);
}

/** Context menu for a commit row in the graph. */
export function commitMenuItems(commit: Commit, selection: string[]): MenuItem[] {
  const multiple = selection.length > 1 && selection.includes(commit.hash);
  if (multiple) {
    const selected = selection
      .map((hash) => repoStore.commitByHash(hash))
      .filter((c): c is Commit => !!c);
    const squashable = canSquash(selected);

    return [
      { label: `${selection.length} commits selected`, disabled: true },
      SEPARATOR,
      {
        label: 'Squash Commits…',
        hint: squashable.ok ? undefined : squashable.reason,
        disabled: !squashable.ok,
        action: () => squashCommits(selected)
      },
      SEPARATOR,
      {
        label: 'Copy hashes',
        action: () => copy(selection.join('\n'), `${selection.length} hashes`)
      }
    ];
  }

  const localRefs = commit.refs.filter((r) => r.kind === 'local' && !r.isHead);
  const remoteRefs = commit.refs.filter((r) => r.kind === 'remote');
  const items: MenuItem[] = [];

  for (const ref of localRefs) {
    items.push({ label: `Switch to ${ref.name}`, action: () => switchToBranch(ref.name) });
  }
  for (const ref of remoteRefs) {
    const local = ref.name.split('/').slice(1).join('/');
    if (repoStore.branches.local.some((b) => b.name === local)) continue;
    items.push({
      label: `Check out ${ref.name}`,
      hint: `as ${local}`,
      action: () => {
        const branch = repoStore.branches.remote.find((b) => b.name === ref.name);
        if (branch) checkoutRemoteBranch(branch);
      }
    });
  }
  if (items.length) items.push(SEPARATOR);

  items.push(
    {
      label: 'Create branch from here…',
      hint: '⌘⇧B',
      action: () => createBranchFrom(commit.hash, `${commit.shortHash} (${commit.subject})`)
    },
    {
      label: 'Check out commit',
      hint: 'detached',
      action: () => checkoutCommit(commit)
    },
    SEPARATOR,
    { label: 'Copy commit hash', action: () => copy(commit.hash, 'commit hash') },
    { label: 'Copy short hash', action: () => copy(commit.shortHash, commit.shortHash) },
    { label: 'Copy subject', action: () => copy(commit.subject, 'subject') }
  );

  return items;
}

/** Context menu for a branch in the sidebar. */
export function branchMenuItems(branch: Branch, kind: 'local' | 'remote' | 'tag'): MenuItem[] {
  if (kind === 'tag') {
    return [
      { label: 'Create branch from tag…', action: () => createBranchFrom(branch.name, `tag ${branch.name}`) },
      SEPARATOR,
      { label: 'Copy tag name', action: () => copy(branch.name, branch.name) },
      { label: 'Copy target hash', action: () => copy(branch.oid, 'target hash') }
    ];
  }

  if (kind === 'remote') {
    return [
      { label: 'Check out as local branch', action: () => checkoutRemoteBranch(branch) },
      { label: 'Create branch from here…', action: () => createBranchFrom(branch.name, branch.name) },
      SEPARATOR,
      { label: 'Copy branch name', action: () => copy(branch.name, branch.name) }
    ];
  }

  return [
    {
      label: branch.isHead ? 'Already checked out' : `Switch to ${branch.name}`,
      hint: branch.isHead ? undefined : '⏎',
      disabled: branch.isHead,
      action: () => switchToBranch(branch.name)
    },
    { label: 'Create branch from here…', action: () => createBranchFrom(branch.name, branch.name) },
    SEPARATOR,
    { label: 'Rename…', action: () => renameBranch(branch) },
    {
      label: 'Delete…',
      danger: true,
      disabled: branch.isHead,
      hint: branch.isHead ? 'checked out' : undefined,
      action: () => deleteBranch(branch)
    },
    SEPARATOR,
    { label: 'Copy branch name', action: () => copy(branch.name, branch.name) }
  ];
}


/* ------------------------------------------------------------------ *
 * The commit panel
 * ------------------------------------------------------------------ */

/** The remote a branch with no upstream would be published to. */
export function defaultRemote(): string | null {
  const remotes = repoStore.remotes;
  if (remotes.length === 0) return null;
  return remotes.includes('origin') ? 'origin' : remotes[0];
}

/**
 * Checks that have to happen before anything is written, in the order a
 * person would think of them. Returns false when the commit must not run.
 */
async function confirmCommit(): Promise<boolean> {
  const ticked = new Set(commitStore.checkedPaths);
  const conflicted = commitStore.conflicts.filter((c) => ticked.has(c.path));

  // Git refuses to commit an unmerged path, so say why before it does.
  if (conflicted.length > 0) {
    await confirm({
      title: 'Resolve the conflicts first',
      message:
        'These files still hold conflict markers from an unfinished merge. Git will not commit a file until its conflict is marked resolved.',
      tone: 'warning',
      facts: conflicted.slice(0, 6).map((c) => ({ label: 'Conflict', value: c.path, tone: 'danger' as const })),
      confirmLabel: 'Close',
      cancelLabel: 'Back'
    });
    return false;
  }

  if (commitStore.forced) {
    const operation = repoStore.status?.operation ?? 'merge';
    const total = commitStore.changes.length + commitStore.unversioned.length;
    const ok = await confirm({
      title: `A ${operation} is in progress`,
      message:
        `Git cannot commit part of the working tree while a ${operation} is unfinished, so this commit takes everything in it. The tick boxes do not apply.`,
      tone: 'warning',
      facts: [
        { label: 'Operation', value: operation, tone: 'warning' },
        { label: 'Files', value: `all ${total} of them` }
      ],
      confirmLabel: 'Commit everything'
    });
    if (!ok) return false;
  }

  const head = commitStore.head;
  if (commitStore.amend && head?.pushed) {
    const ok = await confirm({
      title: 'This commit is already pushed',
      message:
        'Amending replaces the commit with a new one, so the branch no longer matches the remote. Publishing it afterwards needs a force push, and anyone who already pulled it keeps the old copy.',
      tone: 'danger',
      facts: [
        { label: 'Commit', value: `${head.hash?.slice(0, 7)}  ${head.subject}` },
        { label: 'Already on', value: head.pushed, tone: 'danger' },
        { label: 'After this', value: 'a force push would be needed', tone: 'warning' }
      ],
      confirmLabel: 'Amend anyway'
    });
    if (!ok) return false;
  }

  if (commitStore.amend && head?.isMerge) {
    const ok = await confirm({
      title: 'You are amending a merge commit',
      message:
        'A merge commit records how two histories came together. Amending keeps both parents, but the commit is still replaced.',
      tone: 'warning',
      facts: [{ label: 'Commit', value: `${head.hash?.slice(0, 7)}  ${head.subject}` }],
      confirmLabel: 'Amend the merge'
    });
    if (!ok) return false;
  }

  return true;
}

export async function commitChanges(): Promise<boolean> {
  if (!commitStore.canCommit) return false;
  if (!(await confirmCommit())) return false;
  return (await commitStore.commit()) !== null;
}

/** Commit, then offer to publish the branch, stating where it would go. */
export async function commitAndPush() {
  if (!(await commitChanges())) return;

  const branch = repoStore.branches.local.find((b) => b.isHead) ?? null;
  const remote = defaultRemote();

  if (!branch) {
    toasts.error('Nothing to push', 'HEAD is detached, so there is no branch to publish.');
    return;
  }
  if (!branch.upstream && !remote) {
    toasts.error('No remote configured', `Add a remote before pushing ${branch.name}.`);
    return;
  }

  const ok = await confirm({
    title: `Push ${branch.name}?`,
    message: branch.upstream
      ? 'Your commits are sent to the remote branch this one tracks.'
      : 'This branch has never been pushed. It will be created on the remote and set as the branch to track.',
    facts: [
      { label: 'Branch', value: branch.name },
      { label: 'Target', value: branch.upstream ?? `${remote}/${branch.name} (new)` },
      {
        label: 'Sending',
        // Without an upstream there is nothing to count against, so Git's
        // "ahead" is 0 and saying so would be misleading.
        value: branch.upstream
          ? pluralize(branch.ahead, 'commit')
          : 'every commit on this branch that the remote does not already have'
      },
      ...(branch.behind > 0
        ? [{
            label: 'Behind',
            value: `${pluralize(branch.behind, 'commit')} on the remote you do not have. Git will refuse the push; pull first.`,
            tone: 'warning' as const
          }]
        : [])
    ],
    tone: branch.behind > 0 ? 'warning' : 'normal',
    confirmLabel: 'Push'
  });
  if (!ok) return;

  await commitStore.push(
    branch.upstream ? {} : { remote: remote ?? undefined, setUpstream: true }
  );
}

/** Throw away the working-tree changes to these files, after saying what goes. */
export async function rollbackChanges(changes: Change[]) {
  if (changes.length === 0) return;

  // A file Git has never seen has no committed version to go back to, and
  // Gitalia will not delete it, so there is nothing to undo.
  const tracked = changes.filter((c) => c.kind !== 'unversioned');
  if (tracked.length === 0) {
    await confirm({
      title: 'Nothing to roll back',
      message:
        'These files are not under version control, so there is no committed version to restore. Delete them in your file manager if you no longer want them.',
      tone: 'warning',
      facts: changes.slice(0, 6).map((c) => ({ label: 'Unversioned', value: c.path })),
      confirmLabel: 'Close',
      cancelLabel: 'Back'
    });
    return;
  }

  const newFiles = tracked.filter((c) => c.kind === 'added');
  const ok = await confirm({
    title: tracked.length === 1 ? `Roll back ${tracked[0].name}?` : `Roll back ${tracked.length} files?`,
    message:
      'The changes you made to these files are thrown away and cannot be recovered. Files that were newly added become unversioned again; nothing is deleted from disk.',
    tone: 'danger',
    facts: [
      ...tracked.slice(0, 6).map((c) => ({
        label: KIND_LABEL[c.kind],
        value: c.path,
        tone: 'danger' as const
      })),
      ...(tracked.length > 6
        ? [{ label: 'And', value: `${tracked.length - 6} more`, tone: 'danger' as const }]
        : []),
      ...(newFiles.length > 0
        ? [{ label: 'Kept on disk', value: pluralize(newFiles.length, 'new file') }]
        : [])
    ],
    confirmLabel: 'Roll back'
  });
  if (!ok) return;

  await commitStore.rollback(tracked.map((c) => c.path));
}

/** Context menu for a file in the commit panel. */
export function changeMenuItems(change: Change): MenuItem[] {
  const ticked = commitStore.isChecked(change.path);
  return [
    {
      label: ticked ? 'Exclude from commit' : 'Include in commit',
      hint: commitStore.forced ? 'a merge is in progress' : undefined,
      disabled: commitStore.forced,
      action: () => commitStore.toggle(change)
    },
    SEPARATOR,
    {
      label: 'Roll back…',
      danger: true,
      hint: change.kind === 'unversioned' ? 'not versioned' : undefined,
      disabled: change.kind === 'unversioned',
      action: () => rollbackChanges([change])
    },
    SEPARATOR,
    { label: 'Copy path', action: () => copy(change.path, change.path) },
    {
      label: 'Copy full path',
      action: () => copy(`${repoStore.info?.root ?? ''}/${change.path}`, 'full path')
    }
  ];
}
