/**
 * Every user-facing Git operation, with its safety check attached.
 *
 * Components build menus from here instead of calling the store directly, so
 * a confirmation cannot be forgotten at one call site and present at another
 * (plan section 18).
 */
import { repoStore, describe } from './state/repo.svelte';
import { commitStore } from './state/commit.svelte';
import { confirm, confirmOr, prompt, choose } from './state/dialogs.svelte';
import { blameStore } from './state/blame.svelte';
import { saveFile } from './desktop';
import { bisectStore } from './state/bisect.svelte';
import { compareStore } from './state/compare.svelte';
import { worktreeStore } from './state/worktrees.svelte';
import { submoduleStore } from './state/submodules.svelte';
import { lfsStore } from './state/lfs.svelte';
import type { Worktree, Submodule } from './git/types';
import type { DialogFact } from './state/dialogs.svelte';
import { toasts } from './state/toasts.svelte';
import { pluralize, relativeTime } from './format';
import type { MenuItem } from './menu';
import { SEPARATOR } from './menu';
import type { Branch, Commit, ForcePushInspection, ResetMode, Stash, StashFile } from './git/types';
import type { Change } from './changes';
import { KIND_LABEL, diffSideFor, canStageHunks } from './changes';
import { diffStore } from './state/diff.svelte';
import { mergeStore } from './state/merge.svelte';
import { rebaseStore } from './state/rebase.svelte';

/** Git's empty tree, the only thing a file with no history can be compared with. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/**
 * Mirrors the rules `git check-ref-format` enforces, so we fail before Git
 * does. `kind` only shapes the wording; the rules are the same for both.
 */
function validateRefName(name: string, kind: 'Branch' | 'Tag'): string | null {
  if (!name) return `A ${kind.toLowerCase()} name is required.`;
  if (/\s/.test(name)) return `${kind} names cannot contain spaces.`;
  if (/[~^:?*[\\]/.test(name)) return `${kind} names cannot contain ~ ^ : ? * [ or \\.`;
  if (name.includes('..')) return `${kind} names cannot contain "..".`;
  if (name.includes('@{')) return `${kind} names cannot contain "@{".`;
  if (name.startsWith('/') || name.endsWith('/')) return `${kind} names cannot start or end with "/".`;
  if (name.startsWith('-')) return `${kind} names cannot start with "-".`;
  if (name.endsWith('.') || name.endsWith('.lock')) return `${kind} names cannot end with "." or ".lock".`;
  if (name === 'HEAD') return 'HEAD is reserved.';
  return null;
}

export function validateBranchName(name: string): string | null {
  const problem = validateRefName(name, 'Branch');
  if (problem) return problem;
  if (repoStore.branches.local.some((b) => b.name === name)) return `Branch "${name}" already exists.`;
  return null;
}

export function validateTagName(name: string): string | null {
  const problem = validateRefName(name, 'Tag');
  if (problem) return problem;
  if (repoStore.branches.tags.some((t) => t.name === name)) return `Tag "${name}" already exists.`;
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
        label: 'Squash commits…',
        icon: 'squash',
        hint: squashable.ok ? undefined : squashable.reason,
        disabled: !squashable.ok,
        action: () => squashCommits(selected)
      },
      {
        label: `Cherry-pick ${selection.length} commits…`,
        icon: 'cherry-pick',
        action: () => cherryPickCommits(selected)
      },
      {
        label: `Drop ${selection.length} commits…`,
        icon: 'drop',
        danger: true,
        action: () => dropCommits(selected)
      },
      {
        label: `Revert ${selection.length} commits…`,
        icon: 'revert',
        action: () => revertCommits(selected)
      },
      {
        label: `Save ${selection.length} commits as a patch`,
        icon: 'copy',
        action: () => savePatch(selected)
      },
      ...(selected.length === 2
        ? [{
            label: 'Compare these two',
            icon: 'diff' as const,
            hint: 'older against newer',
            action: () => compareStore.show(selected[1].hash, selected[0].hash, { base: selected[1].shortHash, target: selected[0].shortHash })
          }, {
            label: 'Bisect between these…',
            icon: 'commit' as const,
            hint: 'older works, newer is broken',
            disabled: !!repoStore.status?.operation,
            action: () => startBisect(selected[1], selected[0])
          }]
        : []),
      SEPARATOR,
      {
        label: 'Copy hashes',
        icon: 'copy',
        action: () => copy(selection.join('\n'), `${selection.length} hashes`)
      }
    ];
  }

  const localRefs = commit.refs.filter((r) => r.kind === 'local' && !r.isHead);
  const remoteRefs = commit.refs.filter((r) => r.kind === 'remote');
  const items: MenuItem[] = [];

  for (const ref of localRefs) {
    items.push({ label: `Switch to ${ref.name}`, icon: 'switch', action: () => switchToBranch(ref.name) });
  }
  for (const ref of remoteRefs) {
    const local = ref.name.split('/').slice(1).join('/');
    if (repoStore.branches.local.some((b) => b.name === local)) continue;
    items.push({
      label: `Check out ${ref.name}`,
      icon: 'switch',
      hint: `as ${local}`,
      action: () => {
        const branch = repoStore.branches.remote.find((b) => b.name === ref.name);
        if (branch) checkoutRemoteBranch(branch);
      }
    });
  }
  if (items.length) items.push(SEPARATOR);

  const isHead = commit.hash === repoStore.head?.oid;

  items.push(
    {
      label: 'Create branch from here…',
      icon: 'branch',
      hint: '⌘⇧B',
      action: () => createBranchFrom(commit.hash, `${commit.shortHash} (${commit.subject})`)
    },
    {
      label: 'New tag here…',
      icon: 'tag',
      action: () => createTag(commit.hash, `${commit.shortHash} (${commit.subject})`)
    },
    {
      label: 'Check out commit…',
      icon: 'switch',
      hint: 'detached',
      action: () => checkoutCommit(commit)
    },
    {
      label: 'Bisect from here…',
      icon: 'commit',
      hint: 'this one works, HEAD is broken',
      disabled: !!repoStore.status?.operation || commit.hash === repoStore.head?.oid,
      action: () => startBisect(commit)
    },
    SEPARATOR,
    {
      label: 'Move up',
      icon: 'move-up',
      hint: isHead ? 'already newest' : 'one place later',
      disabled: isHead || commit.parents.length > 1,
      action: () => moveCommit(commit, 'up')
    },
    {
      label: 'Move down',
      icon: 'move-down',
      hint: 'one place earlier',
      disabled: commit.parents.length > 1,
      action: () => moveCommit(commit, 'down')
    },
    {
      label: 'Drop commit…',
      icon: 'drop',
      danger: true,
      hint: commit.parents.length > 1 ? 'a merge cannot be dropped' : undefined,
      disabled: commit.parents.length > 1,
      action: () => dropCommits([commit])
    },
    {
      // The span runs from this commit up to HEAD, which is what
      // `git rebase -i <this commit>~1` covers.
      label: 'Rebase from here…',
      icon: 'rebase',
      hint: 'edit this and everything newer',
      disabled: commit.parents.length > 1,
      action: () => rebaseStore.show(commit.hash)
    },
    SEPARATOR,
    {
      label: 'Cherry-pick…',
      icon: 'cherry-pick',
      hint: commit.parents.length > 1 ? 'a merge cannot be copied' : 'copy onto this branch',
      disabled: commit.parents.length > 1,
      action: () => cherryPickCommits([commit])
    },
    { label: 'Revert…', icon: 'revert', action: () => revertCommits([commit]) },
    {
      label: 'Reset current branch to here…',
      icon: 'reset',
      hint: isHead ? 'already here' : undefined,
      disabled: isHead,
      danger: true,
      action: () => resetToCommit(commit)
    },
    SEPARATOR,
    { label: 'Save as patch', icon: 'copy', hint: '.patch file', action: () => savePatch([commit]) },
    { label: 'Copy commit hash', icon: 'copy', action: () => copy(commit.hash, 'commit hash') },
    { label: 'Copy short hash', icon: 'copy', action: () => copy(commit.shortHash, commit.shortHash) },
    { label: 'Copy subject', icon: 'copy', action: () => copy(commit.subject, 'subject') }
  );

  return items;
}

