# Development

This page is for people who want to change Gitkeen itself.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Starts Gitkeen for development, at `http://localhost:5183`. |
| `npm run build` | Builds the files for production. |
| `npm run preview` | Serves the built files. |
| `npm run check` | Checks all types. |
| `npm test` | Runs the tests. |
| `npm run desktop:dev` | Runs the desktop app in development mode. |
| `npm run desktop:build` | Builds `Gitkeen.app` and a `.dmg`. See [The desktop app](desktop-app.md). |

## How it is built

Git runs in a Node.js backend. In the browser, the page reaches it over HTTP
through the development server. In the desktop app, the same backend runs as a
separate program, and the app's Rust shell passes each call on to it.

```
Svelte user interface
        |
  GitRepository service      (src/lib/git/repository.ts)
        |
    Transport                (src/lib/git/transport.ts)
        |
   +----+-----------------------+
   |                            |
HttpTransport              TauriTransport
   |                            |
development server         the app's Rust shell (src-tauri/src/lib.rs)
   |                            |
   +------ Node backend --------+    (server/, the same code for both)
                |
   Git command line executable
```

The user interface never builds a Git command. It calls named methods such as
`branch.checkout` and `log.list`, and the backend answers them. Only
`transport.ts` knows how a call travels.

## Where the code lives

| Path | What it holds |
|---|---|
| `server/git.mjs` | Starts the Git executable. It is the only file that does. |
| `server/api.mjs` | The methods, such as `log.list` and `branch.create`. |
| `server/rebase-helper.mjs` | Stands in for the editor that `git rebase -i` would open. |
| `server/recovery.mjs` | The operation log and the recovery points behind the Undo panel. |
| `server/console.mjs` | The console's rules: which commands and options it runs, how risky each is, and what an error means. |
| `server/vite-plugin-git.mjs` | Serves the methods over HTTP during development. |
| `src/lib/git/` | Types, the transport, and the repository service. |
| `src/lib/graph/layout.ts` | Places each commit and line of the graph in a column. |
| `src/lib/actions.ts` | Every user action, with its safety checks. |
| `src/lib/state/` | Repository state, dialogs and messages. |
| `src/lib/console/` | What the console knows about each command, and which button matches which command. |
| `src/lib/components/` | The Svelte components. |
| `src-tauri/` | The desktop app's Rust shell and its icons. |
| `brand/` | The logo files. |

## The graph

`src/lib/graph/layout.ts` reads the list of commits and decides which column
each commit and each line belongs to. It returns plain data and knows nothing
about the screen, so it can be tested on its own.

A lane stays open while it waits for a named commit. When that commit appears,
the lane passes to the commit's first parent. This keeps one branch in one
column.

On a repository with 1307 commits and 35 branches, Git returns the log in about
83 milliseconds, and the layout takes about 4 milliseconds. Only the visible
rows exist in the page. The graph shows the newest 5000 commits as soon as the
log arrives, and **Load older commits** reads 5000 more at a time.

## Safety checks

Every action is in `src/lib/actions.ts`, so a check cannot be present in one
place and missing in another. Many checks run twice. The screen runs the quick
ones, so a menu item is greyed out with its reason at once. The backend runs
all of them again before it changes anything. If a squash, move or drop
fails part way, Gitkeen stops it and the branch stays where it started.

## Tests

`npm test` runs Node's own test runner, so there is nothing to install. The
tests use real Git. Each one builds a throwaway repository in a temporary
folder, calls the same methods the user interface calls, and deletes the
repository afterwards. Your own repositories are never touched.

| File | What it covers |
|---|---|
| `server/test/harness.mjs` | Building and removing test repositories. |
| `server/test/rewrite.test.mjs` | Moving and dropping commits, and what must be refused. |
| `server/test/rebase.test.mjs` | Squash, the rebase editor, and continuing an Edit stop. |
| `server/test/remote.test.mjs` | Push, force push, pull and merge. |
| `server/test/repo.test.mjs` | Branches, tags, stashes, and the lists. |
| `server/test/changes.test.mjs` | Staging files and hunks, and what a commit takes from the index. |
| `server/test/conflicts.test.mjs` | Reading a conflicted file for the merge editor, and writing a resolution. |
| `server/test/log.test.mjs` | Reading the history a page at a time. |
| `server/test/recovery.test.mjs` | The operation log, and restoring what an operation changed. |
| `server/test/blame.test.mjs` | Which commit last changed each line. |
| `server/test/bisect.test.mjs` | Finding the first bad commit. |
| `server/test/compare.test.mjs` | Comparing two branches or commits. |
| `server/test/worktree.test.mjs` | Adding, listing, removing and pruning worktrees. |
| `server/test/submodule.test.mjs` | Listing and updating submodules. |
| `server/test/signing.test.mjs` | Signing a commit, and checking a signature. |
| `server/test/patch.test.mjs` | Patches and bundles. |
| `server/test/github.test.mjs` | Pull requests and checks, against a stand-in for GitHub. |
| `server/test/explain.test.mjs` | What each AI explanation is given, against a stand-in model. |
| `server/test/lfs.test.mjs` | Git LFS. Skipped when `git-lfs` is not installed. |

