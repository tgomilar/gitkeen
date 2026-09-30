# The desktop app

Gitkeen also runs as a desktop app for macOS, built with Tauri. It has the same
window and the same Git backend as the browser version. The backend runs as a
separate program inside the app. It listens on this computer only, and it
answers only the app, which proves itself with a secret chosen at every start.

## What is different in the app

1. The welcome screen has a **Choose folder…** button.
2. Patches and bundles are saved through the usual save dialog.
3. Links to GitHub open in your browser.
4. The app reads `PATH`, `GITHUB_TOKEN` and the AI settings from your login
   shell when it starts, so it finds `git-lfs`, `gh` and your keys even when
   you open it from the Finder.

## Building the app

You need Rust (from rustup.rs) and the Xcode command line tools.

1. Run `npm run desktop:build`.
2. Wait for the first build. It takes a few minutes and needs about 3 GB of
   free disk space for `src-tauri/target`, which you can delete afterwards.
3. Find the app in `src-tauri/target/release/bundle/`:

| File | Size |
|---|---|
| `macos/Gitkeen.app` | About 97 MB, most of it the Node.js runtime the backend needs. |
| `dmg/Gitkeen_0.1.0_aarch64.dmg` | About 32 MB, for giving the app to someone else. |

`npm run desktop:dev` runs the app in development mode.

## Limits

1. The app is built for Apple silicon Macs only.
2. It is not signed with an Apple Developer ID or notarized yet. On another
   Mac, macOS says it cannot check the app. Right click it and choose **Open**
   to open it anyway.
3. It does not update itself.
