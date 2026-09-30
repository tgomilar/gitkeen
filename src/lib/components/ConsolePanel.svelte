<script lang="ts">
  /**
   * The smart console, along the bottom of the main area.
   *
   * Type a Git command. Suggestions come from the repository as you type:
   * commands, their options, and the branches, files, commits, tags, remotes
   * and stashes that fit where the cursor is. A risky command shows what it
   * will do before it runs, and asks first. Results are drawn: status as
   * grouped files, log as a small graph, diffs in colour.
   */
  import Icon from './Icon.svelte';
  import Explain from './Explain.svelte';
  import ConsoleOutput from './ConsoleOutput.svelte';
  import { consoleStore } from '../state/console.svelte';
  import { uiScale } from '../state/appearance.svelte';
  import { repoStore } from '../state/repo.svelte';
  import { complete, type Suggestion } from '../console/complete';
  import { tokenize, checkCommand, riskOf } from '../../../server/console.mjs';

  let input = $state<HTMLInputElement | null>(null);
  let scroller = $state<HTMLDivElement | null>(null);
  let line = $state('');
  let cursor = $state(0);
  let active = $state(0);
  let listOpen = $state(false);
  let historyAt = $state<number | null>(null);
  let preview = $state<{ level: string; lines: string[] } | null>(null);
  /** Entries switched to Git's own text, by id. */
  let raw = $state<Record<number, boolean>>({});

  const context = $derived({
    branches: repoStore.branches.local.map((b) => b.name),
    remoteBranches: repoStore.branches.remote.map((b) => b.name),
    tags: repoStore.branches.tags.map((t) => t.name),
    remotes: repoStore.remotes,
    stashes: repoStore.stashes.map((s) => ({ ref: s.ref, message: s.message })),
    commits: repoStore.commits.slice(0, 200).map((c) => ({ shortHash: c.shortHash, subject: c.subject })),
    changed: (repoStore.status?.files ?? []).map((f) => f.path),
    staged: (repoStore.status?.files ?? []).filter((f) => f.index !== '.' && f.index !== '?').map((f) => f.path),
    currentBranch: repoStore.currentBranch
  });

  const completion = $derived(complete(line, cursor, context));
  const items = $derived(listOpen && line.trim() ? completion.items : []);
  /** The rest of the top suggestion, drawn faintly after the cursor. */
  const ghost = $derived.by(() => {
    const top = completion.items[0];
    if (!top || cursor !== line.length) return '';
    const typed = line.slice(completion.from);
    return typed && top.value.toLowerCase().startsWith(typed.toLowerCase()) ? top.value.slice(typed.length) : '';
  });

  /** What is wrong with the line, known without asking the backend. */
  const localCheck = $derived.by(() => {
    const text = line.trim();
    if (!text) return null;
    const { args, error } = tokenize(text);
    if (!args) return { error };
    const argv = args[0] === 'git' ? args.slice(1) : args;
    if (argv.length === 0) return null;
    const check = checkCommand(argv);
    if (!check.ok) return { error: check.error, redirect: !!check.redirect };
    return { risk: riskOf(check.sub, check.rest) };
  });

  // A risky line is described by the backend, a moment after typing stops.
  $effect(() => {
    const text = line;
    const risk = localCheck && 'risk' in localCheck ? localCheck.risk : null;
    preview = null;
    if (risk !== 'danger' || !repoStore.repo) return;
    const timer = setTimeout(async () => {
      try {
        const p = await repoStore.repo!.consolePreview(text);
        if (text === line && p.ok) preview = { level: p.level ?? 'danger', lines: p.lines ?? [] };
      } catch { /* the preview is a hint */ }
    }, 250);
    return () => clearTimeout(timer);
  });

  // New output scrolls into view.
  $effect(() => {
    void consoleStore.entries.length;
    queueMicrotask(() => scroller && (scroller.scrollTop = scroller.scrollHeight));
  });

  // Opening the console puts the cursor in it.
  $effect(() => {
    if (consoleStore.open) queueMicrotask(() => input?.focus());
  });

  function syncCursor() {
    cursor = input?.selectionStart ?? line.length;
  }

  function accept(item: Suggestion) {
    const before = line.slice(0, completion.from);
    const after = line.slice(cursor).replace(/^\S*/, '');
    const needsQuote = /\s/.test(item.value);
    const value = needsQuote ? `"${item.value}"` : item.value;
    line = `${before}${value}${after.startsWith(' ') ? '' : ' '}${after.trimStart()}`;
    cursor = before.length + value.length + 1;
    active = 0;
    listOpen = true;
    queueMicrotask(() => { input?.setSelectionRange(cursor, cursor); input?.focus(); });
  }

  async function submit() {
    const text = line.trim();
    if (!text) return;
    line = '';
    cursor = 0;
    listOpen = false;
    historyAt = null;
    await consoleStore.run(text);
  }

  function onkeydown(event: KeyboardEvent) {
    const list = completion.items;
    if (event.key === 'Tab') {
      event.preventDefault();
      if (list.length) accept(list[listOpen ? active : 0]);
      listOpen = true;
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      // A suggestion picked with the arrows goes in; otherwise the line runs.
      if (listOpen && items.length && active > 0) accept(items[active]);
      else submit();
      return;
    }
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (listOpen) listOpen = false;
      else input?.blur();
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const down = event.key === 'ArrowDown';
      if (listOpen && items.length && line.trim() && historyAt === null) {
        active = (active + (down ? 1 : -1) + items.length) % items.length;
        return;
      }
      const history = consoleStore.history;
      if (!history.length) return;
      const at = historyAt === null ? (down ? null : history.length - 1) : historyAt + (down ? 1 : -1);
      if (at === null || at >= history.length) { historyAt = null; line = ''; }
      else { historyAt = Math.max(0, at); line = history[historyAt]; }
      queueMicrotask(() => { cursor = line.length; input?.setSelectionRange(cursor, cursor); });
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      consoleStore.clear();
      return;
    }
    listOpen = true;
    active = 0;
  }

  /** Drag the top edge to make the console taller or shorter. */
  function resize(event: PointerEvent) {
    const start = event.clientY, height = consoleStore.height;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => consoleStore.setHeight(height + (start - e.clientY) / uiScale());
    const up = () => { target.removeEventListener('pointermove', move); document.body.style.cursor = ''; };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up, { once: true });
    document.body.style.cursor = 'row-resize';
  }

  const KIND_ICON: Record<string, string> = {
    command: '›', subcommand: '›', flag: '-', branch: '⎇', ref: '⎇', commit: '●', changed: '±', staged: '+', file: '·', remote: '☁', tag: '⌗', stash: '▤'
  };
