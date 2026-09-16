export type ToastKind = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  detail?: string | null;
}

let nextId = 1;

class ToastStore {
  items = $state<Toast[]>([]);

  push(kind: ToastKind, message: string, detail: string | null = null) {
    const toast: Toast = { id: nextId++, kind, message, detail };
    this.items = [...this.items, toast];
    // Errors stay until dismissed; they usually need reading.
    if (kind !== 'error') setTimeout(() => this.dismiss(toast.id), 3200);
    return toast.id;
  }

  info(message: string, detail?: string | null) { return this.push('info', message, detail); }
  success(message: string, detail?: string | null) { return this.push('success', message, detail); }
  error(message: string, detail?: string | null) { return this.push('error', message, detail); }

  dismiss(id: number) {
    this.items = this.items.filter((t) => t.id !== id);
  }
}

export const toasts = new ToastStore();
