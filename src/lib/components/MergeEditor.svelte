<script lang="ts">
  /**
   * The three-way merge editor, over the whole window like the diff viewer.
   *
   * The file is shown as alternating context and conflict cards. Each card
   * holds three columns: ours, the result, and theirs. Keeping a side, or
   * both, fills the result, and the result can then be edited by hand; either
   * marks the block resolved. The common ancestor is available behind a
   * toggle, and nothing is written until "Mark resolved" at the bottom: a
   * conflict with no choice yet keeps its markers, which the server then
   * refuses to stage.
   */
  import { mergeStore } from '../state/merge.svelte';
  import { repoStore } from '../state/repo.svelte';
  import { previewText, choiceText } from '../merge';
  import { pluralize } from '../format';
  import type { ConflictChoice, MergeOffer } from '../git/types';

  const request = $derived(mergeStore.request);
  const offer = $derived(mergeStore.offer);
  const blocks = $derived(mergeStore.blocks);
  const unresolved = $derived(mergeStore.unresolved);

  const chosen = (i: number) => mergeStore.choices[i];

  /** Blocks whose panes were expanded, keyed by section index. */
  let expanded = $state<Set<number>>(new Set());

  const PANE_CAP = 300;

  function paneLines(side: 'ours' | 'theirs', sectionIndex: number) {
    const section = offer?.sections[sectionIndex];
    if (!section || section.type !== 'conflict') return { lines: [], total: 0, cut: 0 };
    const lines = section[side].map((l) => l.replace(/\n$/, ''));
    const total = lines.length;
    const cut = total > PANE_CAP && !expanded.has(sectionIndex) ? total - PANE_CAP : 0;
    return { lines: cut > 0 ? lines.slice(0, PANE_CAP) : lines, total, cut };
  }

  function togglePane(sectionIndex: number) {
    const next = new Set(expanded);
    if (next.has(sectionIndex)) next.delete(sectionIndex);
    else next.add(sectionIndex);
    expanded = next;
  }

  function pick(sectionIndex: number, side: ConflictChoice) {
    mergeStore.pick(sectionIndex, side);
  }

  /** What the result pane of a block shows: the typed text, or the choice's. */
  function resultText(sectionIndex: number): string {
    const typed = mergeStore.edits[sectionIndex];
    if (typed !== undefined) return typed;
    const section = offer?.sections[sectionIndex];
    const choice = mergeStore.choices[sectionIndex];
    if (!section || section.type !== 'conflict' || !choice) return '';
    return choiceText(section, choice);
  }

  function onkeydown(event: KeyboardEvent) {
    // Only while open: this listener stays on the window even when the editor
    // is closed, and a stopped Escape would never reach a window opened later.
    if (!mergeStore.open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      mergeStore.close();
    }
  }

  /** Focus the panel on open, so Escape works without a click. */
  function autofocus(node: HTMLElement) {
    node.focus();
  }

  const sideName = (text: string, fallback: string) => (text ? text : fallback);

  /**
   * A rebase replays your commits on top of the other branch, so Git's "ours"
   * is that branch and "theirs" is your own commit: the reverse of a merge.
   */
  const rebasing = $derived(repoStore.status?.operation === 'rebase');
  const oursName = $derived(rebasing ? 'the branch you are rebasing onto' : 'the current side');
  const theirsName = $derived(rebasing ? 'your commit being replayed' : 'the incoming side');
  const statusLabel = (offer?: MergeOffer | null) =>
    offer?.stages.ours.present && offer.stages.theirs.present ? 'both sides changed the file' : 'one side rewrote the file';
</script>

<svelte:window on:keydown={onkeydown} />

