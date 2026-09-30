<script lang="ts">
  /** A commit's checks on GitHub as one dot: passed, failed or still running. */
  import { githubStore } from '../state/github.svelte';

  interface Props { sha: string | null | undefined }
  let { sha }: Props = $props();

  const checks = $derived(githubStore.checksFor(sha));
  const LABEL = { success: 'Checks passed', failure: 'Checks failed', pending: 'Checks are running' } as const;
</script>

{#if checks && checks.state !== 'none'}
  <span
    class="dot {checks.state}"
    title="{LABEL[checks.state]}&#10;{checks.items.map((i) => `${i.state === 'success' ? '✓' : i.state === 'failure' ? '✗' : '…'} ${i.name}`).join('\n')}"
    aria-label={LABEL[checks.state]}
  ></span>
{/if}

<style>
  .dot { display: inline-block; flex: none; width: 7px; height: 7px; border-radius: 50%; }
  .dot.success { background: var(--success); }
  .dot.failure { background: var(--danger); }
  .dot.pending { background: var(--warning); animation: pulse 1.6s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: 0.35; } }
</style>
