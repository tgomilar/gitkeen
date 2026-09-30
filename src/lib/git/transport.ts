/**
 * The one seam between the UI and however Git is actually reached.
 *
 * In the browser that is an HTTP call to the dev server. In the desktop app
 * it is `invoke('git_call')`, which the Rust shell forwards to the same
 * backend running as a sidecar. Nothing above this file knows which.
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
 * The desktop app: the call goes to the Rust shell, which passes it to the
 * backend sidecar and hands its answer back in the same envelope as HTTP.
 */
class TauriTransport implements Transport {
  readonly kind = 'tauri' as const;

  async call<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    const invoke = (globalThis as any).__TAURI__?.core?.invoke;
    if (!invoke) throw new GitCallError('The desktop runtime is not available.', method);
    let payload: { result?: T; error?: { message: string; command?: string | null } };
    try {
      payload = await invoke('git_call', { method, args });
    } catch (err) {
      throw new GitCallError(String(err), method);
    }
    if (payload.error) {
      throw new GitCallError(payload.error.message, method, payload.error.command ?? null);
    }
    return payload.result as T;
  }
}

/** True inside the desktop app. */
export const isDesktop = !!(globalThis as any).__TAURI__;

function detectTransport(): Transport {
  return (globalThis as any).__TAURI__ ? new TauriTransport() : new HttpTransport();
}

export const transport: Transport = detectTransport();