{#if request}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="scrim"
    role="dialog"
    aria-modal="true"
    aria-label="Merge editor for {request.file}"
    tabindex="-1"
    use:autofocus
  >
    <div class="panel">
      <header>
        <div class="titles">
          <div class="path">
            <span class="status">conflict</span>
            <bdi dir="ltr">{request.file}</bdi>
          </div>
          <div class="sub">
            <span>{request.source}</span>
            {#if offer && !offer.binary}
              <span>{offer.stages.base.present ? 'base present' : 'no common ancestor'}</span>
              <span class="stat">{pluralize(offer.stages.ours.lines, 'line')} ours</span>
              <span class="stat">{pluralize(offer.stages.theirs.lines, 'line')} theirs</span>
            {/if}
          </div>
        </div>

        <div class="tools">
          {#if offer && !offer.binary && offer.base}
            <button
              class:on={mergeStore.showBase}
              onclick={() => (mergeStore.showBase = !mergeStore.showBase)}
              aria-pressed={mergeStore.showBase}
              title="Show the common ancestor the two sides both changed"
            >Show base</button>
          {/if}
          {#if offer && !offer.binary && blocks.length > 0}
            <button onclick={() => mergeStore.pickAll('ours')} title={`Keep ${oursName} for every conflict`}>All ours</button>
            <button onclick={() => mergeStore.pickAll('theirs')} title={`Keep ${theirsName} for every conflict`}>All theirs</button>
          {/if}
          <button class="close" onclick={() => mergeStore.close()} title="Close (Escape)" aria-label="Close">×</button>
        </div>
      </header>

      {#if offer && !offer.binary && blocks.length > 0}
        <div class="progress">
          <span class="count">
            {blocks.length === 0
              ? 'No conflicts'
              : unresolved === 0
                ? `${blocks.length} ${blocks.length === 1 ? 'conflict' : 'conflicts'} chosen`
                : `${blocks.length - unresolved} of ${blocks.length} ${blocks.length === 1 ? 'conflict' : 'conflicts'} chosen`}
          </span>
          {#if unresolved > 0}
            <span class="faint">{unresolved} left without a choice</span>
          {/if}
          <span class="hint">unresolved blocks keep Git's markers, so nothing half-finished can reach the history</span>
        </div>
      {/if}

      <div class="body">
        {#if mergeStore.loading}
          <p class="notice">Reading the conflict…</p>
        {:else if mergeStore.error}
          <p class="notice bad">{mergeStore.error}</p>
        {:else if !offer}
          <p class="notice">Nothing to resolve here.</p>
        {:else if offer.binary}
          <p class="notice">
            This is a binary conflict.<br />
            <span class="faint">Gitalia cannot edit one yet. Fix it in an external editor, then right click the file
            and choose <strong>Mark as Resolved</strong>, or open it again here to confirm the resolution.</span>
          </p>
        {:else if offer.lines === 0}
          <p class="notice">
            This file's conflict carries no text to show.<br />
            <span class="faint">Resolve it with <strong>Mark as Resolved</strong> after dealing with it outside Gitalia.</span>
          </p>
        {:else}
          <div class="file">
            <p class="meta">
              {statusLabel(offer)}
              {#if offer.lines > 0} — {pluralize(offer.lines, 'line')} in the merged file{/if}.
              {#if offer.stages.base.present}
                The base is the version the two branches last agreed on.
              {:else}
                The file did not exist in the branches' common ancestor, so there is no base to compare with.
              {/if}
              {#if rebasing}
                During a rebase, <b>ours</b> is the branch you are rebasing onto and <b>theirs</b> is your own commit being replayed.
              {/if}
            </p>

            {#if mergeStore.showBase && offer.base}
              <div class="base-pane">
                <div class="base-head">
                  <span>Common ancestor</span>
                  <span class="faint">{pluralize(offer.base.length, 'line')}</span>
                </div>
                <div class="base-lines">
                  {#each offer.base as line, n (n)}
                    <div class="base-row"><span class="num">{n + 1}</span><span class="txt">{line.replace(/\n$/, '')}</span></div>
                  {/each}
                </div>
              </div>
            {/if}

            {#each offer.sections as section, index (index)}
              {#if section.type === 'text'}
                {@const context = previewText(section.lines)}
                <div class="context" title="unchanged on both sides">
                  <div class="context-head">
                    <span>unchanged</span>
                    <span class="faint">{pluralize(context.total, 'line')}</span>
                  </div>
                  {#each context.first as line, n (n)}
                    <div class="context-line faded"><span class="num">{n + 1}</span><span>{line}</span></div>
                  {/each}
                  {#if context.hidden > 0}
                    <div class="fold">⋯ {context.hidden.toLocaleString()} more unchanged lines ⋯</div>
                    {#each context.trailing as line, n (n)}
                      <div class="context-line faded"><span class="num">{context.total - context.trailing.length + n + 1}</span><span>{line}</span></div>
                    {/each}
                  {/if}
                </div>
              {:else}
                {@const ours = paneLines('ours', index)}
                {@const theirs = paneLines('theirs', index)}
                {@const edited = mergeStore.edits[index] !== undefined}
                {@const removes = !edited && (chosen(index) === 'ours' || chosen(index) === 'theirs') && !!section.deleted?.[chosen(index) as 'ours' | 'theirs']}
                <div class="conflict" class:done={!!chosen(index) || edited}>
                  <div class="conflict-head">
                    <span class="badge">Conflict {blocks.indexOf(index) + 1}</span>
                    <span class="state">
                      {#if removes}
                        <b>deletes the file</b>
                      {:else if edited}
                        keeps <b>the result you wrote</b>
                      {:else if chosen(index) === 'both'}
                        keeps <b>both sides</b>, ours first
                      {:else if chosen(index) === 'ours'}
                        keeps <b>{sideName(section.labels.ours, oursName)}</b>
                      {:else if chosen(index) === 'theirs'}
                        keeps <b>{sideName(section.labels.theirs, theirsName)}</b>
                      {:else}
                        not resolved yet
                      {/if}
                    </span>
                  </div>

                  <div class="cols">
                    <div class="col ours" class:picked={chosen(index) === 'ours' && !edited}>
                      <div class="col-head">
                        <span class="tag">Ours</span>
                        <span class="faint mono">{sideName(section.labels.ours, oursName.replace(/^the /, ''))}</span>
                      </div>
                      <div class="col-body">
                        {#if section.deleted?.ours}
                          <p class="empty-line">this side deleted the file</p>
                        {:else if ours.total === 0}
                          <p class="empty-line">this side has nothing here</p>
                        {:else}
                          {#each ours.lines as line, n (n)}
                            <div class="c-line"><span class="num">{n + 1}</span><span>{line}</span></div>
                          {/each}
                          {#if ours.cut > 0}
                            <button class="more" onclick={() => togglePane(index)}>Show all {ours.total.toLocaleString()} lines</button>
                          {/if}
                        {/if}
                      </div>
                      <button
                        class="pick"
                        class:on={chosen(index) === 'ours' && !edited}
                        onclick={() => pick(index, 'ours')}
                      >{section.deleted?.ours
                        ? (chosen(index) === 'ours' && !edited ? '✓ Deletes the file' : 'Delete the file')
                        : (chosen(index) === 'ours' && !edited ? '✓ Keeps ours' : 'Keep ours')}</button>
                    </div>

                    <div class="col result" class:picked={edited || chosen(index) === 'both'}>
                      <div class="col-head">
                        <span class="tag">Result</span>
                        <span class="faint">{edited ? 'edited by hand' : 'what the file will hold here'}</span>
                      </div>
                      <div class="col-body">
                        {#if removes}
                          <p class="empty-line">the file will be deleted</p>
                        {:else}
                          <textarea
                            class="result-text"
                            spellcheck="false"
                            aria-label="Result for conflict {blocks.indexOf(index) + 1}"
                            placeholder="Choose a side, or type the result here"
                            rows={Math.min(24, Math.max(3, resultText(index).split('\n').length))}
                            value={resultText(index)}
                            oninput={(e) => mergeStore.edit(index, e.currentTarget.value)}
                          ></textarea>
                        {/if}
                      </div>
                      <div class="result-picks">
                        <button
                          class="pick"
                          class:on={chosen(index) === 'both' && !edited}
                          disabled={!!section.deleted?.ours || !!section.deleted?.theirs}
                          title="Ours, then theirs"
                          onclick={() => pick(index, 'both')}
                        >{chosen(index) === 'both' && !edited ? '✓ Keeps both' : 'Keep both'}</button>
                        {#if edited}
                          <button class="pick" onclick={() => mergeStore.forget(index)} title="Throw away what you typed">Undo edits</button>
                        {/if}
                      </div>
                    </div>

                    <div class="col theirs" class:picked={chosen(index) === 'theirs' && !edited}>
                      <div class="col-head">
                        <span class="tag">Theirs</span>
                        <span class="faint mono">{sideName(section.labels.theirs, theirsName.replace(/^the /, ''))}</span>
                      </div>
                      <div class="col-body">
                        {#if section.deleted?.theirs}
                          <p class="empty-line">this side deleted the file</p>
                        {:else if theirs.total === 0}
                          <p class="empty-line">this side has nothing here</p>
                        {:else}
                          {#each theirs.lines as line, n (n)}
                            <div class="c-line"><span class="num">{n + 1}</span><span>{line}</span></div>
                          {/each}
                          {#if theirs.cut > 0}
                            <button class="more" onclick={() => togglePane(index)}>Show all {theirs.total.toLocaleString()} lines</button>
                          {/if}
                        {/if}
                      </div>
                      <button
                        class="pick"
                        class:on={chosen(index) === 'theirs' && !edited}
                        onclick={() => pick(index, 'theirs')}
                      >{section.deleted?.theirs
                        ? (chosen(index) === 'theirs' && !edited ? '✓ Deletes the file' : 'Delete the file')
                        : (chosen(index) === 'theirs' && !edited ? '✓ Keeps theirs' : 'Keep theirs')}</button>
                    </div>
                  </div>
                </div>
              {/if}
            {/each}

            {#if offer.truncated}
              <p class="notice faint">
                The common ancestor is too large to read in full, so only its beginning is shown.
              </p>
            {/if}
          </div>
        {/if}
      </div>

      <footer class="bar">
        <span class="faint">
          {#if offer && !offer.binary && blocks.length > 0}
            Writing the file replaces the markers with your choices; the operation can then continue from the status bar.
          {:else}
            Nothing is written unless you choose sides first.
          {/if}
        </span>
        <button class="discard" onclick={() => mergeStore.close()}>Close</button>
        <button
          class="apply"
          disabled={!offer || offer.binary || mergeStore.loading || unresolved > 0 || mergeStore.busy}
          onclick={() => mergeStore.apply()}
          title={unresolved > 0
            ? `Choose a side for the ${pluralize(unresolved, 'remaining conflict')} first`
            : 'Write the merged file and mark it resolved'}
        >{mergeStore.busy ? 'Saving…' : 'Mark resolved'}</button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: flex;
    padding: 24px;
    background: var(--scrim);
  }
  .scrim:focus { outline: none; }

  .panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    background: var(--bg-panel);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-modal);
    overflow: hidden;
  }

  header {
    flex: none;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px 8px 12px;
    border-bottom: 1px solid var(--border);
  }

  .titles { flex: 1; min-width: 0; }

  .path {
    display: flex;
    align-items: center;
    gap: 7px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 12.5px;
  }

  .status {
    flex: none;
    padding: 0 6px;
    border-radius: var(--radius-sm);
    background: var(--danger-subtle);
    color: var(--danger);
    font-family: var(--font-ui);
    font-size: 10.5px;
    line-height: 16px;
    font-weight: 600;
  }

  .sub {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-top: 2px;
    color: var(--text-faint);
    font-size: 11.5px;
  }
  .stat { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }

  .tools { flex: none; display: flex; align-items: center; gap: 8px; }
  .tools button {
    padding: 3px 10px;
    background: var(--bg-raised);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    font-size: 11.5px;
  }
  .tools button:hover:not(.close) { border-color: var(--accent); color: var(--accent); }
  .tools button.on { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }

  .close {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    background: none;
    border: 0;
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    font-size: 17px;
    line-height: 1;
  }
  .close:hover { background: var(--bg-hover); color: var(--text); }

  .progress {
    flex: none;
    display: flex;
    align-items: baseline;
    gap: 12px;
    padding: 5px 10px;
    background: var(--bg-panel);
    border-bottom: 1px solid var(--border);
    color: var(--text-dim);
    font-size: 11px;
  }
  .progress .count { font-family: var(--font-mono); color: var(--text); }
  .progress .faint { color: var(--danger); font-weight: 600; }
  .progress .hint { margin-left: auto; color: var(--text-faint); }

  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    background: var(--bg-sunken);
  }

  .file {
    min-width: min-content;
    font-family: var(--font-mono);
    font-size: 11.5px;
    line-height: 1.55;
  }

  .meta {
    margin: 0;
    padding: 7px 10px;
    background: var(--bg-raised);
    border-bottom: 1px solid var(--border);
    color: var(--text-dim);
    font-size: 11.5px;
  }

  .base-pane {
    margin: 10px;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .base-head {
    display: flex;
    gap: 8px;
    padding: 5px 10px;
    background: var(--bg-raised);
    border-bottom: 1px solid var(--border);
    color: var(--text-dim);
    font-family: var(--font-ui);
    font-size: 11px;
  }
  .base-head .faint { margin-left: auto; }
  .base-lines { max-height: 26vh; overflow: auto; }
  .base-row { display: grid; grid-template-columns: 44px 1fr; background: var(--bg-panel); }
  .base-row .num { color: var(--text-faint); text-align: right; padding-right: 8px; user-select: none; }
  .base-row .txt { white-space: pre-wrap; overflow-wrap: anywhere; }
  .base-row:nth-child(even) { background: var(--bg-sunken); }

  .context {
    margin: 10px;
    padding: 0 0 4px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-panel);
    opacity: 0.9;
  }
  .context-head {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 4px 10px;
    color: var(--text-faint);
    font-family: var(--font-ui);
    font-size: 10.5px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .context-line {
    display: grid;
    grid-template-columns: 44px 1fr;
    padding: 0 10px 0 0;
  }
  .context-line .num { color: var(--text-faint); text-align: right; padding-right: 8px; user-select: none; }
  .context-line.faded { color: var(--text-dim); }
  .context-line span:last-child { white-space: pre-wrap; overflow-wrap: anywhere; }
  .context-line + .context-line { border-top: 1px solid rgba(127, 127, 127, 0.08); }
  .fold {
    padding: 4px 10px;
    color: var(--text-faint);
    text-align: center;
  }

  .conflict {
    margin: 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    background: var(--bg-panel);
    overflow: hidden;
  }
  .conflict.done { box-shadow: inset 0 0 0 1px var(--accent); }

  .conflict-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    background: var(--bg-raised);
    border-bottom: 1px solid var(--border);
    font-size: 11px;
  }
  .badge {
    flex: none;
    padding: 0 6px;
    border-radius: var(--radius-sm);
    background: var(--warning-subtle);
    color: var(--warning);
    font-family: var(--font-ui);
    font-weight: 600;
  }
  .conflict.done .badge { background: rgba(99, 177, 117, 0.15); color: var(--success); }
  .state { color: var(--text-dim); }
  .state b { color: var(--text); font-family: var(--font-mono); font-size: 10.5px; }

  .cols {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 0;
  }

  .result-text {
    display: block;
    width: 100%;
    min-height: 100%;
    padding: 4px 10px;
    background: var(--bg-panel);
    border: 0;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: inherit;
    line-height: inherit;
    resize: vertical;
    white-space: pre;
    overflow-wrap: normal;
  }
  .result-text:focus { outline: 1px solid var(--accent); outline-offset: -1px; }
  .result-picks { display: flex; }
  .result-picks .pick { flex: 1; }
  .result-picks .pick + .pick { border-left: 1px solid var(--border); }
  .col { display: flex; flex-direction: column; min-width: 0; }
  .col + .col { border-left: 1px solid var(--border); }
  .col.picked { background: color-mix(in srgb, var(--accent) 4%, transparent); }
  .col.picked .col-head { color: var(--accent); }

  .col-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 4px 10px;
    border-bottom: 1px solid var(--border);
    font-family: var(--font-ui);
    font-size: 11px;
  }
  .tag { font-weight: 600; }
  .col.ours .tag { color: var(--success); }
  .col.theirs .tag { color: var(--accent); }
  .mono { font-family: var(--font-mono); font-size: 10.5px; }

  .col-body { max-height: 28vh; overflow: auto; flex: 1; }
  .c-line { display: grid; grid-template-columns: 40px 1fr; background: var(--bg-panel); }
  .c-line:nth-child(even) { background: var(--bg-sunken); }
  .c-line .num { color: var(--text-faint); text-align: right; padding-right: 8px; user-select: none; }
  .c-line span:last-child { white-space: pre-wrap; overflow-wrap: anywhere; padding-right: 8px; }

  .empty-line {
    margin: 0;
    padding: 14px 10px;
    color: var(--text-faint);
    text-align: center;
  }

  .more {
    width: 100%;
    padding: 4px;
    background: none;
    border: 0;
    border-top: 1px solid var(--border);
    color: var(--text-faint);
    font-size: 10.5px;
    cursor: pointer;
  }
  .more:hover { color: var(--accent); }

  .pick {
    padding: 5px 10px;
    background: var(--bg-sunken);
    border: 0;
    border-top: 1px solid var(--border);
    color: var(--text-dim);
    font-size: 11px;
    cursor: pointer;
  }
  .pick:hover:not(.on) { color: var(--accent); background: var(--bg-hover); }
  .col.ours .pick.on { background: var(--success); color: #fff; }
  .col.theirs .pick.on { background: var(--accent); color: var(--accent-text); }

  .notice {
    margin: 0;
    padding: 34px 20px;
    color: var(--text-dim);
    font-size: 12.5px;
    line-height: 1.7;
    text-align: center;
  }
  .notice.bad { color: var(--danger); white-space: pre-wrap; }
  .notice .faint, .notice.faint { color: var(--text-faint); font-size: 11.5px; }

  .bar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 7px 10px;
    background: var(--bg-panel);
    border-top: 1px solid var(--border);
    font-size: 11px;
  }
  .bar .faint { flex: 1; color: var(--text-faint); }

  .discard, .apply {
    padding: 4px 14px;
    background: var(--bg-raised);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    font-size: 12px;
  }
  .discard:hover { border-color: var(--text-dim); color: var(--text); }
  .apply { background: var(--accent); border-color: var(--accent); color: var(--accent-text); font-weight: 500; }
  .apply:hover:not(:disabled) { background: var(--accent-hover); }
  .apply:disabled { opacity: 0.45; cursor: default; }
</style>