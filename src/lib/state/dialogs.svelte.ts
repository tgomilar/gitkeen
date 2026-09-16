/**
 * Promise-based dialogs, so a call site reads as a straight line:
 *
 *   if (!(await confirm({ ... }))) return;
 *
 * The safety model (plan section 18) needs dialogs that state facts, not just
 * a question, so every dialog can carry a list of label/value facts.
 */
export interface DialogFact {
  label: string;
  value: string;
  tone?: 'normal' | 'warning' | 'danger';
}

export interface DialogInput {
  label: string;
  value: string;
  placeholder?: string;
  /** Show a text area instead of a single line field, for commit messages. */
  multiline?: boolean;
  /** Return an error message, or null when the value is acceptable. */
  validate?: (value: string) => string | null;
}

export interface DialogRequest {
  id: number;
  title: string;
  message?: string;
  facts?: DialogFact[];
  tone: 'normal' | 'warning' | 'danger';
  confirmLabel: string;
  cancelLabel: string;
  input?: DialogInput;
  resolve: (value: string | boolean | null) => void;
}

let nextId = 1;

class DialogStore {
  current = $state<DialogRequest | null>(null);

  private open(req: Omit<DialogRequest, 'id' | 'resolve'>): Promise<string | boolean | null> {
    return new Promise((resolve) => {
      this.current = { ...req, id: nextId++, resolve };
    });
  }

  async confirm(opts: {
    title: string;
    message?: string;
    facts?: DialogFact[];
    tone?: 'normal' | 'warning' | 'danger';
    confirmLabel?: string;
    cancelLabel?: string;
  }): Promise<boolean> {
    const result = await this.open({
      title: opts.title,
      message: opts.message,
      facts: opts.facts,
      tone: opts.tone ?? 'normal',
      confirmLabel: opts.confirmLabel ?? 'Continue',
      cancelLabel: opts.cancelLabel ?? 'Cancel'
    });
    return result === true;
  }

  async prompt(opts: {
    title: string;
    message?: string;
    facts?: DialogFact[];
    input: DialogInput;
    confirmLabel?: string;
    tone?: 'normal' | 'warning' | 'danger';
  }): Promise<string | null> {
    const result = await this.open({
      title: opts.title,
      message: opts.message,
      facts: opts.facts,
      tone: opts.tone ?? 'normal',
      confirmLabel: opts.confirmLabel ?? 'Create',
      cancelLabel: 'Cancel',
      input: opts.input
    });
    return typeof result === 'string' ? result : null;
  }

  settle(value: string | boolean | null) {
    const req = this.current;
    this.current = null;
    req?.resolve(value);
  }
}

export const dialogs = new DialogStore();
export const confirm = dialogs.confirm.bind(dialogs);
export const prompt = dialogs.prompt.bind(dialogs);
