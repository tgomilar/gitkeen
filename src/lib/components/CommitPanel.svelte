<script lang="ts">
  /**
   * The commit tool window, built to work the way IntelliJ IDEA's does.
   *
   * Two groups: files Git already tracks, and files it has never seen. Tracked
   * changes arrive ticked, unversioned files arrive unticked, and ticking a
   * box writes nothing to Git. Only the Commit button does.
   */
  import Icon from './Icon.svelte';
  import TriCheckbox from './TriCheckbox.svelte';
  import ChangeRow from './ChangeRow.svelte';
  import ChangeTreeNode from './ChangeTreeNode.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import ShelfSection from './ShelfSection.svelte';
  import { repoStore } from '../state/repo.svelte';
  import { commitStore } from '../state/commit.svelte';
  import {
    commitChanges, commitAndPush, rollbackChanges, changeMenuItems, showWorkingTreeDiff,
    shelveChanges, stashMenuItems
  } from '../actions';
  import { buildChangeTree } from '../changes';
  import { pluralize } from '../format';
  import type { Change } from '../changes';
  import type { Stash } from '../git/types';
  import type { MenuItem } from '../menu';

  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
  let messageBox = $state<HTMLTextAreaElement | null>(null);

  const changes = $derived(commitStore.changes);
  const unversioned = $derived(commitStore.unversioned);
  const empty = $derived(changes.length === 0 && unversioned.length === 0);
  const operation = $derived(repoStore.status?.operation ?? null);

  const groups = $derived([
    { key: 'changes', title: 'Changes', items: changes },
    { key: 'unversioned', title: 'Unversioned Files', items: unversioned }
  ]);

  /** Follow HEAD, so "Amend" always names the commit it would replace. */
  $effect(() => {
    commitStore.syncHead(repoStore.head?.oid ?? null);
  });

  /** Every collapsible key on screen, for the collapse-all button. */
  const allKeys = $derived.by(() => {
    const keys = [...groups.map((g) => g.key), 'shelf'];
    if (!commitStore.groupByDirectory) return keys;
    const walk = (nodes: ReturnType<typeof buildChangeTree>) => {
      for (const node of nodes) {
        if (node.change) continue;
        keys.push(node.path);
        walk(node.children);
      }
    };
    for (const group of groups) walk(buildChangeTree(group.items));
    return keys;
  });

  const checkedChanges = $derived(
    [...changes, ...unversioned].filter((c) => commitStore.isChecked(c.path))
  );

  function openMenu(change: Change, event: MouseEvent) {
    event.preventDefault();
    menu = { x: event.clientX, y: event.clientY, items: changeMenuItems(change) };
  }

  function openStashMenu(stash: Stash, event: MouseEvent) {
    event.preventDefault();
    menu = { x: event.clientX, y: event.clientY, items: stashMenuItems(stash) };
  }

  /** ⌘⏎ commits, the shortcut IntelliJ uses from the message box. */
  function onMessageKey(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      if (commitStore.canCommit) commitChanges();
    }
  }

  export function focusMessage() {
    messageBox?.focus();
  }
</script>

