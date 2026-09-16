<script lang="ts">
  import { dialogs } from '../state/dialogs.svelte';

  let value = $state('');
  let choice = $state('');
  let error = $state<string | null>(null);
  let field = $state<HTMLInputElement | HTMLTextAreaElement | null>(null);

  const request = $derived(dialogs.current);

  // Reset the controls whenever a new dialog opens.
  $effect(() => {
    const req = dialogs.current;
    if (req?.choices) choice = req.chosen ?? req.choices[0]?.value ?? '';
    if (req?.input) {
      value = req.input.value;
      error = null;
      // A message is meant to be edited, so place the cursor rather than
      // selecting everything the user would have to retype.
      queueMicrotask(() => {
        if (!field) return;
        if (req.input?.multiline) {
          field.focus();
          field.setSelectionRange(value.length, value.length);
        } else {
          field.select();
        }
      });
    }
  });

  function submit() {
    const req = dialogs.current;
    if (!req) return;
    if (req.choices) {
      dialogs.settle(choice);
    } else if (req.input) {
      const trimmed = value.trim();
      const problem = req.input.validate?.(trimmed) ?? (trimmed ? null : 'A value is required.');
      if (problem) { error = problem; return; }
      dialogs.settle(trimmed);
    } else {
      dialogs.settle(true);
    }
  }

  function cancel() {
    dialogs.settle(null);
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); cancel(); }
    else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    } else if (event.key === 'Enter' && !event.shiftKey && !dialogs.current?.input?.multiline) {
      // In a message field Enter starts a new line, so only the modifier submits.
      event.preventDefault();
      submit();
    }
  }
</script>

