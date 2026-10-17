<script lang="ts">
  /**
   * The commit panel.
   *
   * Two groups: files Git already tracks, and files it has never seen. A tick
   * is the index: ticking a box stages the file, unticking unstages it, and a
   * file arrives ticked only if it is already staged.
   */
  import Icon from './Icon.svelte';
  import TriCheckbox from './TriCheckbox.svelte';
  import SuggestWaiting from './SuggestWaiting.svelte';
  import 'motion-components/motion-icon-state';
  import ChangeRow from './ChangeRow.svelte';
  import ChangeTreeNode from './ChangeTreeNode.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import StashSection from './StashSection.svelte';
  import { repoStore } from '../state/repo.svelte';
  import { commitStore, splitFiles } from '../state/commit.svelte';
  import { settingsStore } from '../state/settings.svelte';
  import {
    commitChanges, commitAndPush, rollbackChanges, changeMenuItems, openChange,
    stashChanges, stashMenuItems
  } from '../actions';
  import { buildChangeTree } from '../changes';
  import { pluralize } from '../format';
  import { checkMessage } from '../git/commit-rules';
  import { uiScale } from '../state/appearance.svelte';
  import type { Change } from '../changes';
  import type { Stash } from '../git/types';
  import type { MenuItem } from '../menu';

  // The commits the AI planned, apart from the files it could not place, so
  // the heading counts the same things as the button.
  const splitPlanned = $derived(commitStore.splitGroups.filter((g) => !g.leftover));
  const splitLeftover = $derived(commitStore.splitGroups.find((g) => g.leftover) ?? null);

  /**
   * The commit area's height once the user has dragged it, or null to fit its
   * content. Kept between sessions, like the app's other dividers.
   */
  const COMPOSE_KEY = 'gitkeen.composeHeight';
  const COMPOSE_MIN = 140;
  /** The file list always keeps this much, so the files stay in sight. */
  const LIST_MIN = 120;
  let panel = $state<HTMLElement | null>(null);
  let composeHeight = $state<number | null>(readComposeHeight());

  function readComposeHeight(): number | null {
    try {
      const saved = Number(localStorage.getItem(COMPOSE_KEY));
      return saved >= COMPOSE_MIN ? saved : null;
    } catch {
      return null;
    }
  }

  function saveComposeHeight() {
    try {
      if (composeHeight === null) localStorage.removeItem(COMPOSE_KEY);
      else localStorage.setItem(COMPOSE_KEY, String(Math.round(composeHeight)));
    } catch {
      // Not kept for next time; it still applies now.
    }
  }

  /** Drag the line above the commit area: up for more room, down for less. */
  function resizeCompose(event: PointerEvent) {
    event.preventDefault();
    const grip = event.currentTarget as HTMLElement;
    const compose = grip.nextElementSibling as HTMLElement;
    const start = event.clientY;
    const height = compose.getBoundingClientRect().height / uiScale();
    // Everything in the panel but the file list and the commit area stays as it is.
    const list = panel?.querySelector('.scroll') as HTMLElement | null;
    const room = height + (list ? list.getBoundingClientRect().height / uiScale() - LIST_MIN : 0);
    grip.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const next = height + (start - e.clientY) / uiScale();
      composeHeight = Math.max(COMPOSE_MIN, Math.min(room, next));
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      document.body.style.cursor = '';
      saveComposeHeight();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up, { once: true });
    document.body.style.cursor = 'row-resize';
  }

  /** The same from the keyboard: the arrows move the line, Home hands the height back. */
  function keyCompose(event: KeyboardEvent) {
    if (event.key === 'Home') {
      event.preventDefault();
      resetCompose();
      return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const grip = event.currentTarget as HTMLElement;
    const now = composeHeight ?? (grip.nextElementSibling as HTMLElement).getBoundingClientRect().height / uiScale();
    const list = panel?.querySelector('.scroll') as HTMLElement | null;
    const room = now + (list ? list.getBoundingClientRect().height / uiScale() - LIST_MIN : 0);
    composeHeight = Math.max(COMPOSE_MIN, Math.min(room, now + (event.key === 'ArrowUp' ? 24 : -24)));
    saveComposeHeight();
  }

  function resetCompose() {
    composeHeight = null;
    saveComposeHeight();
  }

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

  /**
   * Ask once per repository whether a suggestion can be offered. The answer
   * depends on the backend's environment, not on anything on screen.
   */
  $effect(() => {
    if (repoStore.info?.root) {
      commitStore.loadSuggestProviders();
      commitStore.loadSigning();
    }
  });

  /** Every collapsible key on screen, for the collapse-all button. */
  const allKeys = $derived.by(() => {
    const keys = [...groups.map((g) => g.key), 'stashes'];
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

  /** ⌘⏎ commits from the message box. */
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

<section class="panel" bind:this={panel}>
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
      onclick={() => stashChanges(checkedChanges)}
      disabled={checkedChanges.length === 0}
      title={checkedChanges.length === 0
        ? 'Tick the files to stash'
        : `Set the ${checkedChanges.length} ticked ${checkedChanges.length === 1 ? 'file' : 'files'} aside, and take them out of the working tree`}
      aria-label="Stash ticked files"
    >
      <Icon name="stash" size={14} />
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
                onopen={openChange}
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
                onopen={() => openChange(change)}
                onmenu={(e) => openMenu(change, e)}
              />
            {/each}
          {/if}
        {/if}
      {/each}
    {/if}

    {#if !empty || repoStore.stashes.length > 0}
      <StashSection
        open={!commitStore.collapsed.has('stashes')}
        ontoggle={() => commitStore.toggleCollapsed('stashes')}
        onmenu={openStashMenu}
      />
    {/if}
  </div>

  <!--
    The line above the message box. Dragging it gives the commit area more
    room, for a long message or a long list of suggested commits, at the file
    list's expense; a double click hands the height back to the content.
    A focusable separator with a value is a splitter, an interactive control
    in ARIA, which the checker does not know.
  -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    class="compose-grip"
    role="separator"
    aria-orientation="horizontal"
    aria-label="Resize the commit area"
    title="Drag to resize · double-click to reset"
    tabindex="0"
    aria-valuenow={composeHeight ?? undefined}
    aria-valuemin={COMPOSE_MIN}
    onpointerdown={resizeCompose}
    ondblclick={resetCompose}
    onkeydown={keyCompose}
  ></div>
  <div class="compose" class:sized={composeHeight !== null} style:height={composeHeight !== null ? `${composeHeight}px` : null}>
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
      {#if commitStore.signing?.available}
        <label class="amend" title={commitStore.signing.always
          ? 'This repository signs every commit (commit.gpgsign). Untick to leave this one unsigned.'
          : `Sign this commit with your ${commitStore.signing.format === 'ssh' ? 'SSH' : commitStore.signing.format === 'x509' ? 'X.509' : 'OpenPGP'} key`}>
          <TriCheckbox
            checkState={commitStore.willSign ? 'all' : 'none'}
            label="Sign the commit"
            onchange={() => (commitStore.sign = !commitStore.willSign)}
          />
          <span>Sign</span>
        </label>
      {/if}
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
        {:else if commitStore.rules?.source === 'gitkeen'}
          <p class="origin">from <button class="rules-link" onclick={() => settingsStore.show('commit')}>Gitkeen settings</button></p>
        {/if}
      {:else if commitStore.rulesHint}
        <p class="hint">
          {commitStore.rulesHint}
          {#if commitStore.rules?.file}
            <span class="origin">· {commitStore.rules.file}</span>
          {:else if commitStore.rules?.source === 'gitkeen'}
            <span class="origin">· <button class="rules-link" onclick={() => settingsStore.show('commit')} title="Change the rules">Gitkeen settings</button></span>
          {/if}
        </p>
      {/if}
    </div>

    <!--
      When a suggestion thought the change held unrelated work: one commit per
      piece of work, each with its own message. The user edits, ticks or
      leaves out each one; nothing is committed until they press the button,
      and the files of a commit left out stay staged for later.
    -->
    {#if commitStore.suggesting === 'working' && commitStore.checkedPaths.length >= 2}
      <SuggestWaiting
        files={commitStore.checkedPaths}
        model={commitStore.suggestProviders?.models[commitStore.suggestProviders?.preferred ?? ''] ?? null}
        rulesFrom={commitStore.rules?.file ?? (commitStore.rules?.source === 'gitkeen' ? 'your Gitkeen rules' : null)}
      />
    {:else if commitStore.splitGroups.length > 0}
      <div class="split">
        <div class="split-head">
          <TriCheckbox
            checkState={commitStore.splitChosen.length === 0
              ? 'none'
              : commitStore.splitChosen.length === commitStore.splitGroups.length ? 'all' : 'some'}
            label="Tick every suggested commit"
            onchange={() => commitStore.chooseAllSplit(commitStore.splitChosen.length !== commitStore.splitGroups.length)}
          />
          <span>
            Suggested as {pluralize(splitPlanned.length, 'commit')}
            {#if splitLeftover}<span class="split-note">· {pluralize(splitLeftover.files.length, 'file')} not placed</span>{/if}
          </span>
          <button class="dismiss" onclick={() => commitStore.dismissSplit()}>Dismiss</button>
        </div>
        <ol>
          {#each commitStore.splitGroups as group, i (i)}
            {@const blocking = group.subject.trim() ? checkMessage(group.subject, commitStore.rules).blocking : []}
            <li class:off={!group.on} style:animation-delay="{i * 70}ms">
              <TriCheckbox
                checkState={group.on ? 'all' : 'none'}
                label={`Make the commit for ${group.reason}`}
                onchange={() => (group.on = !group.on)}
              />
              <div class="split-body">
                <input
                  class="split-subject"
                  class:bad={blocking.length > 0}
                  bind:value={group.subject}
                  placeholder="Write a commit message"
                  spellcheck="false"
                  aria-label={`Message for ${group.reason}`}
                />
                {#if blocking.length > 0}<span class="split-problem">{blocking[0].message}</span>{/if}
                <span class="reason">{group.reason}</span>
                {#if group.leftover}
                  <span class="split-note">Write a message to commit these together, or leave them staged.</span>
                {/if}
                <button
                  class="count"
                  onclick={() => (group.open = !group.open)}
                  aria-expanded={group.open}
                  title={group.open ? 'Hide the files' : 'Show the files, to leave some out'}
                >
                  <span class="chevron" class:open={group.open} aria-hidden="true">›</span>
                  {#if group.excluded.length}
                    {splitFiles(group).length} of {pluralize(group.files.length, 'file')}
                  {:else}
                    {pluralize(group.files.length, 'file')}
                  {/if}
                </button>
                {#if group.open}
                  <!--
                    Unticking a file leaves it out of this commit only: it stays
                    staged, for a commit of its own later. Its name opens its diff.
                  -->
                  <ul class="split-files">
                    {#each group.files as file (file)}
                      {@const change = commitStore.all.find((c) => c.path === file)}
                      <li class:off={group.excluded.includes(file)}>
                        <TriCheckbox
                          checkState={group.excluded.includes(file) ? 'none' : 'all'}
                          label={`Include ${file} in this commit`}
                          onchange={() => commitStore.toggleSplitFile(group, file)}
                        />
                        <button class="split-file" onclick={() => change && openChange(change)} title="Show the diff">
                          <span class="name">{file.split('/').pop()}</span>
                          {#if file.includes('/')}<span class="dir">{file.slice(0, file.lastIndexOf('/'))}</span>{/if}
                        </button>
                      </li>
                    {/each}
                  </ul>
                {:else}
                  <span class="files" title={splitFiles(group).join('\n')}>{splitFiles(group).join(', ')}</span>
                {/if}
              </div>
            </li>
          {/each}
        </ol>
        <div class="split-foot">
          <button
            class="primary"
            onclick={() => commitStore.commitSplit()}
            disabled={!!commitStore.splitBlocked}
            title={commitStore.splitBlocked ?? 'Make each ticked commit, in this order'}
          >
            {commitStore.splitChosen.length === 1 ? 'Make 1 commit' : `Make ${commitStore.splitChosen.length} commits`}
          </button>
          {#if commitStore.splitChosen.length < commitStore.splitGroups.length}
            <span class="split-note">The files of unticked commits stay staged.</span>
          {/if}
        </div>
      </div>
    {/if}

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
      <!--
        Suggest once a provider is configured, and an invitation to connect one
        before that. Showing nothing at all would leave the feature invisible
        to anyone who has not already set a key.
      -->
      {#if (commitStore.suggestProviders?.available.length ?? 0) > 0}
        <button
          class="secondary suggest"
          class:working={commitStore.suggesting === 'working'}
          onclick={() => commitStore.suggest()}
          disabled={!commitStore.canSuggest}
          title={commitStore.canSuggest
            ? `Write a subject describing the ticked files, using ${commitStore.suggestProviders?.models[
                commitStore.suggestProviders.preferred ?? ''
              ]}`
            : 'Tick at least one file to describe'}
        >
          {#if commitStore.suggesting}
            <!-- Decorative: the button's own name and the busy summary say what is happening. -->
            <motion-icon-state class="suggest-icon" name="loading" active={commitStore.suggesting === 'done'}></motion-icon-state>
          {/if}
          Suggest
        </button>
      {:else if commitStore.suggestProviders}
        <button
          class="secondary suggest"
          onclick={() => settingsStore.show()}
          title="Set up an AI provider to suggest commit messages"
        >
          Suggest…
        </button>
      {/if}
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
  }
  /* A height of its own: what does not fit scrolls, with the buttons kept in sight. */
  .compose.sized {
    min-height: 0;
    overflow-y: auto;
  }
  .compose.sized .buttons {
    position: sticky;
    bottom: -8px;
    margin: auto -8px -8px;
    padding: 8px;
    background: var(--bg-panel);
    border-top: 1px solid var(--border);
  }

  /* The border above the commit area, with a wider band to grab than it shows. */
  .compose-grip {
    flex: none;
    position: relative;
    height: 1px;
    background: var(--border);
    cursor: row-resize;
    transition: background 0.1s ease;
  }
  .compose-grip::before {
    content: '';
    position: absolute;
    inset: -3px 0;
  }
  .compose-grip:hover, .compose-grip:focus-visible { background: var(--accent); outline: none; }

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

  .rules-link {
    padding: 0;
    background: none;
    border: 0;
    color: inherit;
    font: inherit;
    text-decoration: underline;
    text-decoration-color: var(--border-strong);
    text-underline-offset: 2px;
    cursor: pointer;
  }
  .rules-link:hover { color: var(--accent); text-decoration-color: currentColor; }

  .suggest {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .suggest-icon {
    --mc-icon-size: 13px;
    --mc-icon-color: var(--accent);
  }

  /* Off while it works, so it cannot be pressed twice, but not faded: the spinner is the point. */
  .suggest.working:disabled { opacity: 1; }

  .split {
    margin-top: 8px;
    padding: 8px 10px;
    background: var(--bg-sunken);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 11.5px;
  }

  .split-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 8px;
    color: var(--text-dim);
  }

  .dismiss {
    margin-left: auto;
    padding: 0;
    background: none;
    border: 0;
    color: var(--text-faint);
    text-decoration: underline;
  }
  .dismiss:hover { color: var(--text); }

  .split ol {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .split li {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    color: var(--text);
  }
  /* The checkbox lines up with the message, the thing it is about. */
  .split li > :global(.box) { margin-top: 5px; }
  .split li.off .split-body { opacity: 0.5; }

  /* The answer arrives commit by commit, where the waiting cards just were. */
  .split li { animation: split-in 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.1) both; }
  @keyframes split-in {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    .split li { animation: none; }
  }

  .split-body {
    flex: 1;
    min-width: 0;
  }

  .split-subject {
    display: block;
    width: 100%;
    box-sizing: border-box;
    margin-bottom: 3px;
    padding: 3px 6px;
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 11.5px;
  }
  .split-subject:focus { border-color: var(--accent); outline: none; }
  .split-subject.bad { border-color: var(--danger); }

  .split-problem {
    display: block;
    margin-bottom: 2px;
    color: var(--danger);
    font-size: 11px;
  }

  .split-foot {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
  }

  .split-note {
    color: var(--text-faint);
    font-size: 11px;
  }

  .reason { font-weight: 500; }

  .count {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    margin-left: 6px;
    padding: 0 3px;
    background: none;
    border: 0;
    border-radius: 3px;
    color: var(--text-faint);
    font: inherit;
    cursor: pointer;
  }
  .count:hover { background: var(--bg-hover); color: var(--text); }

  .split-files {
    margin: 4px 0 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .split-files li {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .split-files li.off .split-file { opacity: 0.5; text-decoration: line-through; }

  .split-file {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
    padding: 1px 4px;
    background: none;
    border: 0;
    border-radius: 3px;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .split-file:hover { background: var(--bg-hover); }
  .split-file .name { flex: none; font-size: 11.5px; }
  .split-file .dir {
    overflow: hidden;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: 10.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* The paths are the detail: available, but never the thing read first. */
  .files {
    display: block;
    overflow: hidden;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: 10.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

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
