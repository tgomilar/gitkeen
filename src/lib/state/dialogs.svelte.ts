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

/** One option of a choice dialog, such as a reset mode. */
export interface DialogChoice {
  value: string;
  label: string;
  /** What picking this option does, written for someone about to pick it. */
  detail?: string;
  tone?: 'normal' | 'warning' | 'danger';
}

/**
 * A second way out of a dialog, shown beside Cancel.
 *
 * Confirming and cancelling are the two answers to the question asked. An
 * extra action is for the neighbouring question the user turns out to have:
 * the push dialog offers Force Push here, so finding out mid-dialog that an
 * ordinary push will not do does not mean cancelling and starting again.
 */
export interface DialogExtra {
  value: string;
  label: string;
  tone?: 'normal' | 'warning' | 'danger';
  title?: string;
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
  choices?: DialogChoice[];
  /** The option selected when the dialog opens. */
  chosen?: string;
  extra?: DialogExtra;
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

  /**
   * A confirmation with a second way out, which the caller has to handle.
   *
   * Resolves 'confirm' for the primary button, the extra's own value for the
   * extra, and null for cancel, so the three answers stay distinguishable
   * where `confirm`'s boolean could only carry two.
   */
  async confirmOr(opts: {
    title: string;
    message?: string;
    facts?: DialogFact[];
    tone?: 'normal' | 'warning' | 'danger';
    confirmLabel?: string;
    cancelLabel?: string;
    /** Left out when the second way out does not apply to this case. */
    extra?: DialogExtra;
  }): Promise<string | null> {
    const result = await this.open({
      title: opts.title,
      message: opts.message,
      facts: opts.facts,
      tone: opts.tone ?? 'normal',
      confirmLabel: opts.confirmLabel ?? 'Continue',
      cancelLabel: opts.cancelLabel ?? 'Cancel',
      extra: opts.extra
    });
    if (result === true) return 'confirm';
    return typeof result === 'string' ? result : null;
  }

  /**
   * Pick one of several ways to do something, with the cost of each stated
   * next to it. Resolves with the chosen value, or null if cancelled.
   */
  async choose(opts: {
    title: string;
    message?: string;
    facts?: DialogFact[];
    choices: DialogChoice[];
    chosen?: string;
    tone?: 'normal' | 'warning' | 'danger';
    confirmLabel?: string;
  }): Promise<string | null> {
    const result = await this.open({
      title: opts.title,
      message: opts.message,
      facts: opts.facts,
      tone: opts.tone ?? 'normal',
      confirmLabel: opts.confirmLabel ?? 'Continue',
      cancelLabel: 'Cancel',
      choices: opts.choices,
      chosen: opts.chosen ?? opts.choices[0]?.value
    });
    return typeof result === 'string' ? result : null;
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
export const choose = dialogs.choose.bind(dialogs);
export const confirmOr = dialogs.confirmOr.bind(dialogs);