<section class="panel">
  <div class="toolbar">
    <button
      class="tool"
      onclick={() => repoStore.refresh()}
      disabled={repoStore.refreshing}
      title="Refresh the list of changes (⌘R)"
      aria-label="Refresh"
    >
      <Icon name="refresh" size={14} />
    </button>
    <button
      class="tool"
      onclick={() => rollbackChanges(checkedChanges)}
      disabled={checkedChanges.length === 0}
      title={checkedChanges.length === 0
        ? 'Tick the files to roll back'
        : `Roll back the ${checkedChanges.length} ticked ${checkedChanges.length === 1 ? 'file' : 'files'}`}
      aria-label="Roll back ticked files"
    >
      <Icon name="rollback" size={14} />
    </button>

    <button
      class="tool"
      onclick={() => shelveChanges(checkedChanges)}
      disabled={checkedChanges.length === 0}
      title={checkedChanges.length === 0
        ? 'Tick the files to shelve'
        : `Set the ${checkedChanges.length} ticked ${checkedChanges.length === 1 ? 'file' : 'files'} aside, and take them out of the working tree`}
      aria-label="Shelve ticked files"
    >
      <Icon name="shelve" size={14} />
    </button>

    <span class="gap"></span>

    <button
      class="tool"
      class:on={commitStore.groupByDirectory}
      onclick={() => (commitStore.groupByDirectory = !commitStore.groupByDirectory)}
      title={commitStore.groupByDirectory ? 'Show a flat list of files' : 'Group files by directory'}
      aria-pressed={commitStore.groupByDirectory}
      aria-label="Group by directory"
    >
      <Icon name="tree" size={14} />
    </button>
    <button class="tool" onclick={() => commitStore.expandAll()} title="Expand all" aria-label="Expand all">
      <Icon name="expand" size={14} />
    </button>
    <button
      class="tool"
      onclick={() => commitStore.collapseAll(allKeys)}
      title="Collapse all"
      aria-label="Collapse all"
    >
      <Icon name="collapse" size={14} />
    </button>
  </div>

  {#if operation}
    <p class="banner warn">
      A {operation} is in progress. Git cannot commit part of the working tree until it
      finishes, so this commit takes everything in it.
    </p>
  {/if}

  <div class="scroll">
    {#if empty}
      <p class="empty">
        Nothing has changed.<br />
        <span class="faint">Edited and new files appear here as you work.</span>
      </p>
    {:else}
      {#each groups as group (group.key)}
        {@const open = !commitStore.collapsed.has(group.key)}
        {@const state = commitStore.groupState(group.items.map((c) => c.path))}
        <div class="group-head">
          <TriCheckbox
            checkState={state}
            disabled={commitStore.forced || group.items.length === 0}
            label="Include all {group.title.toLowerCase()} in the commit"
            onchange={() => commitStore.toggleGroup(group.items)}
          />
          <button
            class="disclosure"
            onclick={() => commitStore.toggleCollapsed(group.key)}
            aria-expanded={open}
            disabled={group.items.length === 0}
          >
            <span class="chevron" class:open aria-hidden="true">›</span>
            <span class="title">{group.title}</span>
            <span class="count">
              {group.items.length === 0 ? 'none' : pluralize(group.items.length, 'file')}
            </span>
          </button>
        </div>

        {#if open && group.items.length > 0}
          {#if commitStore.groupByDirectory}
            {#each buildChangeTree(group.items) as node (node.path + (node.change ? ':f' : ''))}
              <ChangeTreeNode
                {node}
                depth={0}
                collapsed={commitStore.collapsed}
                disabled={commitStore.forced}
                isChecked={(p) => commitStore.isChecked(p)}
                selected={commitStore.selected}
                groupState={(p) => commitStore.groupState(p)}
                ontoggleNode={(key) => commitStore.toggleCollapsed(key)}
                ontoggleCheck={(items, on) => commitStore.setChecked(items, on)}
                onselect={(c) => (commitStore.selected = c.path)}
                onopen={showWorkingTreeDiff}
                onmenu={openMenu}
              />
            {/each}
          {:else}
            {#each group.items as change (change.path)}
              <ChangeRow
                {change}
                indent={22}
                showDir={true}
                checked={commitStore.isChecked(change.path)}
                selected={commitStore.selected === change.path}
                disabled={commitStore.forced}
                ontoggle={() => commitStore.toggle(change)}
                onselect={() => (commitStore.selected = change.path)}
                onopen={() => showWorkingTreeDiff(change)}
                onmenu={(e) => openMenu(change, e)}
              />
            {/each}
          {/if}
        {/if}
      {/each}
    {/if}

    {#if !empty || repoStore.stashes.length > 0}
      <ShelfSection
        open={!commitStore.collapsed.has('shelf')}
        ontoggle={() => commitStore.toggleCollapsed('shelf')}
        onmenu={openStashMenu}
      />
    {/if}
  </div>

  <div class="compose">
    <div class="options">
      <label class="amend" class:disabled={!commitStore.head?.exists}>
        <TriCheckbox
          checkState={commitStore.amend ? 'all' : 'none'}
          disabled={!commitStore.head?.exists}
          label="Amend the previous commit"
          onchange={() => commitStore.setAmend(!commitStore.amend)}
        />
        <span>Amend</span>
      </label>
      {#if commitStore.amend && commitStore.head}
        <span class="amend-target" title={commitStore.head.subject}>
          replaces {commitStore.head.hash?.slice(0, 7)}
          {#if commitStore.head.pushed}
            <span class="pushed" title="Already on {commitStore.head.pushed}. Amending needs a force push.">
              pushed
            </span>
          {/if}
        </span>
      {/if}
    </div>

    <textarea
      bind:this={messageBox}
      bind:value={commitStore.message}
      onkeydown={onMessageKey}
      placeholder="Commit Message"
      spellcheck="true"
      aria-label="Commit message"
      aria-invalid={commitStore.messageCheck.blocking.length > 0}
      aria-describedby="commit-rules"
      class:invalid={commitStore.messageCheck.blocking.length > 0}
    ></textarea>

    <!--
      The rules the message is held to, and how it currently measures up.
      Kept directly under the box so the reason a commit is blocked is read
      in the same glance as the message that caused it.
    -->
    <div class="rules" id="commit-rules" aria-live="polite">
      {#if commitStore.messageCheck.problems.length > 0}
        {#each commitStore.messageCheck.problems as problem (problem.rule)}
          <p class="problem" class:warning={problem.level === 1}>
            <span class="mark" aria-hidden="true">{problem.level === 1 ? '⚠' : '✖'}</span>
            {problem.message}
          </p>
        {/each}
        {#if commitStore.rules?.file}
          <p class="origin">from {commitStore.rules.file}</p>
        {/if}
      {:else if commitStore.rulesHint}
        <p class="hint">
          {commitStore.rulesHint}
          {#if commitStore.rules?.file}
            <span class="origin">· {commitStore.rules.file}</span>
          {/if}
        </p>
      {/if}
    </div>

    <div class="buttons">
      <button
        class="primary"
        onclick={() => commitChanges()}
        disabled={!commitStore.canCommit}
        title={commitStore.blockedReason ?? 'Commit the ticked files (⌘⏎)'}
      >
        {commitStore.amend ? 'Amend' : 'Commit'}
      </button>
      <button
        class="secondary"
        onclick={() => commitAndPush()}
        disabled={!commitStore.canCommit || !!repoStore.head?.detached}
        title={repoStore.head?.detached
          ? 'HEAD is detached, so there is no branch to push'
          : (commitStore.blockedReason ?? 'Commit, then push the branch')}
      >
        Commit and Push…
      </button>
      <span class="summary">
        {#if commitStore.busy}
          {commitStore.busy}…
        {:else if commitStore.forced}
          everything goes in
        {:else}
          {pluralize(commitStore.checkedPaths.length, 'file')} ticked
        {/if}
      </span>
    </div>
  </div>
</section>

{#if menu}
  <ContextMenu x={menu.x} y={menu.y} items={menu.items} onclose={() => (menu = null)} />
{/if}

<style>
  .panel {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    background: var(--bg-panel);
    border-right: 1px solid var(--border);
  }

  .toolbar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 2px;
    height: 30px;
    padding: 0 6px;
    border-bottom: 1px solid var(--border);
  }

  .gap { flex: 1; }

  .tool {
    display: grid;
    place-items: center;
    width: 24px;
    height: 22px;
    background: none;
    border: 0;
    border-radius: var(--radius-sm);
    color: var(--text-dim);
  }
  .tool:hover:not(:disabled) { background: var(--bg-hover); color: var(--text); }
  .tool:disabled { opacity: 0.35; cursor: default; }
  .tool.on { background: var(--accent-subtle); color: var(--accent); }

  .banner {
    flex: none;
    margin: 0;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    font-size: 11.5px;
    line-height: 1.4;
  }
  .banner.warn { background: var(--warning-subtle); color: var(--warning); }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding-bottom: 6px;
  }

  .group-head {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 8px;
    margin-top: 3px;
  }
  .group-head:hover { background: var(--bg-hover); }

  .disclosure {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    height: 100%;
    padding: 0;
    background: none;
    border: 0;
    text-align: left;
  }
  .disclosure:disabled { cursor: default; }

  .chevron {
    flex: none;
    width: 10px;
    color: var(--text-faint);
    transition: transform 0.1s ease;
  }
  .chevron.open { transform: rotate(90deg); }

  .title {
    flex: none;
    font-size: 12.5px;
    font-weight: 600;
  }

  .count {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-faint);
    font-size: 11.5px;
  }

  .empty {
    margin: 0;
    padding: 28px 16px;
    color: var(--text-dim);
    font-size: 12px;
    text-align: center;
    line-height: 1.6;
  }
  .empty .faint { color: var(--text-faint); font-size: 11.5px; }

  .compose {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border-top: 1px solid var(--border);
  }

  .options {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .amend {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    cursor: pointer;
  }
  .amend.disabled { color: var(--text-faint); cursor: default; }

  .amend-target {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-faint);
    font-size: 11px;
  }

  .pushed {
    flex: none;
    padding: 0 4px;
    border-radius: var(--radius-sm);
    background: var(--danger-subtle);
    color: var(--danger);
    font-size: 10px;
    line-height: 15px;
  }

  textarea {
    width: 100%;
    min-height: 92px;
    max-height: 340px;
    padding: 6px 8px;
    background: var(--bg-sunken);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.5;
    resize: vertical;
  }
  textarea:focus { border-color: var(--accent); outline: none; background: var(--bg-panel); }
  textarea.invalid { border-color: var(--danger); }
  textarea.invalid:focus { border-color: var(--danger); }

  .rules:empty { display: none; }
  .rules {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: -2px;
    font-size: 11px;
    line-height: 1.45;
  }

  .problem {
    display: flex;
    gap: 5px;
    margin: 0;
    color: var(--danger);
  }
  .problem.warning { color: var(--warning); }

  .mark {
    flex: none;
    font-size: 10px;
    line-height: 1.6;
  }

  .hint {
    margin: 0;
    color: var(--text-dim);
    font-family: var(--font-mono);
  }

  .origin {
    color: var(--text-dim);
    font-family: var(--font-mono);
  }
  .problem + .origin { padding-left: 15px; }

  .buttons {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .primary, .secondary {
    padding: 4px 12px;
    border-radius: var(--radius-sm);
    font-size: 12px;
  }

  .primary {
    background: var(--accent);
    border: 1px solid var(--accent);
    color: var(--accent-text);
    font-weight: 500;
  }
  .primary:hover:not(:disabled) { background: var(--accent-hover); }

  .secondary {
    background: var(--bg-raised);
    border: 1px solid var(--border-strong);
    color: var(--text);
  }
  .secondary:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }

  .primary:disabled, .secondary:disabled { opacity: 0.45; cursor: default; }

  .summary {
    flex: 1;
    text-align: right;
    color: var(--text-faint);
    font-size: 11px;
    white-space: nowrap;
  }
</style>