/* ------------------------------------------------------------------ *
 * Moving and removing commits
 * ------------------------------------------------------------------ */

/** Shared opening for the rewrites: show whatever stops them. */
async function rewriteBlocked(title: string, problems: string[], count: number) {
  await confirm({
    title,
    message: problems.join('\n\n'),
    tone: 'warning',
    facts: [{ label: 'Selected', value: pluralize(count, 'commit') }],
    confirmLabel: 'Close',
    cancelLabel: 'Back'
  });
}

/**
 * Remove commits from the branch.
 *
 * This is not a revert: nothing records that the commit was ever there, and
 * the change it made goes with it. That is the thing the dialog has to make
 * unmistakable, along with the fact that everything after it is rewritten.
 */
export async function dropCommits(commits: Commit[]) {
  if (commits.length === 0) return;
  const hashes = commits.map((c) => c.hash);

  const inspection = await repoStore.inspectRewrite(hashes, 'drop');
  if (!inspection.ok) {
    await rewriteBlocked('These commits cannot be dropped', inspection.problems, commits.length);
    return;
  }

  const rewritten = inspection.rewritten ?? [];
  const replayed = rewritten.length - commits.length;
  const published = inspection.published ?? [];
  const shown = commits.slice(0, 5);

  const ok = await confirm({
    title: commits.length === 1 ? 'Drop this commit?' : `Drop ${commits.length} commits?`,
    message:
      'The commits are removed from the branch and the changes they made go with them. This is not a revert: nothing is left behind to say they were ever here.',
    tone: 'danger',
    facts: [
      { label: 'Branch', value: inspection.branch ?? repoStore.currentBranch ?? 'detached HEAD' },
      ...shown.map((c) => ({
        label: 'Dropping',
        value: `${c.shortHash}  ${c.subject}`,
        tone: 'danger' as const
      })),
      ...(commits.length > shown.length
        ? [{ label: 'And', value: `${commits.length - shown.length} more`, tone: 'danger' as const }]
        : []),
      ...(replayed > 0
        ? [{ label: 'Rewritten', value: `${pluralize(replayed, 'later commit')} will get a new hash` }]
        : []),
      ...(published.length > 0
        ? [{
            label: 'Already pushed',
            value: `Some of these are on ${published.join(', ')}. Publishing the result needs a force push, and anyone who pulled them keeps them.`,
            tone: 'warning' as const
          }]
        : []),
      { label: 'Instead', value: 'Cancel and revert them if you want the history to record the undo.' }
    ],
    confirmLabel: commits.length === 1 ? 'Drop it' : `Drop ${commits.length} commits`
  });
  if (!ok) return;

  await repoStore.drop(hashes);
}

/**
 * Move a commit one place through the history.
 *
 * One step per click. Replaying a commit somewhere else can conflict, and a
 * conflict mid-rebase is the part worth warning about, because Gitalia
 * abandons the move rather than leaving a rebase open.
 */
export async function moveCommit(commit: Commit, direction: 'up' | 'down') {
  const inspection = await repoStore.inspectRewrite([commit.hash], 'move');
  if (!inspection.ok) {
    await rewriteBlocked('This commit cannot be moved', inspection.problems, 1);
    return;
  }

  const published = inspection.published ?? [];

  // Only the published case is worth stopping for. An unpublished reorder is
  // cheap, reversible with the hash the toast names, and asking every time
  // would make moving three places a five-dialog job.
  if (published.length > 0) {
    const ok = await confirm({
      title: direction === 'up' ? 'Move this commit later?' : 'Move this commit earlier?',
      message:
        'Moving a commit rewrites it and everything after it, so they all get new hashes.',
      tone: 'warning',
      facts: [
        { label: 'Commit', value: `${commit.shortHash}  ${commit.subject}` },
        {
          label: 'Already pushed',
          value: `This history is on ${published.join(', ')}. Publishing the result needs a force push.`,
          tone: 'warning'
        },
        { label: 'If it conflicts', value: 'the move is abandoned and the branch is left as it was' }
      ],
      confirmLabel: 'Move it'
    });
    if (!ok) return;
  }

  await repoStore.move(commit.hash, direction);
}

/* ------------------------------------------------------------------ *
 * Tags
 * ------------------------------------------------------------------ */

/**
 * Name a commit.
 *
 * Asked in two steps because a dialog here holds one field: the name, which
 * is validated, then the message, which is optional. A message makes the tag
 * annotated, recording who made it and when; without one it is a lightweight
 * tag, a plain name pointing at the commit.
 */
export async function createTag(at: string | null, describeTarget: string) {
  const name = await prompt({
    title: 'Create tag',
    message: `The tag will point at ${describeTarget}.`,
    input: {
      label: 'Tag name',
      value: '',
      placeholder: 'v1.0.0',
      validate: validateTagName
    },
    confirmLabel: 'Next'
  });
  if (!name) return;

  const message = await prompt({
    title: `Describe ${name}?`,
    message:
      'A description makes this an annotated tag, which records who made it and when. Leave it empty for a plain tag that plots the commit and nothing else.',
    facts: [
      { label: 'Tag', value: name },
      { label: 'At', value: describeTarget }
    ],
    input: {
      label: 'Description',
      value: '',
      placeholder: 'Optional, for example: the 1.0 release',
      // Empty is a real answer here, so nothing is rejected.
      validate: () => null
    },
    confirmLabel: 'Create tag'
  });
  // Cancelling the second step cancels the tag: the user has not agreed to
  // make one yet, and a half-finished dialog should not write to the
  // repository.
  if (message === null) return;

  await repoStore.createTag(name, at, message);
}

/**
 * Remove a tag.
 *
 * A tag that has been pushed is only removed here, which the dialog has to
 * say: a user who deletes a release tag and assumes it is gone everywhere
 * would be wrong in the way that matters.
 */
export async function deleteTag(name: string) {
  const inspection = await repoStore.inspectTag(name);

  const ok = await confirm({
    title: `Delete tag ${name}?`,
    message: inspection?.annotated
      ? 'The tag and its description are removed. The commit it points at is untouched, and stays in the history.'
      : 'The tag is removed. The commit it points at is untouched, and stays in the history.',
    tone: (inspection?.onRemote.length ?? 0) > 0 ? 'warning' : 'normal',
    facts: [
      { label: 'Tag', value: name },
      ...(inspection
        ? [{ label: 'At', value: `${inspection.shortHash}  ${inspection.subject}` }]
        : []),
      ...(inspection && inspection.onRemote.length > 0
        ? [{
            label: 'Also on',
            value: `${inspection.onRemote.join(', ')}. Deleting here leaves it there, and a fetch can bring it back.`,
            tone: 'warning' as const
          }]
        : []),
      ...(inspection?.unreachable
        ? [{
            label: 'Warning',
            value: 'A remote could not be reached, so the tag may also exist on it.',
            tone: 'warning' as const
          }]
        : [])
    ],
    confirmLabel: 'Delete it'
  });
  if (!ok) return;

  await repoStore.deleteTag(name);
}

/** How far ahead of its upstream a branch is, for a menu hint. */
function aheadHint(branch: Branch): string | undefined {
  if (branch.behind > 0) return `${branch.behind} behind`;
  return branch.ahead > 0 ? `${branch.ahead} ahead` : 'up to date';
}

