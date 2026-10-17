<script lang="ts">
  import { githubStore } from '../state/github.svelte';
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
  import type { ModelPull } from '../git/types';

  /** What has been typed for each provider, cleared once it is saved. */
  let drafts = $state<Record<string, string>>({});

  const rows = $derived(settingsStore.rows);
  const ollama = $derived(settingsStore.ollama);
  const pull = $derived(ollama?.pull ?? null);
  const lmstudio = $derived(settingsStore.lmstudio);
  const lmstudioDownloaded = $derived(settingsStore.lmstudioDownloaded);
  /** The downloaded LM Studio model picked to load; empty means the first. */
  let loadChoice = $state('');

  /** How far a layer has got. Ollama reports layers one by one, so between them there is no figure. */
  function pullPercent(p: ModelPull): number {
    return p.total ? Math.floor((p.completed / p.total) * 100) : 0;
  }

  const gb = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`;

  /** Ollama's step in words a person reads, with the size while the bulk of it downloads. */
  function pullText(p: ModelPull): string {
    if (p.total && p.status.startsWith('pulling')) {
      return `Downloading ${p.model}: ${pullPercent(p)}%, ${gb(p.completed)} of ${gb(p.total)}. You can close Settings meanwhile.`;
    }
    if (p.status.startsWith('verifying')) return `Checking the download of ${p.model}…`;
    if (p.status.startsWith('writing')) return `Finishing ${p.model}…`;
    return `Preparing to download ${p.model}…`;
  }

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
    <h2>AI and GitHub</h2>
    <button class="close" onclick={() => settingsStore.hide()} aria-label="Close settings">
      <Icon name="close" size={14} />
    </button>
  </header>

  <p class="intro">
    Gitkeen can write the subject line from the change you are about to commit,
    and explain commits, conflicts and errors. Press Use this to pick where that
    happens. A hosted provider sends the diff over the network; a local one runs
    on this machine and sends nothing anywhere.
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
        <!-- A running local server's model has its own menu below. -->
        {#if row.model && !((row.id === 'ollama' && ollama?.running) || (row.id === 'lmstudio' && lmstudio?.running))}<span class="model">{row.model}</span>{/if}
        {#if row.configured && !row.preferred}
          <button
            class="secondary use"
            onclick={() => settingsStore.choose(row.id)}
            disabled={settingsStore.busy === row.id}
          >
            Use this
          </button>
        {/if}
      </div>

      <p class="detail">{row.detail}</p>

      {#if row.id === 'ollama' && ollama}
        <!--
          Ollama can be taken from installed to ready without a terminal, so
          the row offers whichever step is missing: install, start, download
          a model, then choose between models once there are several.
        -->
        {#if pull && !pull.done}
          <p class="state">{pullText(pull)}</p>
          <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={pullPercent(pull)}>
            <span style:width="{pullPercent(pull)}%"></span>
          </div>
        {:else if !ollama.installed}
          <div class="row">
            <p class="state">Ollama is not installed on this machine.</p>
            <button class="secondary" onclick={() => settingsStore.recheck('ollama')} disabled={settingsStore.busy === 'ollama'}>
              {settingsStore.busy === 'ollama' ? 'Checking…' : 'Check again'}
            </button>
          </div>
          <a class="get" href={row.console} target="_blank" rel="noreferrer noopener">{row.consoleLabel} ↗</a>
        {:else if !ollama.running}
          <div class="row">
            <p class="state">Installed, but not running.</p>
            <button class="primary" onclick={() => settingsStore.startOllama()} disabled={settingsStore.busy === 'ollama'}>
              {settingsStore.busy === 'ollama' ? 'Starting…' : 'Start Ollama'}
            </button>
          </div>
        {:else if ollama.models.length === 0}
          <div class="row">
            <p class="state">Running, but no model is downloaded yet.</p>
            <button class="primary" onclick={() => settingsStore.pullModel(ollama.recommended)}>
              Download {ollama.recommended}
            </button>
          </div>
          <p class="hint faint">
            A small, quick model that is good at one-line summaries. About 2 GB, downloaded once.
          </p>
        {:else}
          <div class="row">
            <label class="state" for="ollama-model">Model</label>
            <select
              id="ollama-model"
              value={row.model ?? ''}
              onchange={(e) => settingsStore.chooseModel('ollama', e.currentTarget.value)}
              disabled={settingsStore.busy === 'ollama'}
            >
              {#each ollama.models as model (model)}
                <option value={model}>{model}</option>
              {/each}
            </select>
          </div>
          {#if !ollama.hasRecommended}
            <p class="hint faint">
              Running and ready. Suggestions slow?
              <button class="link" onclick={() => settingsStore.pullModel(ollama.recommended)}>Download {ollama.recommended}</button>,
              a small model made for quick answers.
            </p>
          {/if}
        {/if}
        {#if pull?.done && pull.error}
          <p class="hint error">The download of {pull.model} failed: {pull.error}</p>
        {/if}
      {:else if row.id === 'lmstudio' && lmstudio}
        <!--
          The same steps for LM Studio, through its lms command: start the
          server, load a downloaded model, then choose between loaded ones.
        -->
        {#if !lmstudio.installed}
          <div class="row">
            <p class="state">LM Studio is not installed on this machine.</p>
            <button class="secondary" onclick={() => settingsStore.recheck('lmstudio')} disabled={settingsStore.busy === 'lmstudio'}>
              {settingsStore.busy === 'lmstudio' ? 'Checking…' : 'Check again'}
            </button>
          </div>
          <a class="get" href={row.console} target="_blank" rel="noreferrer noopener">{row.consoleLabel} ↗</a>
        {:else if !lmstudio.running}
          <div class="row">
            <p class="state">Installed, but its server is not running.</p>
            {#if lmstudio.cli}
              <button class="primary" onclick={() => settingsStore.startLmstudio()} disabled={settingsStore.busy === 'lmstudio'}>
                {settingsStore.busy === 'lmstudio' ? 'Starting…' : 'Start server'}
              </button>
            {:else}
              <button class="secondary" onclick={() => settingsStore.recheck('lmstudio')} disabled={settingsStore.busy === 'lmstudio'}>
                {settingsStore.busy === 'lmstudio' ? 'Checking…' : 'Check again'}
              </button>
            {/if}
          </div>
          {#if !lmstudio.cli}
            <p class="hint faint">
              Start the server in LM Studio's Developer tab. Gitkeen can start it for you once LM Studio has
              added its <code>lms</code> command, which it does the first time it opens.
            </p>
          {/if}
        {:else if lmstudio.models.length === 0}
          {#if lmstudioDownloaded?.length}
            <div class="row">
              <label class="state" for="lmstudio-load">Load</label>
              <select id="lmstudio-load" bind:value={loadChoice} disabled={settingsStore.busy === 'lmstudio'}>
                {#each lmstudioDownloaded as model (model.key)}
                  <option value={model.key}>{model.name} ({(model.size / 1e9).toFixed(1)} GB)</option>
                {/each}
              </select>
              <button
                class="primary"
                onclick={() => settingsStore.loadLmstudio(loadChoice || lmstudioDownloaded[0].key)}
                disabled={settingsStore.busy === 'lmstudio'}
              >
                {settingsStore.busy === 'lmstudio' ? 'Loading…' : 'Load'}
              </button>
            </div>
            <p class="hint faint">The server is running with no model loaded. A smaller model answers faster.</p>
          {:else}
            <p class="state">The server is running, but no model is downloaded in LM Studio yet.</p>
            <a class="get" href="https://lmstudio.ai/models" target="_blank" rel="noreferrer noopener">Find a model for LM Studio ↗</a>
          {/if}
        {:else}
          <div class="row">
            <label class="state" for="lmstudio-model">Model</label>
            <select
              id="lmstudio-model"
              value={row.model ?? ''}
              onchange={(e) => settingsStore.chooseModel('lmstudio', e.currentTarget.value)}
              disabled={settingsStore.busy === 'lmstudio'}
            >
              {#each lmstudio.models as model (model)}
                <option value={model}>{model}</option>
              {/each}
            </select>
          </div>
        {/if}
      {:else if row.keyless}
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
        {#if !row.configured && row.console}
          <a class="get" href={row.console} target="_blank" rel="noreferrer noopener">{row.consoleLabel} ↗</a>
        {/if}
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
        {#if row.saved}
          <p class="hint">A key is saved. It cannot be shown again, so changing it means pasting a new one.</p>
        {/if}
        {#if row.console}
          <a class="get" href={row.console} target="_blank" rel="noreferrer noopener">{row.consoleLabel} ↗</a>
        {/if}
        <p class="hint faint">Or set <code>{row.variable}</code> in your environment instead of saving a key here.</p>
      {/if}
    </section>
  {/each}

  <section class="provider github" class:on={githubStore.connected}>
    <div class="head">
      <span class="name">GitHub</span>
      {#if githubStore.connected}<span class="badge preferred">Connected</span>{/if}
      {#if githubStore.status?.login}<span class="model">as {githubStore.status.login}</span>{/if}
    </div>
    <p class="detail">A token lets Gitkeen list pull requests, open one for a branch, and show whether checks passed.</p>
    {#if settingsStore.github?.source === 'environment'}
      <p class="state">Using <code>GITHUB_TOKEN</code> from the environment.</p>
    {:else}
      <div class="row">
        <input
          type="password"
          bind:value={drafts['github']}
          placeholder={settingsStore.github?.saved ? 'Paste a new token to replace the saved one' : 'Paste a GitHub token'}
          spellcheck="false"
          autocomplete="off"
          aria-label="GitHub token"
          onkeydown={(e) => e.key === 'Enter' && save('github')}
        />
        <button class="primary" onclick={() => save('github')} disabled={!drafts['github']?.trim() || settingsStore.busy === 'github'}>
          {settingsStore.busy === 'github' ? 'Saving…' : 'Save'}
        </button>
        {#if settingsStore.github?.saved}
          <button class="secondary" onclick={() => disconnect('github')}>Disconnect</button>
        {/if}
      </div>
      {#if githubStore.status?.tokenSource === 'gh' || settingsStore.github?.saved}
        <p class="hint">
          {#if githubStore.status?.tokenSource === 'gh'}Using the GitHub CLI's sign-in for now. A token saved here takes over.{/if}
          {#if settingsStore.github?.saved}A token is saved. It cannot be shown again.{/if}
        </p>
      {/if}
      <a class="get" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer noopener">Create a GitHub token ↗</a>
      <p class="hint faint">
        Give it access to this repository, with Pull requests (read and write), and Commit statuses and Actions (read).
      </p>
    {/if}
  </section>

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

  .name { flex: none; font-weight: 600; }
  .badge, .use { flex: none; }

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
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

  /* Sits after the model name, or takes its place at the end of the row. */
  .use { margin-left: auto; padding: 2px 9px; font-size: 11px; }
  .model + .use { margin-left: 0; }

  .state, .hint {
    margin: 6px 0 0;
    color: var(--text-dim);
    font-size: 11.5px;
    line-height: 1.5;
  }

  .hint.faint { color: var(--text-faint); }
  .hint.error { color: var(--danger); }

  .row .state { flex: 1; margin: 0; }
  label.state { flex: none; }

  select {
    flex: 1;
    min-width: 0;
    padding: 4px 6px;
    background: var(--bg-sunken);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  select:focus { border-color: var(--accent); outline: none; }

  .bar {
    height: 4px;
    margin-top: 8px;
    overflow: hidden;
    background: var(--bg-sunken);
    border-radius: 2px;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 0.3s ease;
  }

  .link {
    padding: 0;
    background: none;
    border: none;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }
  .link:hover { text-decoration: underline; }

  /* Where to get a key or the app, on a line of its own so it reads as the next step. */
  .get {
    display: inline-block;
    margin-top: 8px;
    color: var(--accent);
    font-size: 12px;
    font-weight: 500;
    text-decoration: none;
  }
  .get:hover { text-decoration: underline; }

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
