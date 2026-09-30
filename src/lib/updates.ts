/**
 * Updates for the desktop app, from the latest GitHub release.
 *
 * The updater plugin reads latest.json from the release, checks the signature
 * of the download against the public key in tauri.conf.json, and installs it.
 * Nothing happens without the user: a new version is offered in a toast, and
 * only its button downloads and restarts.
 */
import { isDesktop } from './git/transport';
import { toasts } from './state/toasts.svelte';

const tauri = () => (globalThis as any).__TAURI__;

let checking = false;

/**
 * Look for a newer version. `quiet` is for the check at start-up: it says
 * nothing when there is no update or when the check fails, because the user
 * did not ask.
 */
export async function checkForUpdates({ quiet = false } = {}) {
  if (!isDesktop || checking) return;
  checking = true;
  try {
    const update = await tauri().updater.check();
    if (!update) {
      if (!quiet) toasts.success('Gitkeen is up to date.');
      return;
    }
    toasts.offer(
      `Gitkeen ${update.version} is available.`,
      `You have ${update.currentVersion}. The update downloads, installs and restarts the app.`,
      { label: 'Update and restart', run: () => install(update) }
    );
  } catch (err) {
    if (!quiet) toasts.error('Could not check for updates.', String((err as Error)?.message ?? err));
  } finally {
    checking = false;
  }
}

async function install(update: { version: string; downloadAndInstall: () => Promise<void> }) {
  toasts.info(`Downloading Gitkeen ${update.version}…`);
  try {
    await update.downloadAndInstall();
    await tauri().process.relaunch();
  } catch (err) {
    toasts.error('The update could not be installed.', String((err as Error)?.message ?? err));
  }
}