The most important tests are the ones where Gitkeen must **refuse**. A wrong
refusal is annoying, but a wrong rewrite loses work. So the tests check these
cases, among others:

1. A force push is refused when the remote moved unseen.
2. A rewrite across a merge is refused.
3. A failed move or drop puts the branch back as it was.

## Releasing

A release is built by GitHub Actions for macOS (Apple silicon and Intel),
Windows and Linux, and attached to a draft release on GitHub.

1. Run `npm run release -- 0.2.0 --push`. The script sets the version in
   `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `Cargo.lock`
   and `src-tauri/tauri.conf.json`, commits, tags `v0.2.0`, and pushes.
2. The tag starts `.github/workflows/release.yml`. It makes a draft release
   with notes written by `scripts/release-notes.mjs` from the `feat`, `fix` and
   `perf` commits since the last tag, then builds on four machines and adds
   their files to the draft.
3. When the four builds are green, open the draft on the Releases page, read
   the notes, and press **Publish**.

Gitkeen is in pre-release for now, so the README and `docs/install.md` send
people to the Releases page. GitHub leaves pre-releases out of "latest", so
links to `releases/latest/download/…` would not work, and the app's update
check (which reads `releases/latest/download/latest.json`) skips them too. With
the first full release, the download tables can link to
`releases/latest/download/<file>` directly, and updates start to arrive.

The workflow can also be started by hand from the Actions tab. It then makes a
draft for the version already in `package.json`.

### Updates

The app updates itself from the newest published release. The workflow writes
`latest.json` into the release, with a signature for each file. The app
checks every download against the public key in `src-tauri/tauri.conf.json`.

The private key is in `~/.tauri/gitkeen.key` on the computer that made it, and
in the repository secret `TAURI_SIGNING_PRIVATE_KEY`. Keep a copy somewhere
safe. Without it, no update can be signed, and every installed copy would have
to be replaced by hand.

### The backend on each system

`scripts/build-sidecar.mjs` puts the Node.js backend into a copy of Node, for
the system in `TARGET`. For the system it runs on, it uses its own Node. For
another system, such as an Intel Mac built on Apple silicon, it downloads the
official Node for that system from nodejs.org, at the same version.

## Screenshots and GIFs

The pictures in `docs/media` are made by scripts, so they can be made again
after the interface changes.

| Script | What it does |
|---|---|
| `scripts/demo-repo.sh <folder>` | Builds the demo repository: a small notes app with four contributors, merged branches, tags, a remote and a branch that conflicts with main. |
| `scripts/capture-media.mjs [scene …]` | Opens the demo repository in Gitkeen in a headless Chrome, drives the app, and writes the screenshots and GIFs. With no scene names, it makes all of them. |

The capture script needs Node.js 22 or newer, Google Chrome and ffmpeg. It
runs the app with no AI keys, no GitHub token and no saved settings, so the
pictures show what a new user sees. Headless Chrome draws no mouse pointer, so
the script adds one to the page.

The `suggest` scene needs an AI model. The script starts a small stand-in for
LM Studio that always answers with the same subject, so the GIF is the same
every time. Only that scene can reach it.

| Scene | Writes |
|---|---|
| `overview` | `overview-dark.png`, `overview-light.png` |
| `commit` | `commit-lines.gif` |
| `suggest` | `suggest.gif` |
| `stash` | `stash-files.gif` |
| `squash` | `squash.gif` |
| `rebase` | `rebase.gif` |
| `undo` | `undo.gif` |
| `console` | `console.gif` |
| `conflict` | `merge-editor.png` |
| `stats` | `stats.png` |
| `help` | `help.png` |

## The logo

The logo is a lowercase "g", drawn as a branch that splits and joins again, on
a soft red rounded square, followed by the word "gitkeen". Each file comes in a
version for light backgrounds and one ending in `-dark` for dark backgrounds.

| File | When to use it |
|---|---|
| `brand/logo.svg` | The full logo: the square and the word. |
| `brand/wordmark.svg` | The word alone, for small sizes such as the status bar. |
| `brand/icon.svg` | The square alone, for icons. |

`public/favicon.svg` switches to the dark version when the browser uses a dark
colour scheme. `src-tauri/app-icon.svg` is the dark square on the canvas macOS
uses for app icons. The icons in `src-tauri/icons/` are made from it with
`npx tauri icon src-tauri/app-icon.svg`. Inside the app, the logo takes its
colours from the `--logo-` values in `src/styles/theme.css`.
