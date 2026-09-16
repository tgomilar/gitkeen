<script lang="ts">
  import { repoStore } from '../state/repo.svelte';
  import { absoluteTime, relativeTime, initials, authorColor, pluralize } from '../format';
  import { toasts } from '../state/toasts.svelte';
  import { canSquash, squashCommits } from '../actions';
  import type { Commit } from '../git/types';

  const selected = $derived(
    repoStore.selection.length === 1 ? repoStore.commitByHash(repoStore.selection[0]) : undefined
  );

  const selectedCommits = $derived(
    repoStore.selection
      .map((hash) => repoStore.commitByHash(hash))
      .filter((c): c is Commit => !!c)
  );

  const squashable = $derived(canSquash(selectedCommits));

  // Load the body and file stats whenever a single commit is selected.
  $effect(() => {
    const hash = selected?.hash;
    if (hash && repoStore.detailsFor !== hash) repoStore.loadDetails(hash);
  });

  const details = $derived(repoStore.detailsFor === selected?.hash ? repoStore.details : null);

  /** The subject is already in the header; show only what follows it. */
  const body = $derived.by(() => {
    if (!details || !selected) return '';
    const text = details.body;
    return text.startsWith(selected.subject) ? text.slice(selected.subject.length).trim() : text;
  });

  const totals = $derived.by(() => {
    if (!details) return null;
    let added = 0, removed = 0, binary = 0;
    for (const f of details.files) {
      added += f.added ?? 0;
      removed += f.removed ?? 0;
      if (f.binary) binary++;
    }
    return { added, removed, binary, count: details.files.length };
  });

  async function copyHash() {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected.hash);
      toasts.info('Copied commit hash');
    } catch {
      toasts.error('Could not copy to the clipboard');
    }
  }
</script>

<section class="details">
  {#if repoStore.selection.length > 1}
    <div class="multi">
      <strong>{repoStore.selection.length} commits selected</strong>
      {#if squashable.ok}
        <span>They sit next to each other in history, so they can be combined into one commit.</span>
        <button class="action" onclick={() => squashCommits(selectedCommits)}>
          Squash {repoStore.selection.length} commits…
        </button>
      {:else}
        <span>These cannot be squashed: {squashable.reason}.</span>
        <span class="faint">Squashing needs a continuous run of ordinary commits.</span>
      {/if}
    </div>
  {:else if !selected}
    <div class="empty">Select a commit to see its details.</div>
  {:else}
    <header>
      <h2 class="subject">{selected.subject}</h2>
      <div class="meta">
        <span class="avatar" style="background: {authorColor(selected.authorEmail)}">
          {initials(selected.author)}
        </span>
        <span class="who">{selected.author}</span>
        <span class="sep">·</span>
        <time title={absoluteTime(selected.authorDate)}>{relativeTime(selected.authorDate)}</time>
        <span class="sep">·</span>
        <button class="hash mono" onclick={copyHash} title="Copy full hash">{selected.shortHash}</button>
        {#if selected.parents.length > 1}
          <span class="badge">merge of {selected.parents.length}</span>
        {/if}
        {#if selected.committer !== selected.author}
          <span class="sep">·</span>
          <span class="who dim" title="Committer">committed by {selected.committer}</span>
        {/if}
      </div>
      {#if selected.refs.length}
        <div class="refs">
          {#each selected.refs as ref}
            <span class="ref {ref.kind}" class:is-head={ref.isHead}>{ref.name}</span>
          {/each}
        </div>
      {/if}
    </header>

    <div class="scroll">
      {#if body}
        <pre class="body">{body}</pre>
      {/if}

      {#if details}
        <div class="files-head">
          <span>{pluralize(totals?.count ?? 0, 'file')} changed</span>
          {#if totals}
            <span class="stat add">+{totals.added.toLocaleString()}</span>
            <span class="stat del">−{totals.removed.toLocaleString()}</span>
            {#if totals.binary > 0}<span class="stat bin">{totals.binary} binary</span>{/if}
          {/if}
        </div>
        <ul class="files">
          {#each details.files as file}
            <li>
              <span class="path" title={file.path}><bdi dir="ltr">{file.path}</bdi></span>
              {#if file.binary}
                <span class="stat bin">binary</span>
              {:else}
                <span class="stat add">+{file.added}</span>
                <span class="stat del">−{file.removed}</span>
              {/if}
            </li>
          {/each}
        </ul>
        <p class="pending">A side-by-side diff viewer is not built yet.</p>
      {:else}
        <p class="pending">Loading commit…</p>
      {/if}
    </div>
  {/if}
</section>

<style>
  .details {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    background: var(--bg-panel);
    border-top: 1px solid var(--border);
  }

  header {
    flex: none;
    padding: 9px 12px 8px;
    border-bottom: 1px solid var(--border);
  }

  .subject {
    margin: 0 0 4px;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.35;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    color: var(--text-dim);
    font-size: 12px;
  }

  .avatar {
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    color: #fff;
    font-size: 9px;
    font-weight: 600;
  }

  .who.dim { color: var(--text-faint); }
  .sep { color: var(--text-faint); }

  .hash {
    padding: 0 4px;
    background: var(--bg-sunken);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-dim);
  }
  .hash:hover { color: var(--text); border-color: var(--border-strong); }

  .badge {
    padding: 0 5px;
    background: var(--bg-sunken);
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    font-size: 10.5px;
  }

  .refs {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
    margin-top: 6px;
  }

  .ref {
    padding: 0 5px;
    border-radius: var(--radius-sm);
    font-size: 11px;
    line-height: 16px;
  }
  .ref.local { background: var(--ref-local-bg); color: var(--ref-local-text); }
  .ref.remote { background: var(--ref-remote-bg); color: var(--ref-remote-text); }
  .ref.tag { background: var(--ref-tag-bg); color: var(--ref-tag-text); }
  .ref.head, .ref.is-head { background: var(--ref-head-bg); color: var(--ref-head-text); font-weight: 600; }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 8px 12px 12px;
  }

  .body {
    margin: 0 0 12px;
    font-family: var(--font-mono);
    font-size: 11.5px;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--text-dim);
  }

  .files-head {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding-bottom: 5px;
    border-bottom: 1px solid var(--border);
    color: var(--text-dim);
    font-size: 11.5px;
  }

  .files {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .files li {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 2px 0;
    font-size: 12px;
  }

  .path {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    /* RTL clips the start of the path, keeping the filename visible.
       The inner dir="ltr" span keeps the characters themselves in order,
       which plain RTL would reorder for a leading "." or "/". */
    direction: rtl;
    text-align: left;
    font-family: var(--font-mono);
    font-size: 11.5px;
  }

  .stat {
    font-family: var(--font-mono);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .stat.add { color: var(--success); }
  .stat.del { color: var(--danger); }
  .stat.bin { color: var(--text-faint); }

  .empty, .multi, .pending {
    display: grid;
    place-content: center;
    gap: 4px;
    padding: 20px;
    color: var(--text-dim);
    text-align: center;
  }

  .multi span { color: var(--text-faint); font-size: 12px; max-width: 46ch; }
  .multi span.faint { color: var(--text-faint); opacity: 0.75; font-size: 11.5px; }

  .action {
    justify-self: center;
    margin-top: 6px;
    padding: 5px 14px;
    background: var(--accent);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    color: var(--accent-text);
    font-weight: 500;
  }
  .action:hover { background: var(--accent-hover); }
  .pending { padding: 14px; font-size: 11.5px; color: var(--text-faint); }
</style>
