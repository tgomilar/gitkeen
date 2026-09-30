/**
 * What the desktop app does differently from the browser: open links in the
 * user's own browser, save files through a save dialog, and choose a folder.
 * In the browser each falls back to what a web page can do.
 */
import { isDesktop } from './git/transport';

const tauri = () => (globalThis as any).__TAURI__;

/** Open a web page in the user's browser. */
export function openExternal(url: string) {
  if (isDesktop) tauri().opener.openUrl(url);
  else window.open(url, '_blank', 'noopener');
}

/** Save a file: through the system's save dialog in the app, as a download in the browser. */
export async function saveFile(name: string, data: Uint8Array | string, type: string): Promise<boolean> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  if (isDesktop) {
    const path: string | null = await tauri().dialog.save({ defaultPath: name, title: `Save ${name}` });
    if (!path) return false;
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    await tauri().core.invoke('save_file', { path, base64: btoa(binary) });
    return true;
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

/** Ask for a folder. Only the desktop app can; the browser returns null. */
export async function chooseFolder(title = 'Open a repository'): Promise<string | null> {
  if (!isDesktop) return null;
  const path = await tauri().dialog.open({ directory: true, multiple: false, title });
  return typeof path === 'string' ? path : null;
}

/**
 * In the app, a link meant for a new tab opens in the user's browser: the
 * app's own window must keep showing Gitkeen.
 */
export function routeLinksToBrowser() {
  if (!isDesktop) return;
  window.open = ((url?: string | URL) => {
    if (url) openExternal(String(url));
    return null;
  }) as typeof window.open;
  document.addEventListener('click', (event) => {
    const link = (event.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!link || !/^https?:/i.test(link.href)) return;
    event.preventDefault();
    openExternal(link.href);
  });
}
