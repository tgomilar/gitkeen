/**
 * The one seam between the UI and however Git is actually reached.
 *
 * Today that is an HTTP call to the dev server. Under Tauri it becomes
 * `invoke(method, args)`. Nothing above this file changes when it does.
 */

export class GitCallError extends Error {
  readonly command: string | null;
  readonly method: string;

  constructor(message: string, method: string, command: string | null = null) {
    super(message);
    this.name = 'GitCallError';
    this.method = method;
    this.command = command;
  }
}

export interface Transport {
  readonly kind: 'http' | 'tauri';
  call<T>(method: string, args?: Record<string, unknown>): Promise<T>;
}

class HttpTransport implements Transport {
  readonly kind = 'http' as const;

  async call<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    let payload: { result?: T; error?: { message: string; command?: string | null } };
    try {
      const res = await fetch('/api/git', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, args })
      });
      payload = await res.json();
    } catch (err) {
      throw new GitCallError(
        `Cannot reach the Gitalia backend. Is the dev server running? (${(err as Error).message})`,
        method
      );
    }
    if (payload.error) {
      throw new GitCallError(payload.error.message, method, payload.error.command ?? null);
    }
    return payload.result as T;
  }
}

/**
 * Placeholder for the desktop build. Kept here so the shape of the eventual
 * Rust call site is visible next to the one it replaces.
 */
class TauriTransport implements Transport {
  readonly kind = 'tauri' as const;

  async call<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    const invoke = (globalThis as any).__TAURI__?.core?.invoke;
    if (!invoke) throw new GitCallError('Tauri runtime not available', method);
    try {
      return (await invoke(method.replace(/\./g, '_'), args)) as T;
    } catch (err) {
      throw new GitCallError(String(err), method);
    }
  }
}

function detectTransport(): Transport {
  return (globalThis as any).__TAURI__ ? new TauriTransport() : new HttpTransport();
}

export const transport: Transport = detectTransport();
