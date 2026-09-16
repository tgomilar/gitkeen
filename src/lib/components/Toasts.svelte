<script lang="ts">
  import { toasts } from '../state/toasts.svelte';
</script>

<div class="stack" role="status" aria-live="polite">
  {#each toasts.items as toast (toast.id)}
    <div class="toast {toast.kind}">
      <div class="body">
        <p class="message">{toast.message}</p>
        {#if toast.detail}<p class="detail">{toast.detail}</p>{/if}
      </div>
      <button class="close" onclick={() => toasts.dismiss(toast.id)} aria-label="Dismiss">×</button>
    </div>
  {/each}
</div>

<style>
  .stack {
    position: fixed;
    right: 14px;
    bottom: 34px;
    z-index: 70;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 420px;
  }

  .toast {
    display: flex;
    gap: 10px;
    padding: 8px 8px 8px 11px;
    background: var(--bg-raised);
    border: 1px solid var(--border-strong);
    border-left: 3px solid var(--text-faint);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-menu);
  }

  .toast.success { border-left-color: var(--success); }
  .toast.error { border-left-color: var(--danger); }
  .toast.info { border-left-color: var(--accent); }

  .body { min-width: 0; }

  .message {
    margin: 0;
    font-weight: 500;
  }

  .detail {
    margin: 3px 0 0;
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 11px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 7.5em;
    overflow: auto;
  }

  .close {
    align-self: flex-start;
    padding: 0 4px;
    background: none;
    border: 0;
    color: var(--text-faint);
    font-size: 15px;
    line-height: 1.2;
  }
  .close:hover { color: var(--text); }
</style>
