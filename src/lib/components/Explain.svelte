<script lang="ts">
  /**
   * An "Explain" button, and the explanation once it comes back.
   *
   * Offered only when an AI provider is set up. The answer is plain text: a
   * line starting with "- " is a point in a list, `code` in backquotes is
   * shown as code, and nothing in it is read as HTML.
   */
  import Icon from './Icon.svelte';
  import { commitStore } from '../state/commit.svelte';
  import { repoStore, describe } from '../state/repo.svelte';

  interface Props {
    kind: 'commit' | 'conflict' | 'branches' | 'operation' | 'error';
    args: Record<string, unknown>;
    /** The button's words, such as "Explain this commit". */
    label?: string;
    /** A key that, when it changes, throws the old answer away. */
    subject: string;
  }

  let { kind, args, label = 'Explain', subject }: Props = $props();

  const available = $derived((commitStore.suggestProviders?.available.length ?? 0) > 0);
  let answer = $state<{ text: string; provider: string; model: string; clipped: boolean } | null>(null);
  let error = $state<string | null>(null);
  let busy = $state(false);
  let asked = $state<string | null>(null);

  // A new commit, file or pair of branches: the old answer was about another.
  $effect(() => {
    if (subject !== asked) {
      answer = null;
      error = null;
    }
  });

  async function run() {
    const repo = repoStore.repo;
    if (!repo || busy) return;
    busy = true;
    error = null;
    asked = subject;
    try {
      answer = await repo.explain(kind, args);
    } catch (err) {
      error = describe(err);
    } finally {
      busy = false;
    }
  }

  /** Lines of the answer, each a paragraph or a point. */
  const blocks = $derived(
    (answer?.text ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
      .map((l) => (/^[-*•]\s+/.test(l) ? { point: true, text: l.replace(/^[-*•]\s+/, '') } : { point: false, text: l }))
  );
  const parts = (text: string) => text.split(/(`[^`]+`)/).filter(Boolean)
    .map((t) => (t.startsWith('`') && t.endsWith('`') ? { code: true, text: t.slice(1, -1) } : { code: false, text: t.replace(/\*\*/g, '') }));
</script>

{#if available}
  <div class="explain">
    {#if !answer}
      <button class="ask" onclick={run} disabled={busy} title="Ask the AI provider to explain this in plain words">
        <Icon name="ai" size={12} />
        {busy ? 'Thinking…' : label}
      </button>
    {/if}
    {#if error}
      <p class="error">{error}</p>
    {/if}
    {#if answer}
      <div class="answer" aria-live="polite">
        {#each blocks as block, i (i)}
          {#if block.point}
            <p class="point">{#each parts(block.text) as part, j (j)}{#if part.code}<code>{part.text}</code>{:else}{part.text}{/if}{/each}</p>
          {:else}
            <p>{#each parts(block.text) as part, j (j)}{#if part.code}<code>{part.text}</code>{:else}{part.text}{/if}{/each}</p>
          {/if}
        {/each}
        <p class="by">
          Written by {answer.model} ({answer.provider}){answer.clipped ? ', from the first part only: the whole was too long to send' : ''}. It can be wrong.
          <button class="link" onclick={run} disabled={busy}>{busy ? 'Asking again…' : 'Ask again'}</button>
          <button class="link" onclick={() => (answer = null)}>Hide</button>
        </p>
      </div>
    {/if}
  </div>
{/if}

<style>
  .explain { margin: 6px 0; }
  .ask {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    background: var(--bg-panel);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    font-size: 11.5px;
  }
  .ask:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); }
  .ask:disabled { opacity: 0.7; }
  .answer {
    padding: 8px 12px;
    background: var(--accent-subtle);
    border-left: 3px solid var(--accent);
    border-radius: var(--radius-sm);
    font-size: 12.5px;
    line-height: 1.5;
    white-space: normal;
  }
  .answer p { margin: 0 0 6px; }
  .answer .point { padding-left: 14px; text-indent: -10px; }
  .answer .point::before { content: '• '; color: var(--text-faint); }
  .answer code { font-family: var(--font-mono); font-size: 11.5px; }
  .by { margin: 8px 0 0 !important; color: var(--text-faint); font-size: 11px; }
  .link { padding: 0 0 0 8px; background: none; border: 0; color: var(--text-dim); font-size: 11px; }
  .link:hover:not(:disabled) { color: var(--accent); text-decoration: underline; }
  .error { margin: 6px 0 0; color: var(--danger); font-size: 11.5px; }
</style>