{#if request}
  <div class="scrim" role="presentation" onmousedown={cancel}></div>

  <div
    class="dialog"
    class:danger={request.tone === 'danger'}
    class:warning={request.tone === 'warning'}
    class:wide={!!request.input?.multiline}
    role="dialog"
    aria-modal="true"
    aria-label={request.title}
    tabindex="-1"
    {onkeydown}
  >
    <h2 class="title">
      {#if request.tone !== 'normal'}<span class="glyph" aria-hidden="true">!</span>{/if}
      {request.title}
    </h2>

    {#if request.message}
      <p class="message">{request.message}</p>
    {/if}

    {#if request.facts?.length}
      <dl class="facts">
        {#each request.facts as fact}
          <dt>{fact.label}</dt>
          <dd class:warn={fact.tone === 'warning'} class:bad={fact.tone === 'danger'}>{fact.value}</dd>
        {/each}
      </dl>
    {/if}

    {#if request.choices}
      <div class="choices" role="radiogroup" aria-label={request.title}>
        {#each request.choices as option (option.value)}
          <label class="choice" class:on={choice === option.value}>
            <input type="radio" bind:group={choice} value={option.value} />
            <span class="dot" aria-hidden="true"></span>
            <span class="text">
              <span class="choice-label">{option.label}</span>
              {#if option.detail}
                <span
                  class="choice-detail"
                  class:warn={option.tone === 'warning'}
                  class:bad={option.tone === 'danger'}
                >{option.detail}</span>
              {/if}
            </span>
          </label>
        {/each}
      </div>
    {/if}

    {#if request.input}
      <label class="field">
        <span>{request.input.label}</span>
        {#if request.input.multiline}
          <textarea
            bind:this={field}
            bind:value
            class="message-field"
            rows="8"
            placeholder={request.input.placeholder ?? ''}
            spellcheck="false"
            oninput={() => (error = null)}
          ></textarea>
        {:else}
          <!-- svelte-ignore a11y_autofocus -->
          <input
            bind:this={field}
            bind:value
            placeholder={request.input.placeholder ?? ''}
            spellcheck="false"
            autocomplete="off"
            autofocus
            oninput={() => (error = null)}
          />
        {/if}
      </label>
      {#if error}<p class="error">{error}</p>{/if}
      {#if request.input.multiline}
        <p class="tip">Press Command or Control with Enter to confirm.</p>
      {/if}
    {/if}

    <div class="actions">
      <button class="btn" onclick={cancel}>{request.cancelLabel}</button>
      <button class="btn primary" onclick={submit}>{request.confirmLabel}</button>
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 80;
    background: var(--scrim);
  }

  .dialog {
    position: fixed;
    z-index: 81;
    top: 22%;
    left: 50%;
    transform: translateX(-50%);
    width: min(440px, calc(100vw - 32px));
    padding: 18px 20px 16px;
    background: var(--bg-raised);
    border: 1px solid var(--border-strong);
    border-top: 2px solid var(--border-strong);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-modal);
    outline: none;
  }

  /* A commit message needs room to read at its natural line length. */
  .dialog.wide { width: min(620px, calc(100vw - 32px)); }

  .dialog.danger { border-top-color: var(--danger); }
  .dialog.warning { border-top-color: var(--warning); }

  .title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 8px;
    font-size: 14px;
    font-weight: 600;
  }

  .glyph {
    display: grid;
    place-items: center;
    width: 17px;
    height: 17px;
    border-radius: 50%;
    font-size: 11px;
    font-weight: 700;
    color: #fff;
    background: var(--warning);
  }
  .dialog.danger .glyph { background: var(--danger); }

  .message {
    margin: 0 0 12px;
    color: var(--text-dim);
  }

  .facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 3px 14px;
    margin: 0 0 14px;
    padding: 9px 11px;
    background: var(--bg-sunken);
    border-radius: var(--radius-sm);
    font-size: 12px;
  }

  dt { color: var(--text-dim); }
  dd {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 11.5px;
    overflow-wrap: anywhere;
  }
  dd.warn { color: var(--warning); }
  dd.bad { color: var(--danger); font-weight: 600; }

  .field {
    display: block;
    margin-bottom: 4px;
  }
  .field span {
    display: block;
    margin-bottom: 4px;
    color: var(--text-dim);
    font-size: 12px;
  }
  .field input {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg-panel);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .field input:focus,
  .field textarea:focus {
    border-color: var(--accent);
    outline: none;
  }

  .message-field {
    width: 100%;
    padding: 7px 9px;
    background: var(--bg-panel);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 11.5px;
    line-height: 1.5;
    resize: vertical;
    min-height: 90px;
  }

  .tip {
    margin: 6px 0 0;
    color: var(--text-faint);
    font-size: 11px;
  }

  .choices {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 12px 0 2px;
  }

  .choice {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: 9px;
    padding: 7px 9px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .choice:hover { background: var(--bg-hover); }
  .choice.on { background: var(--accent-subtle); border-color: var(--accent); }

  .choice input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  .dot {
    flex: none;
    width: 13px;
    height: 13px;
    margin-top: 2px;
    border: 1.5px solid var(--border-strong);
    border-radius: 50%;
    background: var(--bg-panel);
  }
  .choice.on .dot {
    border-color: var(--accent);
    border-width: 4px;
  }
  /* The radio itself is invisible, so its focus ring is drawn here. */
  .choice input:focus-visible + .dot {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .choice-label { font-size: 12.5px; font-weight: 500; }
  .choice-detail { color: var(--text-dim); font-size: 11.5px; line-height: 1.45; }
  .choice-detail.warn { color: var(--warning); }
  .choice-detail.bad { color: var(--danger); }

  .error {
    margin: 6px 0 0;
    color: var(--danger);
    font-size: 12px;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }

  .btn {
    padding: 5px 14px;
    background: var(--bg-panel);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
  }
  .btn:hover { background: var(--bg-hover); }

  .btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-text);
    font-weight: 500;
  }
  .btn.primary:hover { background: var(--accent-hover); }

  .dialog.danger .btn.primary { background: var(--danger); border-color: var(--danger); color: #fff; }
</style>
