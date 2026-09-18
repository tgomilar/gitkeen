<script lang="ts">
  /**
   * Settings, which today means choosing where commit suggestions come from.
   *
   * Each provider states what it is, whether it is connected and which one a
   * suggestion would actually use, because "connected" alone does not answer
   * the question a user asks when two are set up at once.
   *
   * A saved key is never sent back from the backend, so the field always
   * starts empty: changing a key means pasting a new one, and the panel says
   * so rather than showing a masked value that cannot be edited.
   */
  import { settingsStore } from '../state/settings.svelte';
  import Icon from './Icon.svelte';

  /** What has been typed for each provider, cleared once it is saved. */
  let drafts = $state<Record<string, string>>({});

  const rows = $derived(settingsStore.rows);

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      settingsStore.hide();
    }
  }

  async function save(id: string) {
    const key = (drafts[id] ?? '').trim();
    if (!key) return;
    if (await settingsStore.setKey(id, key)) drafts[id] = '';
  }

  async function disconnect(id: string) {
    await settingsStore.setKey(id, '');
    drafts[id] = '';
  }
</script>

<svelte:window on:keydown={onkeydown} />

<div class="scrim" role="presentation" onmousedown={() => settingsStore.hide()}></div>

<div class="panel" role="dialog" aria-modal="true" aria-label="Settings" tabindex="-1">
  <header>
    <h2>Commit message suggestions</h2>
    <button class="close" onclick={() => settingsStore.hide()} aria-label="Close settings">
      <Icon name="close" size={14} />
    </button>
  </header>

  <p class="intro">
    Gitalia can write the subject line from the change you are about to commit.
    Pick where that happens. A hosted provider sends the diff over the network;
    a local one runs on this machine and sends nothing anywhere.
  </p>

  {#each rows as row (row.id)}
    <section class="provider" class:on={row.configured}>
      <div class="head">
        <span class="name">{row.label}</span>
        {#if row.preferred}
          <span class="badge preferred">In use</span>
        {:else if row.configured}
          <span class="badge">Ready</span>
        {/if}
        {#if row.model}<span class="model">{row.model}</span>{/if}
      </div>

      <p class="detail">{row.detail}</p>

      {#if row.keyless}
        <!--
          A local server takes no key: it is available exactly when it is
          running, so the only useful control is a way to look again after
          starting it.
        -->
        <div class="row">
          <p class="state">
            {#if row.configured}
              Running and ready to use.
            {:else if row.id === 'lmstudio'}
              Not reachable. Start the server in LM Studio's Developer tab and
              load a model, then check again.
            {:else}
              Not running. Start it with <code>ollama serve</code>, then check again.
            {/if}
          </p>
          <button
            class="secondary"
            onclick={() => settingsStore.recheck(row.id)}
            disabled={settingsStore.busy === row.id}
          >
            {settingsStore.busy === row.id ? 'Checking…' : 'Check again'}
          </button>
        </div>
      {:else if row.source === 'environment'}
        <!--
          An exported variable wins over anything saved here, so offering a
          field would be offering a control that changes nothing.
        -->
        <p class="state">
          Using <code>{row.variable}</code> from the environment. Unset it and restart
          the dev server to use a key saved here instead.
        </p>
      {:else}
        <div class="row">
          <input
            type="password"
            bind:value={drafts[row.id]}
            placeholder={row.saved ? 'Paste a new key to replace the saved one' : 'Paste an API key'}
            spellcheck="false"
            autocomplete="off"
            aria-label={`${row.label} API key`}
            onkeydown={(e) => e.key === 'Enter' && save(row.id)}
          />
          <button
            class="primary"
            onclick={() => save(row.id)}
            disabled={!drafts[row.id]?.trim() || settingsStore.busy === row.id}
          >
            {settingsStore.busy === row.id ? 'Saving…' : 'Save'}
          </button>
          {#if row.saved}
            <button class="secondary" onclick={() => disconnect(row.id)}>Disconnect</button>
          {/if}
        </div>
        <p class="hint">
          {#if row.saved}A key is saved. It cannot be shown again, so changing it means pasting a new one.{/if}
          {#if row.console}
            <a href={row.console} target="_blank" rel="noreferrer noopener">Get a key</a>
          {/if}
          or set <code>{row.variable}</code> in your environment.
        </p>
      {/if}
    </section>
  {/each}

  <footer>
    {#if settingsStore.file}
      <span>Keys are saved in <code>{settingsStore.file}</code>, readable only by you.</span>
    {/if}
  </footer>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 80;
  }

  .panel {
    position: fixed;
    z-index: 81;
    top: 12%;
    left: 50%;
    transform: translateX(-50%);
    width: min(520px, calc(100vw - 32px));
    max-height: 76vh;
    overflow-y: auto;
    padding: 18px 20px 14px;
    background: var(--bg-raised);
    border: 1px solid var(--border-strong);
    border-top: 2px solid var(--border-strong);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-modal);
    outline: none;
  }

  header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 6px;
  }

  h2 {
    flex: 1;
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }

  .close {
    display: flex;
    padding: 4px;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--text-dim);
  }
  .close:hover { background: var(--bg-hover); border-color: var(--border); }

  .intro {
    margin: 0 0 14px;
    color: var(--text-dim);
    font-size: 12px;
    line-height: 1.5;
  }

  .provider {
    padding: 12px 0;
    border-top: 1px solid var(--border);
  }

  .head {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .name { font-weight: 600; }

  .badge {
    padding: 1px 6px;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    color: var(--text-dim);
    font-size: 10.5px;
  }

  .badge.preferred {
    border-color: var(--success);
    color: var(--success);
  }

  .model {
    margin-left: auto;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: 10.5px;
  }

  .detail {
    margin: 4px 0 8px;
    color: var(--text-dim);
    font-size: 12px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  input {
    flex: 1;
    min-width: 0;
    padding: 5px 8px;
    background: var(--bg-sunken);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  input:focus { border-color: var(--accent); outline: none; }

  .primary, .secondary {
    flex: none;
    padding: 5px 11px;
    border-radius: var(--radius-sm);
    font-size: 12px;
  }

  .primary {
    background: var(--accent);
    border: 1px solid var(--accent);
    color: var(--accent-text);
  }
  .primary:disabled { opacity: 0.45; cursor: default; }

  .secondary {
    background: none;
    border: 1px solid var(--border-strong);
    color: var(--text-dim);
  }
  .secondary:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }

  .state, .hint {
    margin: 6px 0 0;
    color: var(--text-dim);
    font-size: 11.5px;
    line-height: 1.5;
  }

  .hint a { color: var(--accent); }

  code {
    padding: 0 3px;
    background: var(--bg-sunken);
    border-radius: 3px;
    font-family: var(--font-mono);
    font-size: 11px;
  }

  footer {
    padding-top: 12px;
    border-top: 1px solid var(--border);
    color: var(--text-faint);
    font-size: 11px;
  }
</style>
