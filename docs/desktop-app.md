# The desktop app

Gitkeen runs as a desktop app for macOS, Windows and Linux, built with Tauri.
To install it, see [Installing Gitkeen](install.md). It has the same
window and the same Git backend as the browser version. The backend runs as a
separate program inside the app. It listens on this computer only, and it
answers only the app, which proves itself with a secret chosen at every start.

## What is different in the app

1. The welcome screen has a **Choose folder…** button.
2. Patches and bundles are saved through the usual save dialog.
3. Links to GitHub open in your browser.
4. On macOS and Linux, the app reads `PATH`, `GITHUB_TOKEN` and the AI
   settings from your login shell when it starts, so it finds `git-lfs`, `gh`
   and your keys even when you open it from the Finder or a menu.
5. It checks for a new version when it starts, and offers to update itself.
   **Check for updates** in the command palette checks at any time.

## Building the app yourself

The release builds are made by GitHub Actions for every system (see
[Development](development.md#releasing)). To build the app on your own
computer, you need Rust (from rustup.rs) and, on a Mac, the Xcode command line
tools.

1. Updates are signed, so a build needs the signing key. Run
   `export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/gitkeen.key)"`.
2. Run `npm run desktop:build`.
3. Wait for the first build. It takes a few minutes and needs about 3 GB of
   free disk space for `src-tauri/target`, which you can delete afterwards.
4. Find the app in `src-tauri/target/release/bundle/`:

| File | Size |
|---|---|
| `macos/Gitkeen.app` | About 120 MB, most of it the Node.js runtime the backend needs. |
| `dmg/Gitkeen_0.1.0_aarch64.dmg` | About 39 MB, for giving the app to someone else. |
| `macos/Gitkeen.app.tar.gz` and `.sig` | The update archive and its signature, which the release attaches for the updater. |

`npm run desktop:dev` runs the app in development mode.

## Limits

1. The app is not signed with an Apple Developer ID or a Windows certificate.
   macOS and Windows ask once before they open it. See
   [Installing Gitkeen](install.md#opening-gitkeen-the-first-time).
2. On Linux, only the AppImage updates itself. The `.deb` package is updated
   by installing the new package.
