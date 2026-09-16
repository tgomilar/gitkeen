<script lang="ts">
  import { repoStore } from '../state/repo.svelte';
  import { readRecent, forgetRepo, type RecentRepo } from '../state/recent';
  import { relativeTime } from '../format';

  let path = $state('');
  let recent = $state<RecentRepo[]>([]);
  let field = $state<HTMLInputElement | null>(null);

  $effect(() => {
    recent = readRecent();
    field?.focus();
  });

  /**
   * People paste a Gitalia deep link here instead of into the address bar,
   * so take the repository out of it rather than treating it as a folder.
   */
  function unwrapPath(input: string): string {
    const text = input.trim();
    if (!/^https?:\/\//i.test(text)) return text;
    try {
      const repo = new URL(text).searchParams.get('repo');
      if (repo) return repo;
    } catch {
      /* not a URL after all, fall through and let Git report on it */
    }
    return text;
  }

  async function open(target: string) {
    const resolved = unwrapPath(target);
    if (!resolved.trim()) return;
    path = resolved;
    await repoStore.open(resolved.trim());
    recent = readRecent();
  }

  function drop(event: DragEvent) {
    event.preventDefault();
    // The browser gives no real path, so this only helps under Tauri later.
    const item = event.dataTransfer?.files?.[0] as (File & { path?: string }) | undefined;
    if (item?.path) open(item.path);
  }
</script>

<div class="welcome" ondrop={drop} ondragover={(e) => e.preventDefault()} role="presentation">
  <div class="card">
    <div class="brand">
      <svg viewBox="0 0 34 34" width="30" height="30" aria-hidden="true">
        <path d="M6 28 V10 a4 4 0 0 1 4-4 h6" stroke="var(--accent)" stroke-width="2.2" fill="none" />
        <path d="M6 20 h10 a4 4 0 0 0 4-4 V6" stroke="var(--text-faint)" stroke-width="2.2" fill="none" />
        <circle cx="6" cy="28" r="3.4" fill="var(--accent)" />
        <circle cx="20" cy="6" r="3.4" fill="var(--bg-panel)" stroke="var(--text-faint)" stroke-width="2.2" />
        <circle cx="16" cy="6" r="0" fill="none" />
      </svg>
      <div>
        <h1>Gitalia</h1>
        <p class="tagline">Your editor writes code. Gitalia manages your history.</p>
      </div>
    </div>

    <form
      class="opener"
      onsubmit={(e) => { e.preventDefault(); open(path); }}
    >
      <input
        bind:this={field}
        bind:value={path}
        placeholder="/path/to/repository"
        spellcheck="false"
        autocomplete="off"
        aria-label="Repository path"
      />
      <button type="submit" disabled={repoStore.opening || !path.trim()}>
        {repoStore.opening ? 'Opening…' : 'Open'}
      </button>
    </form>

    <p class="note">
      Paste a path to any folder inside a repository. Gitalia finds the repository root itself.
    </p>

    {#if repoStore.openError}
      <p class="error">{repoStore.openError}</p>
    {/if}

    {#if recent.length}
      <h2 class="recent-title">Recent</h2>
      <ul class="recent">
        {#each recent as item (item.root)}
          <li>
            <button class="entry" onclick={() => open(item.root)}>
              <span class="name">{item.name}</span>
              <span class="path" title={item.root}><bdi dir="ltr">{item.root}</bdi></span>
              <span class="when">{relativeTime(item.openedAt)}</span>
            </button>
            <button
              class="forget"
              onclick={() => (recent = forgetRepo(item.root))}
              aria-label="Remove {item.name} from recent"
              title="Remove from recent"
            >×</button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .welcome {
    display: grid;
    place-items: center;
    height: 100%;
    padding: 24px;
    background: var(--bg-app);
    overflow: auto;
  }

  .card {
    width: min(580px, 100%);
    padding: 26px 28px 24px;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 13px;
    margin-bottom: 22px;
  }

  h1 {
    margin: 0;
    font-size: 19px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .tagline {
    margin: 2px 0 0;
    color: var(--text-dim);
    font-size: 12.5px;
  }

  .opener {
    display: flex;
    gap: 8px;
  }

  .opener input {
    flex: 1;
    padding: 7px 10px;
    background: var(--bg-sunken);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .opener input:focus { background: var(--bg-panel); border-color: var(--accent); outline: none; }

  .opener button {
    padding: 7px 18px;
    background: var(--accent);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    color: var(--accent-text);
    font-weight: 500;
  }
  .opener button:hover:not(:disabled) { background: var(--accent-hover); }
  .opener button:disabled { opacity: 0.5; cursor: default; }

  .note {
    margin: 8px 0 0;
    color: var(--text-faint);
    font-size: 11.5px;
  }

  .error {
    margin: 12px 0 0;
    padding: 8px 10px;
    background: var(--danger-subtle);
    border-left: 2px solid var(--danger);
    border-radius: var(--radius-sm);
    color: var(--danger);
    font-size: 12px;
    font-family: var(--font-mono);
    overflow-wrap: anywhere;
  }

  .recent-title {
    margin: 24px 0 6px;
    color: var(--text-faint);
    font-size: 10.5px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.055em;
  }

  .recent {
    margin: 0;
    padding: 0;
    list-style: none;
    border-top: 1px solid var(--border);
  }

  .recent li {
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--border);
  }

  .entry {
    flex: 1;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: baseline;
    gap: 10px;
    min-width: 0;
    padding: 7px 8px;
    background: none;
    border: 0;
    text-align: left;
  }
  .entry:hover { background: var(--bg-hover); }

  .name { font-weight: 500; }

  .path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    /* RTL clips the start of the path, keeping the filename visible.
       The inner dir="ltr" span keeps the characters themselves in order,
       which plain RTL would reorder for a leading "." or "/". */
    direction: rtl;
    text-align: left;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .when {
    color: var(--text-faint);
    font-size: 11px;
    white-space: nowrap;
  }

  .forget {
    padding: 4px 9px;
    background: none;
    border: 0;
    color: var(--text-faint);
    font-size: 15px;
  }
  .forget:hover { color: var(--danger); }
</style>
