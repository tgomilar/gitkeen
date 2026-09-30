export type ToastKind = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  detail?: string | null;
  /** A button on the toast, such as Update and restart. */
  action?: { label: string; run: () => void } | null;
}

let nextId = 1;

class ToastStore {
  items = $state<Toast[]>([]);

  push(kind: ToastKind, message: string, detail: string | null = null, action: Toast['action'] = null) {
    const toast: Toast = { id: nextId++, kind, message, detail, action };
    this.items = [...this.items, toast];
    // Errors stay until dismissed; they usually need reading. So does a toast
    // with a button, which is asking the user to decide something.
    if (kind !== 'error' && !action) setTimeout(() => this.dismiss(toast.id), 3200);
    return toast.id;
  }

  /** A toast that stays until the user presses its button or dismisses it. */
  offer(message: string, detail: string | null, action: NonNullable<Toast['action']>) {
    return this.push('info', message, detail, action);
  }

  info(message: string, detail?: string | null) { return this.push('info', message, detail); }
  success(message: string, detail?: string | null) { return this.push('success', message, detail); }
  error(message: string, detail?: string | null) { return this.push('error', message, detail); }

  dismiss(id: number) {
    this.items = this.items.filter((t) => t.id !== id);
  }

  /** Clear the errors, once the user has moved on to dealing with them. */
  dismissErrors() {
    this.items = this.items.filter((t) => t.kind !== 'error');
  }
}

export const toasts = new ToastStore();