/** Context menu for a branch or tag in the sidebar. */
export function branchMenuItems(branch: Branch, kind: 'local' | 'remote' | 'tag'): MenuItem[] {
  if (kind === 'tag') {
    return [
      { label: 'Create branch from tag…', icon: 'branch', action: () => createBranchFrom(branch.name, `tag ${branch.name}`) },
      compareWithCurrent(`refs/tags/${branch.name}`, branch.name),
      SEPARATOR,
      {
        label: 'Delete…',
        icon: 'delete',
        danger: true,
        action: () => deleteTag(branch.name)
      },
      SEPARATOR,
      { label: 'Copy tag name', icon: 'copy', action: () => copy(branch.name, branch.name) },
      { label: 'Copy target hash', icon: 'copy', action: () => copy(branch.oid, 'target hash') }
    ];
  }

  const current = repoStore.currentBranch;

  if (kind === 'remote') {
    return [
      { label: 'Check out as local branch', icon: 'switch', action: () => checkoutRemoteBranch(branch) },
      { label: 'Create branch from here…', icon: 'branch', action: () => createBranchFrom(branch.name, branch.name) },
      SEPARATOR,
      {
        label: current ? `Merge into ${current}…` : 'Merge into the current branch…',
        icon: 'merge',
        hint: current ? undefined : 'HEAD is detached',
        disabled: !current,
        action: () => mergeBranch(branch.name)
      },
      compareWithCurrent(`refs/remotes/${branch.name}`, branch.name),
      SEPARATOR,
      { label: 'Copy branch name', icon: 'copy', action: () => copy(branch.name, branch.name) }
    ];
  }

  // A branch does not have to be checked out to be pushed, so these are
  // offered on every local branch. What they cannot do is say what would be
  // sent: only a branch with an upstream has a count, and a branch that has
  // never been pushed has nothing a force could replace.
  const publishable = !!branch.upstream || !!defaultRemote();
  const push: MenuItem[] = [
    {
      label: branch.upstream ? 'Push…' : 'Push and set upstream…',
      icon: 'push',
      hint: branch.isHead ? '⌘⇧U' : (branch.upstream ? aheadHint(branch) : undefined),
      disabled: !publishable,
      action: () => pushBranch(branch.name)
    },
    {
      label: 'Force push…',
      icon: 'force-push',
      danger: true,
      // Without an upstream a force is the same as an ordinary push, so
      // offering it would name a danger that is not there.
      hint: branch.upstream ? 'replaces the remote branch' : 'never pushed',
      disabled: !branch.upstream,
      action: () => forcePushBranch(branch.name)
    }
  ];

  return [
    {
      label: branch.isHead ? 'Already checked out' : `Switch to ${branch.name}`,
      icon: branch.isHead ? 'check' : 'switch',
      hint: branch.isHead ? undefined : '⏎',
      disabled: branch.isHead,
      action: () => switchToBranch(branch.name)
    },
    { label: 'Create branch from here…', icon: 'branch', action: () => createBranchFrom(branch.name, branch.name) },
    SEPARATOR,
    {
      // Merging a branch into itself is the one case Git refuses outright,
      // so it is disabled here rather than explained in a dialog.
      label: branch.isHead
        ? 'Merge into itself'
        : `Merge into ${current ?? 'the current branch'}…`,
      icon: 'merge',
      hint: branch.isHead ? 'checked out' : undefined,
      disabled: branch.isHead || !current,
      action: () => mergeBranch(branch.name)
    },
    ...(branch.isHead ? [] : [compareWithCurrent(`refs/heads/${branch.name}`, branch.name)]),
    ...(branch.isHead
      ? []
      : worktreeStore.elsewhere.has(branch.name)
        ? [{
            label: 'Open its worktree',
            icon: 'folder' as const,
            hint: 'checked out in another folder',
            action: () => {
              const tree = worktreeStore.list.find((t) => t.branch === branch.name);
              if (tree) worktreeStore.open(tree);
            }
          }]
        : [{ label: 'Open in a new worktree…', icon: 'folder' as const, action: () => newWorktree(branch.name) }]),
    SEPARATOR,
    ...push,
    SEPARATOR,
    { label: 'Rename…', icon: 'rename', action: () => renameBranch(branch) },
    {
      label: 'Delete…',
      icon: 'delete',
      danger: true,
      disabled: branch.isHead,
      hint: branch.isHead ? 'checked out' : undefined,
      action: () => deleteBranch(branch)
    },
    SEPARATOR,
    { label: 'Copy branch name', icon: 'copy', action: () => copy(branch.name, branch.name) }
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

/**
 * Commit, then offer to publish the branch.
 *
 * The push is `pushBranch`, not a copy of it: the confirmation, the
 * behind-the-remote case and the force push escape hatch all have to behave
 * the same whether the push follows a commit or stands alone.
 */
export async function commitAndPush() {
  if (!(await commitChanges())) return;
  await pushBranch();
}

/**
 * Merge a branch into the one checked out.
 *
 * The probe asks Git what would conflict before anything is touched, so the
 * dialog can warn about it rather than letting the user find out halfway
 * through. A fast-forward is allowed and named: a user who expected a merge
 * commit should be told why there is not one.
 */
export async function mergeBranch(source: string) {
  const inspection = await repoStore.inspectMerge(source);
  const target = inspection.target ?? repoStore.currentBranch ?? 'HEAD';

  if (!inspection.ok) {
    await confirm({
      title: `${source} cannot be merged`,
      message: inspection.problems.join('\n\n'),
      tone: 'warning',
      facts: [
        { label: 'Merging', value: source },
        { label: 'Into', value: target }
      ],
      confirmLabel: 'Close',
      cancelLabel: 'Back'
    });
    return;
  }

  // Nothing to do. Saying so beats opening a dialog that would merge nothing.
  if (inspection.alreadyMerged || (inspection.commits?.length ?? 0) === 0) {
    toasts.info(
      `${source} is already merged into ${target}`,
      'Every commit on it is already here, so there is nothing to bring in.'
    );
    return;
  }

  const commits = inspection.commits ?? [];
  const shown = commits.slice(0, 5);
  const conflicts = inspection.conflicts ?? [];

  const ok = await confirm({
    title: `Merge ${source} into ${target}?`,
    message: inspection.fastForward
      ? `${target} has no commits of its own, so it moves straight up to ${source}. No merge commit is made.`
      : `The commits on ${source} are joined into ${target} with a merge commit. Nothing on either branch is rewritten.`,
    facts: [
      { label: 'Merging', value: source },
      { label: 'Into', value: target },
      { label: 'Bringing in', value: pluralize(commits.length, 'commit') },
      ...(inspection.changedFiles
        ? [{ label: 'Touching', value: pluralize(inspection.changedFiles, 'file') }]
        : []),
      ...shown.map((c) => ({
        label: 'Incoming',
        value: `${c.shortHash}  ${c.subject} — ${c.author}, ${relativeTime(c.date)}`
      })),
      ...(commits.length > shown.length
        ? [{ label: 'And', value: `${commits.length - shown.length} more` }]
        : []),
      // Git was asked in advance, so this is what would actually clash, not a
      // general warning that a merge might.
      ...(conflicts.length > 0
        ? [
            {
              label: 'Will conflict',
              value: `${pluralize(conflicts.length, 'file')}: ${conflicts.slice(0, 3).join(', ')}${conflicts.length > 3 ? `, and ${conflicts.length - 3} more` : ''}`,
              tone: 'warning' as const
            },
            { label: 'If it conflicts', value: 'Gitalia stops and lets you resolve it, or abandon it.' }
          ]
        : []),
      ...(inspection.fastForward
        ? []
        : [{ label: 'Result', value: 'a merge commit joining the two branches' }])
    ],
    tone: conflicts.length > 0 ? 'warning' : 'normal',
    confirmLabel: inspection.fastForward ? 'Fast-forward' : 'Merge'
  });
  if (!ok) return;

  await repoStore.merge(source);
}

/**
 * Bring the upstream branch in, saying what is coming before it arrives.
 *
 * Gitalia says "behind the remote" in several places and, until now, could
 * only tell the user to go and pull elsewhere. The probe fetches first, so
 * the dialog names the commits that would actually arrive rather than what
 * a stale remote-tracking ref remembers.
 */
export async function pullBranch() {
  const inspection = await repoStore.inspectPull();

  if (!inspection.ok) {
    await confirm({
      title: 'This branch cannot be pulled',
      message: inspection.problems.join('\n\n'),
      tone: 'warning',
      facts: [
        { label: 'Branch', value: inspection.branch ?? repoStore.currentBranch ?? 'detached HEAD' },
        ...(inspection.upstream ? [{ label: 'Tracks', value: inspection.upstream }] : [])
      ],
      confirmLabel: 'Close',
      cancelLabel: 'Back'
    });
    return;
  }

  const commits = inspection.commits ?? [];
  const upstream = inspection.upstream ?? 'the remote';

  // Nothing to bring in. Saying so and stopping is more honest than opening
  // a dialog that would merge nothing.
  if (commits.length === 0) {
    toasts.info(
      `${inspection.branch} is already up to date`,
      inspection.ahead ? `You have ${pluralize(inspection.ahead, 'commit')} to push.` : null
    );
    return;
  }

  const shown = commits.slice(0, 5);
  const ok = await confirm({
    title: `Pull ${inspection.branch}?`,
    message: inspection.fastForward
      ? `Your branch has no commits of its own, so it moves straight up to ${upstream}. Nothing is merged and no merge commit is made.`
      : `${upstream} and your branch have both moved on. Git merges them, making a merge commit. Your own commits are kept as they are.`,
    facts: [
      { label: 'Branch', value: inspection.branch! },
      { label: 'From', value: upstream },
      { label: 'Bringing in', value: pluralize(commits.length, 'commit') },
      ...(inspection.changedFiles
        ? [{ label: 'Touching', value: pluralize(inspection.changedFiles, 'file') }]
        : []),
      ...shown.map((c) => ({
        label: 'Incoming',
        value: `${c.shortHash}  ${c.subject} — ${c.author}, ${relativeTime(c.date)}`
      })),
      ...(commits.length > shown.length
        ? [{ label: 'And', value: `${commits.length - shown.length} more` }]
        : []),
      ...(inspection.fastForward
        ? []
        : [{
            label: 'Your commits',
            value: `${pluralize(inspection.ahead ?? 0, 'commit')} of your own, which stay and are merged with these`,
            tone: 'warning' as const
          }]),
      ...(inspection.fastForward
        ? []
        : [{ label: 'If it conflicts', value: 'Gitalia stops and lets you resolve it, or abandon it.' }]),
      ...(inspection.staleRefs
        ? [{
            label: 'Warning',
            value: 'The remote could not be reached, so this list may be out of date.',
            tone: 'warning' as const
          }]
        : [])
    ],
    tone: inspection.fastForward ? 'normal' : 'warning',
    confirmLabel: inspection.fastForward ? 'Pull' : 'Merge and pull'
  });
  if (!ok) return;

  await repoStore.pull();
}

/**
 * The branch a push acts on: the one named, or the one checked out.
 *
 * A branch does not have to be checked out to be pushed, so the sidebar can
 * hand one in. Returns null, having said why, when there is nothing to push.
 */
function pushTarget(name?: string): Branch | null {
  const branch = name
    ? (repoStore.branches.local.find((b) => b.name === name) ?? null)
    : (repoStore.branches.local.find((b) => b.isHead) ?? null);

  if (!branch) {
    toasts.error(
      'Nothing to push',
      name ? `There is no local branch called ${name}.` : 'HEAD is detached, so there is no branch to publish.'
    );
    return null;
  }
  if (!branch.upstream && !defaultRemote()) {
    toasts.error('No remote configured', `Add a remote before pushing ${branch.name}.`);
    return null;
  }
  return branch;
}

/**
 * Push a branch, stating where it goes before it goes.
 *
 * The plain push of `commitAndPush`, on its own, so the toolbar, the menu and
 * the branch list can offer it without committing anything first. `name`
 * pushes a branch that is not checked out; left out, it is the current one.
 *
 * The dialog carries Force Push as a second way out. Someone who opens this
 * and reads that the branch is behind, or that they amended a pushed commit,
 * has found out here that an ordinary push is not what they want; making them
 * cancel and go looking for the other command would only hide the choice.
 */
export async function pushBranch(name?: string) {
  const branch = pushTarget(name);
  if (!branch) return;
  const remote = defaultRemote();

  // Behind the remote, an ordinary push cannot succeed. Saying so and offering
  // only a button that will fail sends the user off to find another command;
  // the choice belongs here, where the problem was found.
  if (branch.upstream && branch.behind > 0) {
    await pushRejected(branch);
    return;
  }

  const answer = await confirmOr({
    title: `Push ${branch.name}?`,
    message: branch.upstream
      ? 'Your commits are sent to the remote branch this one tracks.'
      : 'This branch has never been pushed. It will be created on the remote and set as the branch to track.',
    facts: [
      { label: 'Branch', value: branch.name },
      { label: 'Target', value: branch.upstream ?? `${remote}/${branch.name} (new)` },
      {
        label: 'Sending',
        value: branch.upstream
          ? pluralize(branch.ahead, 'commit')
          : 'every commit on this branch that the remote does not already have'
      }
    ],
    confirmLabel: 'Push',
    // Nothing on the remote yet means nothing a force could replace, so the
    // option is left off rather than offered as an empty threat.
    extra: branch.upstream
      ? {
          value: 'force',
          label: 'Force push…',
          tone: 'danger',
          title: `Replace ${branch.upstream} with ${branch.name}. You are shown what would be lost first.`
        }
      : undefined
  });

  if (answer === 'force') {
    await forcePushBranch(branch.name);
    return;
  }
  if (answer !== 'confirm') return;

  const outcome = await commitStore.push(
    branch.upstream
      ? { branch: branch.name }
      : { branch: branch.name, remote: remote ?? undefined, setUpstream: true }
  );
  // Someone else pushed between the last fetch and now, so the branch looked
  // up to date when the dialog was built. Offer the same choice here.
  if (outcome === 'rejected') await pushRejected(branch);
}

/**
 * The remote has commits this branch does not, so a push would be refused.
 *
 * Both ways out are offered where the problem appears, rather than leaving the
 * user to go and find the force push command: one keeps what is on the remote,
 * the other replaces it. Force push goes on to its own confirmation, which
 * names the commits it would destroy, so nothing is lost from this dialog
 * alone.
 */
async function pushRejected(branch: Branch) {
  // Pulling is only on offer for the branch you are on: a merge happens in
  // the working tree, which a branch that is not checked out does not have.
  const canPull = branch.isHead;

  const choice = await choose({
    title: `${branch.name} is behind the remote`,
    message:
      'The remote has commits this branch does not, so Git will refuse an ordinary push.',
    choices: [
      ...(canPull
        ? [{
            value: 'pull',
            label: 'Pull, then push',
            detail: 'Brings the remote commits in and merges them with yours. Nothing is lost.'
          }]
        : []),
      {
        value: 'fetch',
        label: 'Fetch and look first',
        detail: 'See what arrived before deciding. Nothing is sent or lost.'
      },
      {
        value: 'force',
        label: 'Force push, replacing the remote',
        detail: 'Discards the commits on the remote that this branch does not have.',
        tone: 'danger'
      }
    ],
    tone: 'warning',
    confirmLabel: 'Continue'
  });

  if (choice === 'pull') {
    await pullBranch();
    return;
  }
  if (choice === 'fetch') {
    await repoStore.fetch();
    return;
  }
  if (choice === 'force') await forcePushBranch(branch.name);
}

/**
 * Replace the remote branch with this one.
 *
 * This is the one push that can destroy work, so what would be lost is read
 * from the repository and listed commit by commit rather than described in the
 * abstract. The commits named are other people's as often as they are the
 * user's, which is exactly why they are named.
 *
 * `name` forces a branch that is not checked out; left out, it is the current
 * one.
 */
export async function forcePushBranch(name?: string) {
  const repo = repoStore.repo;
  if (!repo) return;

  const branch = pushTarget(name);
  if (!branch) return;

  let inspection: ForcePushInspection;
  try {
    inspection = await repo.inspectForcePush(branch.name);
  } catch (err) {
    toasts.error('Could not check the remote', describe(err));
    return;
  }

  // Nothing on the remote to replace: an ordinary push is the honest action,
  // and forcing would claim a danger that is not there.
  if (!inspection.upstream) {
    await pushBranch(branch.name);
    return;
  }

  if (inspection.dropped.length === 0) {
    const ok = await confirm({
      title: `Force push ${branch.name}?`,
      message:
        'The remote holds nothing this branch does not, so nothing would be lost. An ordinary push would do the same thing unless you have rewritten history.',
      facts: [
        { label: 'Branch', value: branch.name },
        { label: 'Target', value: inspection.upstream },
        { label: 'Sending', value: pluralize(inspection.gained, 'commit') }
      ],
      confirmLabel: 'Force push'
    });
    if (!ok) return;
    if ((await commitStore.push({ branch: branch.name, force: true })) === 'rejected') {
      toasts.error(
        'The remote moved',
        'Commits arrived after this was checked, so nothing was sent. Look again before forcing.'
      );
    }
    return;
  }

  const shown = inspection.dropped.slice(0, 5);
  const ok = await confirm({
    title: `Force push ${branch.name}?`,
    message:
      `This replaces ${inspection.upstream} with your branch. ` +
      `${pluralize(inspection.dropped.length, 'commit')} on the remote would be removed. ` +
      'Anyone who has pulled them keeps them, and can push them back.',
    facts: [
      { label: 'Branch', value: branch.name },
      { label: 'Target', value: inspection.upstream },
      { label: 'Sending', value: pluralize(inspection.gained, 'commit') },
      ...shown.map((c) => ({
        label: 'Removing',
        value: `${c.shortHash}  ${c.subject} — ${c.author}, ${relativeTime(c.date)}`,
        tone: 'danger' as const
      })),
      ...(inspection.dropped.length > shown.length
        ? [{
            label: 'And',
            value: `${inspection.dropped.length - shown.length} more`,
            tone: 'danger' as const
          }]
        : []),
      ...(inspection.staleRefs
        ? [{
            label: 'Warning',
            value: 'The remote could not be reached, so this list may be out of date.',
            tone: 'warning' as const
          }]
        : [])
    ],
    tone: 'danger',
    confirmLabel: 'Force push'
  });
  if (!ok) return;

  if ((await commitStore.push({ branch: branch.name, force: true })) === 'rejected') {
    toasts.error(
      'The remote moved',
      'Commits arrived after you were shown what would be lost, so nothing was sent. Look again before forcing.'
    );
  }
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

/** Show what a working tree file would bring to the next commit. */
export function showWorkingTreeDiff(change: Change) {
  commitStore.selected = change.path;
  diffStore.show({
    file: change.path,
    origPath: change.file.origPath ?? null,
    hash: null,
    side: diffSideFor(change),
    stageable: canStageHunks(change),
    source: change.staged
      ? change.unstaged
        ? 'Partially staged'
        : 'Staged'
      : 'Unstaged'
  });
}

/**
 * Open a file as it is meant to be read: a conflicted file lands in the
 * merge editor, where the choice per conflict has to be made; everything else
 * lands in the diff viewer.
 */
export function openChange(change: Change) {
  commitStore.selected = change.path;
  if (change.kind === 'conflict') mergeStore.show(change.path, 'Merge conflict');
  else showWorkingTreeDiff(change);
}

/** The first conflicted path, for the status bar's way into the editor. */
export function resolveNextConflict() {
  const conflicted = (repoStore.status?.files ?? []).filter((f) => f.state === 'conflicted');
  if (conflicted.length === 0) return;
  mergeStore.show(conflicted[0].path, 'Merge conflict');
}

/** Show what one commit did to one file. */
export function showCommitDiff(
  commit: { hash: string; shortHash: string; subject: string },
  file: { path: string; origPath: string | null }
) {
  diffStore.show({
    file: file.path,
    origPath: file.origPath,
    hash: commit.hash,
    source: `${commit.shortHash}  ${commit.subject}`
  });
}

/** Context menu for a file in the commit panel. */
export function changeMenuItems(change: Change): MenuItem[] {
  const ticked = commitStore.isChecked(change.path);
  const items: MenuItem[] = [
    { label: 'Show diff', icon: 'diff', hint: '⏎', action: () => showWorkingTreeDiff(change) },
    ...(change.kind === 'modified' || change.kind === 'renamed'
      ? [{ label: 'Blame', icon: 'commit' as const, hint: 'who changed each line', action: () => blameStore.show(change.path) }]
      : []),
    ...lfsItemFor(change.path),
    SEPARATOR
  ];

  // Staging a conflicted file is how Git is told it is dealt with, and it is
  // the only thing standing between a stopped operation and continuing it.
  if (change.kind === 'conflict') {
    items.push(
      {
        label: 'Resolve in merge editor…',
        icon: 'merge',
        hint: 'choose a side per conflict',
        action: () => mergeStore.show(change.path, 'Merge conflict')
      },
      {
        label: 'Mark as resolved',
        icon: 'check',
        hint: 'lets the operation continue',
        action: () => commitStore.markResolved([change.path])
      },
      SEPARATOR
    );
  }

  return [
    ...items,
    {
      label: ticked ? 'Unstage' : 'Stage',
      icon: ticked ? 'exclude' : 'include',
      hint: commitStore.forced ? 'a merge is in progress' : undefined,
      disabled: commitStore.forced,
      action: () => commitStore.toggle(change)
    },
    SEPARATOR,
    {
      label: 'Roll back…',
      icon: 'rollback',
      danger: true,
      hint: change.kind === 'unversioned' ? 'not versioned' : undefined,
      disabled: change.kind === 'unversioned',
      action: () => rollbackChanges([change])
    },
    SEPARATOR,
    { label: 'Copy path', icon: 'copy', action: () => copy(change.path, change.path) },
    {
      label: 'Copy full path',
      icon: 'copy',
      action: () => copy(`${repoStore.info?.root ?? ''}/${change.path}`, 'full path')
    }
  ];
}


/* ------------------------------------------------------------------ *
 * Copying, undoing and moving commits
 * ------------------------------------------------------------------ */

/** Shared opening: run the probe, and show any reason it cannot go ahead. */
async function blockedByProbe(
  title: string,
  problems: string[],
  count: number
): Promise<void> {
  await confirm({
    title,
    message: problems.join('\n\n'),
    tone: 'warning',
    facts: [{ label: 'Selected', value: pluralize(count, 'commit') }],
    confirmLabel: 'Close',
    cancelLabel: 'Back'
  });
}

/** A short list of the commits an operation would touch. */
function commitFacts(commits: Commit[], limit = 4): DialogFact[] {
  const facts = commits
    .slice(0, limit)
    .map((c) => ({ label: 'Commit', value: `${c.shortHash}  ${c.subject}` }));
  if (commits.length > limit) {
    facts.push({ label: 'And', value: `${commits.length - limit} more` });
  }
  return facts;
}

/**
 * Copy commits onto the current branch.
 *
 * `commits` arrives newest first. They are applied oldest first, so they land
 * in the order they were written.
 */
export async function cherryPickCommits(commits: Commit[]) {
  if (commits.length === 0) return;
  const hashes = commits.map((c) => c.hash);
  const inspection = await repoStore.inspectApply(hashes, 'cherry-pick');

  if (!inspection.ok) {
    await blockedByProbe('These commits cannot be copied', inspection.problems, commits.length);
    return;
  }

  const warnings = inspection.warnings ?? [];
  const ok = await confirm({
    title: commits.length === 1 ? 'Copy this commit?' : `Copy ${commits.length} commits?`,
    message:
      'Each commit is applied again on top of this branch, as a new commit with a new hash. The originals stay where they are.',
    tone: warnings.length > 0 ? 'warning' : 'normal',
    facts: [
      { label: 'Onto', value: inspection.branch ?? 'detached HEAD' },
      ...commitFacts(commits),
      ...warnings.map((value) => ({ label: 'Note', value, tone: 'warning' as const })),
      { label: 'If it conflicts', value: 'Gitalia stops and lets you resolve it, or abandon it.' }
    ],
    confirmLabel: commits.length === 1 ? 'Copy commit' : `Copy ${commits.length} commits`
  });
  if (!ok) return;

  await repoStore.cherryPick(hashes);
}

/**
 * Undo commits by making new ones that reverse them.
 *
 * Applied newest first, which is the order that works: undoing an older change
 * before a newer one built on it would conflict for no reason.
 */
export async function revertCommits(commits: Commit[]) {
  if (commits.length === 0) return;
  const hashes = commits.map((c) => c.hash);
  const inspection = await repoStore.inspectApply(hashes, 'revert');

  if (!inspection.ok) {
    await blockedByProbe('These commits cannot be reverted', inspection.problems, commits.length);
    return;
  }

  const merges = commits.filter((c) => c.parents.length > 1);
  const warnings = inspection.warnings ?? [];

  const ok = await confirm({
    title: commits.length === 1 ? 'Revert this commit?' : `Revert ${commits.length} commits?`,
    message:
      'Nothing is removed from history. Gitalia adds a new commit that undoes the change, so the record of both stays.',
    tone: warnings.length > 0 || merges.length > 0 ? 'warning' : 'normal',
    facts: [
      { label: 'On', value: inspection.branch ?? 'detached HEAD' },
      ...commitFacts(commits),
      ...(merges.length > 0
        ? [{
            label: 'Merge commit',
            // A merge joins two histories, so Git has to be told which one to
            // treat as the trunk. The first parent is the branch merged into.
            value: 'A merge joins two histories. Gitalia undoes it against the first parent, which is the branch it was merged into.',
            tone: 'warning' as const
          }]
        : []),
      ...warnings.map((value) => ({ label: 'Note', value, tone: 'warning' as const })),
      { label: 'If it conflicts', value: 'Gitalia stops and lets you resolve it, or abandon it.' }
    ],
    confirmLabel: commits.length === 1 ? 'Revert commit' : `Revert ${commits.length} commits`
  });
  if (!ok) return;

  await repoStore.revert(hashes);
}

/**
 * Move the current branch to another commit.
 *
 * The plan asks for dangerous operations to be shown before they run
 * (section 3.2). Reset is the sharpest of them, because `--hard` throws away
 * uncommitted work without asking, so the dialog states the cost of each mode
 * beside the mode itself.
 */
export async function resetToCommit(commit: Commit) {
  const inspection = await repoStore.inspectReset(commit.hash);
  if (!inspection.ok) {
    await confirm({
      title: 'Cannot reset now',
      message: inspection.problems.join('\n\n'),
      tone: 'warning',
      confirmLabel: 'Close',
      cancelLabel: 'Back'
    });
    return;
  }

  const dropped = inspection.dropped ?? 0;
  const gained = inspection.gained ?? 0;
  const dirty = inspection.dirty ?? 0;
  const published = inspection.published ?? [];

  if (dropped === 0 && gained === 0) {
    await confirm({
      title: 'The branch is already here',
      message: `${inspection.branch ?? 'HEAD'} already points at ${commit.shortHash}, so a reset would change nothing.`,
      confirmLabel: 'Close',
      cancelLabel: 'Back'
    });
    return;
  }

  const facts: DialogFact[] = [
    { label: 'Branch', value: inspection.branch ?? 'detached HEAD' },
    { label: 'Moving to', value: `${commit.shortHash}  ${commit.subject}` }
  ];

  if (dropped > 0) {
    facts.push({
      label: 'Leaving behind',
      value: `${pluralize(dropped, 'commit')} would no longer be on this branch`,
      tone: 'warning'
    });
    facts.push(
      published.length > 0
        ? { label: 'Still on', value: `${published.join(', ')}, so those commits can be recovered from there` }
        : {
            label: 'Recovery',
            value: 'Those commits are only here. They stay in the reflog for a while, and the message after the reset tells you how to return.',
            tone: 'warning'
          }
    );
  }
  if (gained > 0) {
    facts.push({ label: 'Moving forward', value: `${pluralize(gained, 'commit')} would join this branch` });
  }
  if (dirty > 0) {
    facts.push({ label: 'Uncommitted', value: `${pluralize(dirty, 'changed file')} in your working tree`, tone: 'warning' });
  }

  const mode = await choose({
    title: `Reset ${inspection.branch ?? 'HEAD'} to ${commit.shortHash}?`,
    message: 'The branch label moves. What happens to the files in your working tree is up to you.',
    tone: dropped > 0 ? 'warning' : 'normal',
    facts,
    chosen: 'mixed',
    choices: [
      {
        value: 'soft',
        label: 'Soft',
        detail:
          'Your files do not change. Everything from the commits you leave behind is kept staged, ready to be committed again.'
      },
      {
        value: 'mixed',
        label: 'Mixed',
        detail:
          'Your files do not change, and nothing is staged. This is the usual choice.'
      },
      {
        value: 'hard',
        label: 'Hard',
        tone: 'danger',
        detail:
          dirty > 0
            ? `Your files are made to match ${commit.shortHash}. The ${pluralize(dirty, 'changed file')} you have not committed will be destroyed and cannot be recovered.`
            : `Your files are made to match ${commit.shortHash}. Any uncommitted work would be destroyed.`
      }
    ],
    confirmLabel: 'Reset'
  });
  if (!mode) return;

  // A hard reset is the one action here that destroys work Git has never seen,
  // so it is confirmed twice when there is work to destroy.
  if (mode === 'hard' && dirty > 0) {
    const sure = await confirm({
      title: 'Destroy your uncommitted work?',
      message:
        'A hard reset overwrites the files in your working tree. Changes Git has never seen cannot be recovered by any means.',
      tone: 'danger',
      facts: [
        { label: 'Losing', value: `${pluralize(dirty, 'changed file')}`, tone: 'danger' },
        { label: 'Untracked files', value: `${inspection.untracked ?? 0} are left alone` },
        { label: 'Instead', value: 'Cancel and commit or stash the changes first.' }
      ],
      confirmLabel: 'Destroy them'
    });
    if (!sure) return;
  }

  await repoStore.reset(commit.hash, mode as ResetMode);
}

/** Abandon a half-finished merge, rebase, cherry-pick or revert. */
export async function abortOperation() {
  const operation = repoStore.status?.operation;
  if (!operation) return;
  const conflicts = repoStore.status?.files.filter((f) => f.state === 'conflicted').length ?? 0;

  const ok = await confirm({
    title: `Abandon the ${operation}?`,
    message: `The branch goes back to where it was before the ${operation} started. Any conflict resolution you have done is thrown away.`,
    tone: 'danger',
    facts: [
      { label: 'Operation', value: operation },
      ...(conflicts > 0
        ? [{ label: 'Unresolved', value: pluralize(conflicts, 'conflicted file'), tone: 'warning' as const }]
        : []),
      { label: 'After this', value: 'the working tree is as it was before it started' }
    ],
    confirmLabel: `Abandon the ${operation}`
  });
  if (!ok) return;
  rebaseStore.stop = null;
  await repoStore.abortOperation();
}

/**
 * Carry on with the half-finished operation.
 *
 * A rebase that paused at an `edit` keeps its plan in the editor, so carrying
 * on means going back through that plan with the messages it carried. The
 * other operations need no plan to continue.
 */
export async function continueOperation() {
  if (repoStore.status?.operation === 'rebase' && rebaseStore.stop) return rebaseStore.continue();
  return repoStore.continueOperation();
}


/* ------------------------------------------------------------------ *
 * Stashes
 * ------------------------------------------------------------------ */

/**
 * Put the ticked files aside.
 *
 * This is `git stash`, so anything set aside here is an ordinary stash that
 * the command line can also reach.
 */
export async function stashChanges(changes: Change[]) {
  if (changes.length === 0) return;

  const untracked = changes.filter((c) => c.kind === 'unversioned');
  const branch = repoStore.currentBranch ?? 'detached HEAD';

  const message = await prompt({
    title: changes.length === 1 ? 'Stash 1 file' : `Stash ${changes.length} files`,
    message:
      'The changes are saved and taken out of your working tree, leaving it as though you had not made them. You can put them back at any time.',
    facts: [
      { label: 'Branch', value: branch },
      { label: 'Files', value: pluralize(changes.length, 'file') },
      ...(untracked.length > 0
        ? [{ label: 'Including', value: `${pluralize(untracked.length, 'unversioned file')}, which will be removed from disk until you put them back`, tone: 'warning' as const }]
        : []),
      { label: 'Stored as', value: 'a Git stash, so "git stash list" shows it too' }
    ],
    input: {
      label: 'Name',
      value: '',
      placeholder: 'What you are setting aside',
      validate: () => null // Git writes its own name when this is left empty
    },
    confirmLabel: 'Stash'
  });
  if (message === null) return;

  await commitStore.stash(message, changes.map((c) => c.path), untracked.length > 0);
}

/** Put a stash back into the working tree. */
export async function unstash(stash: Stash, drop: boolean) {
  const dirty = repoStore.dirtyFileCount;

  const ok = await confirm({
    title: drop ? 'Unstash this change?' : 'Apply this stash and keep it?',
    message: drop
      ? 'The change goes back into your working tree and the stash is removed.'
      : 'The change goes back into your working tree and the stash stays as well.',
    tone: dirty > 0 ? 'warning' : 'normal',
    facts: [
      { label: 'Stash', value: stash.message || '(no name)' },
      { label: 'From', value: `${stash.branch ?? 'an unknown branch'}, ${relativeTime(stash.date)}` },
      ...(dirty > 0
        ? [{
            label: 'Your work',
            value: `${pluralize(dirty, 'changed file')} in the working tree. If the stash touches the same lines, you will get conflicts to resolve.`,
            tone: 'warning' as const
          }]
        : []),
      ...(drop
        ? [{ label: 'If it conflicts', value: 'the stash is kept, so nothing is lost' }]
        : [])
    ],
    confirmLabel: drop ? 'Unstash' : 'Apply and keep'
  });
  if (!ok) return;

  await commitStore.unstash(stash, drop);
}

export async function deleteStash(stash: Stash) {
  const ok = await confirm({
    title: 'Delete this stash?',
    message:
      'The change is thrown away. It is not in any commit and not in your working tree, so this cannot be undone through Gitalia.',
    tone: 'danger',
    facts: [
      { label: 'Stash', value: stash.message || '(no name)' },
      { label: 'From', value: `${stash.branch ?? 'an unknown branch'}, ${relativeTime(stash.date)}` },
      { label: 'Instead', value: 'Cancel and unstash it first if you want to keep the work.' }
    ],
    confirmLabel: 'Delete it'
  });
  if (!ok) return;
  await commitStore.dropStash(stash);
}

/** Show what one file inside a stash holds. */
export function showStashedDiff(stash: Stash, file: StashFile) {
  diffStore.show({
    file: file.path,
    origPath: file.origPath,
    // A file that was untracked when it was stashed sits in a third parent of
    // the stash commit, with nothing to compare it against but the empty tree.
    hash: file.untracked ? `${stash.ref}^3` : stash.ref,
    base: file.untracked ? EMPTY_TREE : `${stash.ref}^1`,
    source: `Stash: ${stash.message || '(no name)'}`
  });
}

/** Context menu for a stash. */
export function stashMenuItems(stash: Stash): MenuItem[] {
  return [
    { label: 'Unstash…', icon: 'unstash', hint: 'apply and remove', action: () => unstash(stash, true) },
    { label: 'Apply and keep…', icon: 'stash', action: () => unstash(stash, false) },
    SEPARATOR,
    { label: 'Delete…', icon: 'delete', danger: true, action: () => deleteStash(stash) },
    SEPARATOR,
    { label: 'Copy name', icon: 'copy', action: () => copy(stash.message || stash.ref, 'name') },
    { label: 'Copy stash reference', icon: 'copy', action: () => copy(stash.ref, stash.ref) }
  ];
}


/** Ask for a file, then show who last changed each of its lines. */
export async function blameFile() {
  const file = await prompt({
    title: 'Blame a file',
    message: 'Shows which commit last changed each line of the file, as it is in the working tree.',
    input: {
      label: 'File path, relative to the repository',
      value: blameStore.request?.file ?? '',
      placeholder: 'src/app.ts',
      validate: (value) => (value.trim() ? null : 'Type the path of a file.')
    },
    confirmLabel: 'Blame'
  });
  if (file) await blameStore.show(file.trim());
}


/**
 * Start a bisect: `good` works, `bad` (HEAD unless named) does not.
 *
 * Git then checks out commits between them one at a time, and the status bar
 * asks whether each one is good or bad.
 */
export async function startBisect(good: Commit, bad?: Commit) {
  if (repoStore.status?.operation) {
    toasts.error('Cannot start a bisect', `A ${repoStore.status.operation} is in progress. Finish or abandon it first.`);
    return;
  }
  const badName = bad ? `${bad.shortHash} (${bad.subject})` : `HEAD (${repoStore.currentBranch ?? 'detached'})`;
  const ok = await confirm({
    title: 'Find the commit that broke it',
    message:
      'Git checks out a commit halfway between the good one and the bad one. Test it, then press Good or Bad in the status bar. Each answer halves what is left, until the first bad commit remains. Stop returns you to your branch.',
    facts: [
      { label: 'Works at', value: `${good.shortHash} (${good.subject})` },
      { label: 'Broken at', value: badName },
      ...(repoStore.isDirty ? [{ label: 'Your changes', value: 'Git refuses to check out a commit that would overwrite them. Stash or commit them first.', tone: 'warning' as const }] : [])
    ],
    confirmLabel: 'Start bisect'
  });
  if (!ok) return;
  await bisectStore.start(good.hash, bad?.hash ?? 'HEAD');
}


/**
 * A menu entry that compares a branch or tag with where HEAD is: the current
 * branch, or the commit HEAD is detached at.
 */
function compareWithCurrent(ref: string, label: string): MenuItem {
  const current = repoStore.currentBranch;
  return {
    label: `Compare with ${current ?? 'HEAD'}`,
    icon: 'diff',
    hint: 'commits and files that differ',
    action: () => compareStore.show(current ? `refs/heads/${current}` : 'HEAD', ref, { base: current ?? 'HEAD', target: label })
  };
}


/* ------------------------------------------------------------------ *
 * Worktrees
 * ------------------------------------------------------------------ */

/** A folder beside the repository, named after it and the branch. */
function worktreeFolder(branch: string) {
  const repo = repoStore.info?.name ?? 'repo';
  return `../${repo}-${branch.replace(/[^\w.-]+/g, '-')}`;
}

/**
 * Make a worktree: for an existing branch when one is named, otherwise for a
 * new branch that starts at the selected commit, or HEAD.
 */
export async function newWorktree(existing?: string) {
  let branch = existing;
  if (!branch) {
    const name = await prompt({
      title: 'New worktree',
      message: `A new branch, checked out in a folder of its own. It starts at ${repoStore.cursor ? 'the selected commit' : 'HEAD'}.`,
      input: { label: 'Branch name', value: '', placeholder: 'feature/my-change', validate: validateBranchName },
      confirmLabel: 'Next'
    });
    if (!name) return;
    branch = name;
  }
  const dir = await prompt({
    title: `Worktree for ${branch}`,
    message: 'The folder to check the branch out in. A relative path starts from the folder that holds this repository.',
    input: {
      label: 'Folder',
      value: worktreeFolder(branch),
      validate: (value) => (value.trim() ? null : 'Name a folder.')
    },
    confirmLabel: 'Make worktree'
  });
  if (!dir) return;
  const made = await worktreeStore.add(dir.trim(), branch, !existing, existing ? null : repoStore.cursor);
  if (made) {
    const open = await confirm({
      title: 'Open the new worktree?',
      message: `${branch} is checked out in ${made}. Gitalia can switch to it now, or you can open it later from the Worktrees list.`,
      confirmLabel: 'Open it',
      cancelLabel: 'Stay here'
    });
    if (open) await repoStore.open(made);
  }
}

async function removeWorktree(tree: Worktree) {
  const name = tree.branch ?? `detached at ${tree.head?.slice(0, 7)}`;
  const choice = await confirmOr({
    title: `Remove the worktree for ${name}?`,
    message: 'Its folder is deleted. The branch and its commits stay in the repository.',
    facts: [{ label: 'Folder', value: tree.path }],
    tone: 'warning',
    confirmLabel: 'Remove',
    extra: { label: 'Remove, and throw away uncommitted changes', value: 'force', tone: 'danger' }
  });
  if (choice === 'confirm') await worktreeStore.remove(tree, false);
  else if (choice === 'force') await worktreeStore.remove(tree, true);
}

/** Context menu for a worktree in the Branches panel. */
export function worktreeMenuItems(tree: Worktree): MenuItem[] {
  return [
    {
      label: tree.current ? 'Open (it is open now)' : 'Open in Gitalia',
      icon: 'switch',
      disabled: tree.current || tree.prunable,
      action: () => worktreeStore.open(tree)
    },
    { label: 'Copy folder path', icon: 'copy', action: () => copy(tree.path, 'folder path') },
    SEPARATOR,
    ...(tree.prunable
      ? [{ label: 'Forget it (its folder is gone)', icon: 'delete' as const, action: () => worktreeStore.prune() }]
      : [{
          label: 'Remove…',
          icon: 'delete' as const,
          danger: true,
          hint: tree.main ? 'the main worktree' : tree.current ? 'open now' : undefined,
          disabled: tree.main || tree.current,
          action: () => removeWorktree(tree)
        }])
  ];
}


/* ------------------------------------------------------------------ *
 * Submodules
 * ------------------------------------------------------------------ */

const SUBMODULE_STATE: Record<Submodule['state'], string> = {
  clean: 'at the recorded commit',
  moved: 'checked out at another commit',
  'not-initialized': 'not checked out yet',
  conflicted: 'in a merge conflict'
};

export function describeSubmodule(sub: Submodule): string {
  return [
    sub.path,
    sub.url ? `from ${sub.url}` : null,
    SUBMODULE_STATE[sub.state],
    sub.recorded ? `recorded: ${sub.recorded.slice(0, 7)}` : null,
    sub.checkedOut && sub.checkedOut !== sub.recorded ? `checked out: ${sub.checkedOut.slice(0, 7)}` : null
  ].filter(Boolean).join('\n');
}

/** Context menu for a submodule in the Branches panel. */
export function submoduleMenuItems(sub: Submodule): MenuItem[] {
  return [
    {
      label: 'Open in Gitalia',
      icon: 'switch',
      hint: sub.state === 'not-initialized' ? 'update it first' : undefined,
      disabled: sub.state === 'not-initialized',
      action: () => submoduleStore.open(sub)
    },
    {
      label: sub.state === 'not-initialized' ? 'Check out' : 'Update to the recorded commit',
      icon: 'refresh',
      hint: sub.state === 'clean' ? 'already there' : undefined,
      disabled: sub.state === 'clean' || sub.state === 'conflicted',
      action: () => submoduleStore.update([sub.path])
    },
    SEPARATOR,
    { label: 'Copy path', icon: 'copy', action: () => copy(sub.path, 'path') },
    ...(sub.url ? [{ label: 'Copy URL', icon: 'copy' as const, action: () => copy(sub.url!, 'URL') }] : [])
  ];
}


/** "Store *.ext files in Git LFS", for a file whose kind is not tracked yet. */
function lfsItemFor(path: string): MenuItem[] {
  const status = lfsStore.status;
  const ext = /\.([A-Za-z0-9]+)$/.exec(path)?.[1];
  if (!status?.installed || !status.ready || !ext) return [];
  const pattern = `*.${ext}`;
  if (status.patterns.some((p) => p.pattern === pattern)) return [];
  return [{ label: `Store ${pattern} files in Git LFS`, icon: 'folder', hint: 'from now on', action: () => lfsStore.track(pattern, true) }];
}


/* ------------------------------------------------------------------ *
 * Patches and bundles
 * ------------------------------------------------------------------ */

/** Hand a file to be saved: a save dialog in the app, a download in the browser. */
async function download(name: string, data: Uint8Array | string, type: string) {
  return saveFile(name, data, type);
}

/** Ask for one local file, or null when the user closes the chooser. */
function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** Save commits as a patch file that `git am` or Gitalia can apply elsewhere. */
export async function savePatch(commits: Commit[]) {
  const repo = repoStore.repo;
  if (!repo || commits.length === 0) return;
  try {
    const patch = await repo.createPatch(commits.map((c) => c.hash));
    if (!(await download(patch.name, patch.content, 'text/x-patch'))) return;
    toasts.success(`Saved ${pluralize(patch.commits, 'commit')} as a patch`, patch.name);
  } catch (err) {
    toasts.error('Could not save the patch', describe(err));
  }
}

/** Choose a patch file and apply it: as commits if it has them, else to the files. */
export async function applyPatchFile() {
  const repo = repoStore.repo;
  if (!repo) return;
  const file = await pickFile('.patch,.diff,.mbox,text/*');
  if (!file) return;
  const patch = await file.text();
  const carriesCommits = /^From [0-9a-f]{40} /m.test(patch);
  const ok = await confirm({
    title: `Apply ${file.name}?`,
    message: carriesCommits
      ? 'The patch carries commits. They are added on top of the current branch, with their authors and messages.'
      : 'The patch is a plain diff. It changes the files, and the change then waits in the commit panel.',
    facts: [
      { label: 'Onto', value: repoStore.currentBranch ?? 'the detached HEAD' },
      { label: 'If it does not fit', value: 'Nothing is changed.' }
    ],
    confirmLabel: 'Apply'
  });
  if (!ok) return;
  try {
    const result = await repo.applyPatch(patch);
    await repoStore.refresh();
    toasts.success(
      result.mode === 'commits' ? `Applied ${pluralize(result.commits, 'commit')}` : 'Applied the patch to the files',
      result.mode === 'files' ? 'The change is in the commit panel.' : null
    );
  } catch (err) {
    toasts.error('Could not apply the patch', describe(err));
  }
}

/** Save every branch and tag as one bundle file. */
export async function exportBundle() {
  const repo = repoStore.repo;
  if (!repo) return;
  try {
    const bundle = await repo.createBundle();
    const bytes = Uint8Array.from(atob(bundle.base64), (c) => c.charCodeAt(0));
    if (!(await download(bundle.name, bytes, 'application/octet-stream'))) return;
    toasts.success('Saved the bundle', `${bundle.name}, ${Math.max(1, Math.round(bundle.bytes / 1024))} KB. Anyone can clone or fetch from it.`);
  } catch (err) {
    toasts.error('Could not save the bundle', describe(err));
  }
}

/** Bring a bundle's branches and tags in, as if from a remote. */
export async function importBundle() {
  const repo = repoStore.repo;
  if (!repo) return;
  const file = await pickFile('.bundle,application/octet-stream');
  if (!file) return;
  const name = await prompt({
    title: `Import ${file.name}`,
    message: 'Its branches arrive under this name, the way a remote\'s do. No branch of this repository moves.',
    input: {
      label: 'Name',
      value: file.name.replace(/\.bundle$/, '').replace(/[^A-Za-z0-9._-]+/g, '-') || 'bundle',
      validate: (value) => (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) ? null : 'Use letters, numbers, dots, dashes or underscores.')
    },
    confirmLabel: 'Import'
  });
  if (!name) return;
  try {
    const buffer = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let i = 0; i < buffer.length; i += 0x8000) binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
    const result = await repo.importBundle(btoa(binary), name);
    await repoStore.refresh();
    toasts.success(`Imported ${pluralize(result.branches.length, 'branch', 'branches')}`, result.branches.join(', '));
  } catch (err) {
    toasts.error('Could not import the bundle', describe(err));
  }
}
