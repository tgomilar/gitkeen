<script lang="ts">
  /**
   * The Git LFS window: what the repository stores in LFS, and whether the
   * content of those files is on this computer.
   */
  import Icon from './Icon.svelte';
  import { lfsStore } from '../state/lfs.svelte';

  const status = $derived(lfsStore.status);
  let pattern = $state('');

  function size(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes / 1024, unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
    return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
  }

  async function addPattern(event: SubmitEvent) {
    event.preventDefault();
    const value = pattern.trim();
    if (!value) return;
    await lfsStore.track(value, true);
    pattern = '';
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      lfsStore.hide();
    }
  }

  function autofocus(node: HTMLElement) {
    node.focus();
  }
</script>

<svelte:window {onkeydown} />

<div class="scrim" role="presentation" onmousedown={() => lfsStore.hide()}></div>

<div class="panel" role="dialog" aria-modal="true" aria-label="Git LFS" tabindex="-1" use:autofocus>
  <header>
    <h2>Git LFS</h2>
    <button class="close" onclick={() => lfsStore.hide()} aria-label="Close">
      <Icon name="close" size={14} />
    </button>
  </header>

  <p class="intro">
    Git LFS keeps large files, such as images, videos and builds, outside the repository. Git
    commits a small pointer to each one, and the content is downloaded when it is needed.
  </p>

  {#if !status}
    <p class="note">Reading…</p>
  {:else if !status.installed}
    <p class="warn">
      git-lfs is not installed on this computer.
      {#if status.patterns.length}This repository stores {status.patterns.map((p) => p.pattern).join(', ')} in LFS, so those files hold only pointers until it is installed.{/if}
      Install it from git-lfs.com, or with <code>brew install git-lfs</code> on a Mac.
    </p>
  {:else}
    {#if !status.ready}
      <div class="setup">
        <p>Git LFS is installed, but not set up for this repository. Until it is, tracked files are committed as they are and their content is not downloaded.</p>
        <button class="primary" onclick={() => lfsStore.install()} disabled={!!lfsStore.busy}>Set up for this repository</button>
      </div>
    {/if}

    <section>
      <h3>Stored in LFS</h3>
      {#if status.patterns.length === 0}
        <p class="note">No file patterns yet.</p>
      {:else}
        <ul class="patterns">
          {#each status.patterns as p (p.pattern + p.source)}
            <li>
              <code>{p.pattern}</code>
              <span class="faint">{p.source}</span>
              <button class="link" onclick={() => lfsStore.track(p.pattern, false)} disabled={!!lfsStore.busy}>Stop tracking</button>
            </li>
          {/each}
        </ul>
      {/if}
      <form class="add" onsubmit={addPattern}>
        <input bind:value={pattern} placeholder="*.psd" spellcheck="false" aria-label="File pattern to store in LFS" />
        <button type="submit" disabled={!pattern.trim() || !!lfsStore.busy || !status.ready}
          title={status.ready ? 'Store files matching this pattern in LFS from now on' : 'Set Git LFS up for this repository first'}>Track</button>
      </form>
      <p class="note">Tracking writes <code>.gitattributes</code>. Commit it so others store the same files in LFS.</p>
    </section>

    <section>
      <h3>
        Files <span class="faint">{status.files.length}</span>
        {#if lfsStore.missing > 0}
          <span class="missing">{lfsStore.missing} not downloaded</span>
          <button class="primary small" onclick={() => lfsStore.pull()} disabled={!!lfsStore.busy}>
            {lfsStore.busy === 'Download the LFS files' ? 'Downloading…' : 'Download them'}
          </button>
        {/if}
      </h3>
      {#if status.files.length === 0}
        <p class="note">No LFS files in this commit.</p>
      {:else}
        <ul class="files">
          {#each status.files as file (file.path)}
            <li class:missing={!file.downloaded}>
              <span class="path mono">{file.path}</span>
              <span class="size">{size(file.size)}</span>
              <span class="state">{file.downloaded ? 'here' : 'pointer only'}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
    <p class="note faint">{status.version}</p>
  {/if}
</div>

<style>
  .scrim { position: fixed; inset: 0; z-index: 80; }

  .panel {
    position: fixed;
    z-index: 81;
    top: 10%;
    left: 50%;
    transform: translateX(-50%);
    width: min(560px, calc(100vw - 32px));
    max-height: 80vh;
    overflow-y: auto;
    padding: 18px 20px 14px;
    background: var(--bg-raised);
    border: 1px solid var(--border-strong);
    border-top: 2px solid var(--border-strong);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-modal);
    outline: none;
  }

  header { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; }
  h2 { flex: 1; margin: 0; font-size: 14px; font-weight: 600; }
  .close {
    display: flex;
    padding: 4px;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--text-dim);
  }
  .close:hover { background: var(--bg-hover); border-color: var(--border); }

  .intro { margin: 0 0 12px; color: var(--text-dim); font-size: 12px; line-height: 1.5; }
  .note { margin: 6px 0 0; color: var(--text-dim); font-size: 11.5px; }
  .faint { color: var(--text-faint); font-weight: 400; }
  .warn { color: var(--warning); font-size: 12px; line-height: 1.5; }
  code { font-family: var(--font-mono); font-size: 11.5px; }
  .mono { font-family: var(--font-mono); }

  .setup {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    margin-bottom: 12px;
    border: 1px solid var(--border-strong);
    border-left: 3px solid var(--warning);
    border-radius: var(--radius-sm);
    font-size: 12px;
  }
  .setup p { margin: 0; }
  .setup .primary { align-self: flex-start; }

  section { padding: 10px 0; border-top: 1px solid var(--border); }
  h3 { display: flex; align-items: center; gap: 8px; margin: 0 0 6px; font-size: 12px; font-weight: 600; }
  .missing { color: var(--warning); font-weight: 400; }

  ul { margin: 0; padding: 0; list-style: none; }
  .patterns li, .files li { display: flex; align-items: baseline; gap: 10px; padding: 3px 0; font-size: 12px; }
  .patterns .link { margin-left: auto; }
  .files .path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11.5px; }
  .files .size { color: var(--text-dim); font-variant-numeric: tabular-nums; }
  .files .state { width: 80px; color: var(--success); font-size: 11px; text-align: right; }
  .files li.missing .state { color: var(--warning); }

  .add { display: flex; gap: 6px; margin-top: 8px; }
  .add input {
    flex: 1;
    padding: 5px 8px;
    background: var(--bg-sunken);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .add input:focus { border-color: var(--accent); outline: none; }
  .add button, .primary {
    padding: 5px 12px;
    background: var(--accent);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    color: var(--accent-text);
    font-size: 12px;
  }
  .primary.small { padding: 2px 8px; font-size: 11px; }
  .add button:disabled, .primary:disabled { opacity: 0.5; }
  .link { background: none; border: 0; color: var(--text-dim); font-size: 11.5px; }
  .link:hover:not(:disabled) { color: var(--danger); text-decoration: underline; }
</style>