</script>

<section class="console" style="height: {consoleStore.height}px" aria-label="Git console">
  <div class="grip" role="separator" aria-orientation="horizontal" aria-label="Resize the console" onpointerdown={resize}></div>
  <header>
    <Icon name="console" size={13} />
    <span class="title">Console</span>
    <span class="where mono">{repoStore.info?.name ?? ''}{repoStore.currentBranch ? ` · ${repoStore.currentBranch}` : ''}</span>
    <span class="hint">Tab completes · ↑ ↓ history · ⌘L clears</span>
    <button class="tool" onclick={() => consoleStore.clear()} title="Clear the console (⌘L)">Clear</button>
    <button class="tool close" onclick={() => consoleStore.setOpen(false)} title="Close the console (Ctrl+`)" aria-label="Close the console">×</button>
  </header>

  <div class="scroll" bind:this={scroller}>
    {#if consoleStore.entries.length === 0}
      <p class="welcome">
        Type a Git command, such as <code>status</code>, <code>log</code> or <code>switch</code>. You can leave out
        <code>git</code>. Press Tab for suggestions from this repository. A command that can lose work shows what it
        will do and asks first, and the Undo panel can put it back.
      </p>
    {/if}
    {#each consoleStore.entries as entry (entry.id)}
      <div class="entry state-{entry.state}">
        {#if entry.state === 'note'}
          <div class="note"><span class="faint">{entry.note}</span> <code>git {entry.line}</code></div>
        {:else}
          {@const drawn = !!entry.result?.ok && !!entry.result.kind && entry.result.kind !== 'text'}
          <div class="prompt">
            <span><span class="dollar">$</span> git {entry.line.replace(/^git\s+/, '')}</span>
            {#if drawn}
              <button class="raw-toggle" onclick={() => (raw[entry.id] = !raw[entry.id])} aria-pressed={!!raw[entry.id]}>
                {raw[entry.id] ? 'Show picture' : 'Show raw output'}
              </button>
            {/if}
          </div>
          {#if entry.state === 'running'}
            <div class="running"><span class="spinner" aria-hidden="true"></span>Running…</div>
          {:else if entry.state === 'confirm' && entry.result?.preview}
            <div class="confirm">
              <p class="head"><b>This can lose work.</b></p>
              {#each entry.result.preview.lines as l}<p>{l}</p>{/each}
              <div class="buttons">
                <button class="danger" onclick={() => consoleStore.confirm(entry.id)}>Run it</button>
                <button onclick={() => consoleStore.cancel(entry.id)}>Cancel</button>
              </div>
            </div>
          {:else if entry.state === 'cancelled'}
            <p class="faint">Cancelled. Nothing ran.</p>
          {:else if entry.state === 'refused'}
            <p class={entry.result?.redirect ? 'redirect' : 'refused'}>{entry.result?.error}</p>
          {:else if entry.result}
            <ConsoleOutput result={entry.result} raw={!!raw[entry.id]} />
            {#if entry.state === 'failed'}
              {#if entry.result.explanation}
                <div class="explain-card">
                  <p><b>{entry.result.explanation.what}</b></p>
                  {#if entry.result.explanation.fix}<p>{entry.result.explanation.fix}</p>{/if}
                </div>
              {/if}
              <Explain kind="error" subject={`console-${entry.id}`} label="Explain this error"
                args={{ text: `The command: git ${entry.line}\nGit said:\n${entry.result.stderr ?? ''}\n${entry.result.stdout ?? ''}` }} />
            {/if}
            {#if entry.result.recorded}
              <p class="saved">Saved {entry.result.recorded} recovery point{entry.result.recorded === 1 ? '' : 's'} first. The Undo panel can put it back.</p>
            {/if}
          {/if}
        {/if}
      </div>
    {/each}
  </div>

  <div class="input-area">
    {#if items.length}
      <ul class="suggestions" role="listbox" aria-label="Suggestions">
        {#each items as item, i (item.kind + item.value)}
          <li role="option" aria-selected={i === active}>
            <button class:active={i === active} onmousedown={(e) => { e.preventDefault(); accept(item); }}>
              <span class="kind" aria-hidden="true">{KIND_ICON[item.kind] ?? '·'}</span>
              <span class="value mono">{item.label ?? item.value}</span>
              {#if item.detail}<span class="detail">{item.detail}</span>{/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    {#if localCheck && 'error' in localCheck && localCheck.error}
      <p class="status {localCheck.redirect ? 'redirect' : 'bad'}">{localCheck.error}</p>
    {:else if preview}
      <p class="status danger">⚠ {preview.lines.join(' ')}</p>
    {:else if localCheck && 'risk' in localCheck && localCheck.risk === 'read'}
      <p class="status faint">Reads only. Nothing changes.</p>
    {/if}

    <div class="line">
      <span class="dollar">$ git</span>
      <div class="field">
        <span class="ghost mono" aria-hidden="true"><span class="typed">{line}</span>{ghost}</span>
        <input
          bind:this={input}
          bind:value={line}
          class="mono"
          spellcheck="false"
          autocomplete="off"
          aria-label="Git command"
          placeholder="a command, such as status"
          {onkeydown}
          oninput={() => { syncCursor(); listOpen = true; active = 0; historyAt = null; }}
          onclick={syncCursor}
          onkeyup={syncCursor}
          onblur={() => (listOpen = false)}
          onfocus={() => (listOpen = true)}
        />
      </div>
    </div>
  </div>
</section>

<style>
  .console {
    position: relative;
    flex: none;
    display: flex;
    flex-direction: column;
    min-height: 140px;
    /* Sunken like a terminal, so it stands apart from the details above it. */
    background: var(--bg-sunken);
    border-top: 1px solid var(--border-strong);
    font-size: 12.5px;
  }
  .grip { position: absolute; top: -3px; left: 0; right: 0; height: 6px; cursor: row-resize; z-index: 2; }
  header { display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 8px; background: var(--bg-raised); border-bottom: 1px solid var(--border); color: var(--text-dim); }
  .title { font-weight: 600; color: var(--text); }
  .where { color: var(--text-faint); font-size: 11px; }
  .hint { margin-left: auto; color: var(--text-faint); font-size: 11px; }
  .tool { padding: 2px 8px; background: none; border: 1px solid transparent; border-radius: var(--radius-sm); color: var(--text-dim); font-size: 11.5px; }
  .tool:hover { background: var(--bg-hover); border-color: var(--border); color: var(--text); }
  .tool.close { font-size: 15px; line-height: 1; padding: 0 6px; }

  .scroll { flex: 1; overflow: auto; padding: 6px 12px; }
  .welcome { max-width: 72ch; margin: 6px 0; color: var(--text-dim); line-height: 1.5; }
  code, .mono { font-family: var(--font-mono); font-size: 12px; }
  .entry { margin: 0 0 10px; }
  .prompt { display: flex; align-items: center; gap: 12px; font-family: var(--font-mono); color: var(--text); }
  .raw-toggle {
    margin-left: auto; padding: 0 8px; background: none; border: 1px solid var(--border); border-radius: var(--radius-sm);
    color: var(--text-faint); font-family: var(--font-ui); font-size: 11px;
  }
  .raw-toggle:hover { color: var(--text); border-color: var(--border-strong); }
  .dollar { color: var(--accent); font-family: var(--font-mono); user-select: none; }
  .running { display: flex; align-items: center; gap: 6px; color: var(--text-faint); padding: 4px 0; }
  .faint { color: var(--text-faint); }
  .note { font-size: 11.5px; color: var(--text-faint); }
  .note code { color: var(--text-dim); font-size: 11px; }
  .refused { margin: 4px 0; color: var(--danger); }
  .redirect { margin: 4px 0; color: var(--accent); }
  .confirm {
    margin: 6px 0; padding: 8px 12px; max-width: 80ch;
    background: var(--danger-subtle); border-left: 3px solid var(--danger); border-radius: var(--radius-sm);
  }
  .confirm p { margin: 0 0 4px; }
  .confirm .head { color: var(--danger); }
  .buttons { display: flex; gap: 8px; margin-top: 6px; }
  .buttons button { padding: 3px 12px; background: var(--bg-panel); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); font-size: 12px; }
  .buttons button.danger { background: var(--danger); border-color: var(--danger); color: #fff; }
  .explain-card { margin: 6px 0; padding: 6px 12px; max-width: 80ch; background: var(--warning-subtle); border-left: 3px solid var(--warning); border-radius: var(--radius-sm); }
  .explain-card p { margin: 0 0 3px; }
  .saved { margin: 4px 0 0; color: var(--success); font-size: 11.5px; }

  .input-area { position: relative; border-top: 1px solid var(--border); padding: 4px 10px 6px; }
  .status { margin: 0 0 4px; font-size: 11.5px; }
  .status.bad { color: var(--danger); }
  .status.redirect { color: var(--accent); }
  .status.danger { color: var(--danger); font-weight: 500; }
  .line { display: flex; align-items: center; gap: 8px; }
  .field { position: relative; flex: 1; }
  .field input, .ghost {
    width: 100%; padding: 4px 0; background: none; border: 0; outline: none;
    font-family: var(--font-mono); font-size: 13px; color: var(--text); white-space: pre;
  }
  .ghost { position: absolute; inset: 0; pointer-events: none; color: var(--text-faint); overflow: hidden; }
  .ghost .typed { visibility: hidden; }
  .field input { position: relative; }
  .field input::placeholder { color: var(--text-faint); font-style: italic; }

  .suggestions {
    position: absolute; bottom: 100%; left: 44px; z-index: 5;
    max-height: 240px; min-width: 320px; max-width: min(640px, 80vw); overflow: auto;
    margin: 0 0 4px; padding: 4px; list-style: none;
    background: var(--bg-raised); border: 1px solid var(--border-strong); border-radius: var(--radius-md); box-shadow: var(--shadow-menu);
  }
  .suggestions button { display: flex; align-items: baseline; gap: 8px; width: 100%; padding: 3px 8px; background: none; border: 0; border-radius: var(--radius-sm); color: var(--text); text-align: left; }
  .suggestions button.active { background: var(--accent); color: var(--accent-text); }
  .suggestions button.active .detail, .suggestions button.active .kind { color: inherit; opacity: 0.85; }
  .kind { width: 12px; flex: none; color: var(--text-faint); text-align: center; }
  .value { flex: none; }
  .detail { color: var(--text-faint); font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
