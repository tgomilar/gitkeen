<script lang="ts">
  /**
   * The Help tool window: what Gitkeen can do, in short entries grouped by
   * task, each with its shortcut, the Git command it matches, and a way to go
   * straight to it. The content is in help.ts.
   */
  import { searchHelp, keyCaps, withMod, DOCS_URL } from '../help';
  import type { HelpTarget } from '../help';

  interface Props {
    onshow: (target: HelpTarget) => void;
  }

  let { onshow }: Props = $props();

  let query = $state('');
  let field = $state<HTMLInputElement | null>(null);
  const groups = $derived(searchHelp(query));

  export function focusSearch() {
    field?.focus();
  }
</script>

<section class="panel">
  <div class="toolbar">
    <span class="title">Help</span>
  </div>

  <div class="search">
    <input
      bind:this={field}
      bind:value={query}
      type="search"
      placeholder="Search help, for example squash"
      aria-label="Search help"
      onkeydown={(e) => { if (e.key === 'Escape') { query = ''; (e.target as HTMLElement).blur(); } }}
    />
  </div>

  <div class="scroll">
    {#if groups.length === 0}
      <p class="empty">Nothing matches "{query}". Try the command palette, which lists every command.</p>
    {/if}

    {#each groups as group (group.title)}
      <h3>{group.title}</h3>
      <ul>
        {#each group.entries as entry (entry.title)}
          <li>
            <div class="head">
              <span class="name">{entry.title}</span>
              {#if entry.keys}
                <span class="keys">
                  {#each entry.keys as keys, i (keys)}
                    {#if i > 0}<span class="or">·</span>{/if}
                    <span class="combo">{#each keyCaps(keys) as cap, j (j)}<kbd>{cap}</kbd>{/each}</span>
                  {/each}
                </span>
              {/if}
            </div>
            <p class="text">{withMod(entry.text)}</p>
            {#if entry.where || entry.git || entry.show}
              <div class="meta">
                {#if entry.where}<span>{entry.where}</span>{/if}
                {#if entry.git}<code title="The Git command this matches">{entry.git}</code>{/if}
                {#if entry.show}
                  <button class="show" onclick={() => onshow(entry.show!)}>Show me</button>
                {/if}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/each}
  </div>

  <footer>
    <span>Press <kbd>?</kbd> to open Help.</span>
    <a href={DOCS_URL} target="_blank" rel="noreferrer">Full guide ↗</a>
  </footer>
</section>

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
    display: flex;
    align-items: center;
    height: 30px;
    padding: 0 10px;
    border-bottom: 1px solid var(--border);
  }
  .title { font-size: 12.5px; font-weight: 600; }

  .search { padding: 8px 10px 4px; }
  .search input {
    width: 100%;
    height: 26px;
    padding: 0 8px;
    background: var(--bg-sunken);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text);
    font-size: 12px;
  }
  .search input:focus { outline: none; border-color: var(--accent); }

  .scroll { flex: 1; overflow: auto; padding: 4px 10px 12px; }

  .empty { margin: 8px 0; color: var(--text-faint); font-size: 11.5px; line-height: 1.45; }

  h3 {
    margin: 12px 0 2px;
    color: var(--text-faint);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  ul { margin: 0; padding: 0; list-style: none; }

  li { padding: 7px 0; border-top: 1px solid var(--border); }
  li:first-child { border-top: 0; }

  .head { display: flex; align-items: baseline; gap: 8px; }
  .name { flex: 1; min-width: 0; font-size: 12px; font-weight: 600; color: var(--text); }

  .keys { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 3px; }
  .combo { display: inline-flex; gap: 2px; }
  .or { color: var(--text-faint); font-size: 10px; }

  kbd {
    display: inline-block;
    min-width: 16px;
    padding: 0 4px;
    background: var(--bg-sunken);
    border: 1px solid var(--border-strong);
    border-bottom-width: 2px;
    border-radius: 3px;
    color: var(--text-dim);
    font-family: var(--font-ui);
    font-size: 10.5px;
    line-height: 15px;
    text-align: center;
  }

  .text { margin: 3px 0 0; color: var(--text-dim); font-size: 11.5px; line-height: 1.45; }

  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    margin-top: 4px;
    color: var(--text-faint);
    font-size: 11px;
  }
  .meta code { font-family: var(--font-mono); font-size: 10.5px; color: var(--text-faint); }

  .show {
    margin-left: auto;
    padding: 1px 8px;
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--accent);
    font-size: 11px;
  }
  .show:hover { background: var(--bg-hover); border-color: var(--border-strong); }

  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 10px;
    border-top: 1px solid var(--border);
    color: var(--text-faint);
    font-size: 11px;
  }
  footer a { display: inline-flex; align-items: center; gap: 3px; color: var(--accent); text-decoration: none; }
  footer a:hover { text-decoration: underline; }
</style>
