<script lang="ts">
  /**
   * The todo list of `git rebase -i`, as a list you edit rather than a file.
   *
   * Rows are shown oldest first, which is the order Git applies them in. That
   * is the opposite of the graph, so the order is labelled rather than left
   * for the user to infer from the hashes.
   *
   * Nothing here touches Git. The plan is built in full, checked, and only
   * then run, so closing the dialog costs nothing.
   */
  import { rebaseStore } from '../state/rebase.svelte';
  import { relativeTime, pluralize } from '../format';
  import type { RebaseCommand } from '../git/types';

  const COMMANDS: { value: RebaseCommand; label: string; help: string }[] = [
    { value: 'pick', label: 'Pick', help: 'Keep the commit as it is.' },
    { value: 'reword', label: 'Reword', help: 'Keep the changes, write a new message.' },
    { value: 'edit', label: 'Edit', help: 'Stop here, amend the commit, then carry on with the rest.' },
    { value: 'squash', label: 'Squash', help: 'Fold into the commit above, keeping both messages.' },
    { value: 'fixup', label: 'Fixup', help: 'Fold into the commit above, discarding this message.' },
    { value: 'drop', label: 'Drop', help: 'Remove the commit and the change it made.' }
  ];

  const rows = $derived(rebaseStore.rows);
  const kept = $derived(rows.filter((r) => r.command !== 'drop').length);

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && !rebaseStore.editing) {
      event.preventDefault();
      rebaseStore.close();
    }
  }

  /*
   * Drag and drop. Only the grip starts a drag, so the command menu and the
   * message field in the same row keep working as they are. The line above
   * or below the row under the pointer shows where the dragged row will land.
   */
  let armed = $state<string | null>(null);
  let dragged = $state<string | null>(null);
  let target = $state<{ index: number; above: boolean } | null>(null);

  function startDrag(event: DragEvent, hash: string) {
    if (armed !== hash) { event.preventDefault(); return; }
    dragged = hash;
    event.dataTransfer?.setData('text/plain', hash);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  function overRow(event: DragEvent, index: number) {
    if (!dragged) return;
    event.preventDefault();
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    target = { index, above: event.clientY < box.top + box.height / 2 };
  }

  function dropOn(event: DragEvent) {
    event.preventDefault();
    if (dragged && target) {
      const from = rows.findIndex((r) => r.hash === dragged);
      let to = target.above ? target.index : target.index + 1;
      // Taking the row out first shifts everything after it up by one.
      if (from < to) to -= 1;
      if (to !== from) rebaseStore.moveTo(dragged, to);
    }
    endDrag();
  }

  function endDrag() {
    armed = null;
    dragged = null;
    target = null;
  }
</script>

<div class="scrim" role="presentation" onmousedown={() => rebaseStore.close()}></div>

<div
  class="editor"
  role="dialog"
  aria-modal="true"
  aria-label="Rebase commits"
  tabindex="-1"
  {onkeydown}
>
  <h2 class="title">
    Rebase {pluralize(rows.length, 'commit')}
    {#if rebaseStore.branch}<span class="on">on {rebaseStore.branch}</span>{/if}
  </h2>

  <p class="message">
    Applied from the top down, oldest first. Every commit here is rewritten and
    gets a new hash. An Edit row stops the run so that commit can be amended
    before the rest apply.
  </p>

  {#if rebaseStore.published.length > 0}
    <p class="warn">
      Some of these are already on {rebaseStore.published.join(', ')}. Publishing
      the result needs a force push.
    </p>
  {/if}

  <ol class="rows">
    {#each rows as row, i (row.hash)}
      <li
        class="row"
        class:dropped={row.command === 'drop'}
        class:folded={row.command === 'squash' || row.command === 'fixup'}
        class:pause={row.command === 'edit'}
        class:dragging={dragged === row.hash}
        class:drop-above={target?.index === i && target.above}
        class:drop-below={target?.index === i && !target.above}
        draggable={armed === row.hash}
        ondragstart={(e) => startDrag(e, row.hash)}
        ondragover={(e) => overRow(e, i)}
        ondrop={(e) => dropOn(e)}
        ondragend={endDrag}
      >
        <span
          class="grip"
          role="button"
          tabindex="-1"
          aria-label="Drag {row.shortHash} to another place"
          title="Drag to reorder"
          onpointerdown={() => (armed = row.hash)}
          onpointerup={() => { if (!dragged) armed = null; }}
        >⋮⋮</span>
        <div class="order">
          <button
            class="step"
            onclick={() => rebaseStore.move(row.hash, -1)}
            disabled={i === 0}
            aria-label="Move {row.shortHash} earlier"
            title="Apply earlier"
          >↑</button>
          <button
            class="step"
            onclick={() => rebaseStore.move(row.hash, 1)}
            disabled={i === rows.length - 1}
            aria-label="Move {row.shortHash} later"
            title="Apply later"
          >↓</button>
        </div>

        <select
          class="command"
          value={row.command}
          onchange={(e) => rebaseStore.setCommand(row.hash, e.currentTarget.value as RebaseCommand)}
          aria-label="What to do with {row.shortHash}"
          title={COMMANDS.find((c) => c.value === row.command)?.help}
        >
          {#each COMMANDS as option (option.value)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>

        <span class="hash">{row.shortHash}</span>

        <div class="text">
          {#if rebaseStore.editing === row.hash}
            <!-- svelte-ignore a11y_autofocus -->
            <textarea
              class="rewrite"
              rows="3"
              autofocus
              value={row.message ?? row.original}
              oninput={(e) => rebaseStore.setMessage(row.hash, e.currentTarget.value)}
              onblur={() => (rebaseStore.editing = null)}
              onkeydown={(e) => {
                if (e.key === 'Escape') { e.stopPropagation(); rebaseStore.editing = null; }
              }}
              aria-label="New message for {row.shortHash}"
            ></textarea>
          {:else}
            <span class="subject">{(row.message ?? row.original).split('\n')[0]}</span>
            <span class="meta">{row.author} · {relativeTime(row.date)}</span>
          {/if}
        </div>

        {#if row.command === 'reword' || row.command === 'edit'}
          <button
            class="edit"
            onclick={() => (rebaseStore.editing = rebaseStore.editing === row.hash ? null : row.hash)}
          >
            {rebaseStore.editing === row.hash ? 'Done' : 'Edit message'}
          </button>
        {/if}
      </li>
    {/each}
  </ol>

  <div class="summary">
    {#if rebaseStore.problems.length > 0}
      {#each rebaseStore.problems as problem}
        <p class="problem"><span aria-hidden="true">✖</span> {problem}</p>
      {/each}
    {:else if !rebaseStore.changed}
      <p class="quiet">Nothing is changed yet, so there is nothing to run.</p>
    {:else}
      <p class="quiet">
        {pluralize(rows.length, 'commit')} become {kept === 0 ? 'none' : pluralize(kept, 'commit')}.
      </p>
    {/if}
  </div>

  <div class="actions">
    <button class="btn" onclick={() => rebaseStore.close()}>Cancel</button>
    <button class="btn" onclick={() => rebaseStore.reset()} disabled={!rebaseStore.changed}>
      Reset
    </button>
    <button
      class="btn primary"
      onclick={() => rebaseStore.run()}
      disabled={rebaseStore.busy || rebaseStore.problems.length > 0 || !rebaseStore.changed}
    >
      {rebaseStore.busy ? 'Rebasing…' : 'Start rebase'}
    </button>
  </div>
</div>

<style>
  .grip {
    flex: none;
    width: 12px;
    color: var(--text-faint);
    font-size: 11px;
    letter-spacing: -2px;
    cursor: grab;
    user-select: none;
  }
  .grip:hover { color: var(--text); }
  .row.dragging { opacity: 0.4; }
  .row.drop-above { box-shadow: inset 0 2px 0 var(--accent); }
  .row.drop-below { box-shadow: inset 0 -2px 0 var(--accent); }

  .scrim {
    position: fixed;
    inset: 0;
    z-index: 80;
    background: var(--scrim);
  }

  .editor {
    position: fixed;
    z-index: 81;
    top: 8%;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    width: min(680px, calc(100vw - 32px));
    max-height: 84vh;
    padding: 18px 20px 16px;
    background: var(--bg-raised);
    border: 1px solid var(--border-strong);
    border-top: 2px solid var(--warning);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-modal);
    outline: none;
  }

  .title {
    margin: 0 0 8px;
    font-size: 14px;
    font-weight: 600;
  }
  .on { color: var(--text-dim); font-weight: 400; }

  .message { margin: 0 0 10px; color: var(--text-dim); }

  .warn {
    margin: 0 0 10px;
    padding: 7px 10px;
    background: var(--bg-sunken);
    border-radius: var(--radius-sm);
    color: var(--warning);
    font-size: 12px;
  }

  .rows {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    margin: 0 0 10px;
    padding: 4px;
    list-style: none;
    background: var(--bg-sunken);
    border-radius: var(--radius-sm);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 4px;
    border-radius: var(--radius-sm);
  }
  .row:hover { background: var(--bg-hover); }

  /* A dropped row stays in place, greyed and struck through, so the list
     never jumps under the pointer while it is being edited. */
  .row.dropped .subject { text-decoration: line-through; }
  .row.dropped { opacity: 0.5; }

  /* A folded row is indented, showing it belongs to the one above it. */
  .row.folded { padding-left: 18px; }

  /* An edited row is where the run pauses, so it is marked as such. */
  .row.pause { box-shadow: inset 3px 0 0 var(--accent); }

  .order { display: flex; flex-direction: column; gap: 1px; }

  .step {
    width: 16px;
    height: 12px;
    padding: 0;
    background: none;
    border: 0;
    border-radius: 2px;
    color: var(--text-faint);
    font-size: 9px;
    line-height: 1;
  }
  .step:hover:not(:disabled) { background: var(--bg-active); color: var(--text); }
  .step:disabled { opacity: 0.3; cursor: default; }

  .command {
    flex: none;
    width: 82px;
    padding: 2px 4px;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text);
    font-size: 11.5px;
  }

  .hash {
    flex: none;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .subject {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12.5px;
  }

  .meta { color: var(--text-faint); font-size: 10.5px; }

  .rewrite {
    width: 100%;
    padding: 4px 6px;
    background: var(--bg-panel);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    color: var(--text);
    font-family: inherit;
    font-size: 12px;
    resize: vertical;
  }

  .edit {
    flex: none;
    padding: 2px 8px;
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    font-size: 11px;
  }
  .edit:hover { border-color: var(--accent); color: var(--accent); }

  .summary { min-height: 18px; margin-bottom: 10px; }
  .quiet { margin: 0; color: var(--text-faint); font-size: 12px; }
  .problem { margin: 0; color: var(--danger); font-size: 12px; }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .btn {
    padding: 5px 14px;
    background: var(--bg-panel);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
  }
  .btn:hover:not(:disabled) { background: var(--bg-hover); }
  .btn:disabled { opacity: 0.45; cursor: default; }

  .btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-text);
    font-weight: 500;
  }
  .btn.primary:hover:not(:disabled) { background: var(--accent-hover); }
</style>
