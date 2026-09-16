# Gitalia

Gitalia is a standalone visual Git* client. It gives you the commit graph and
the history tools that IntelliJ IDEA* offers, without asking you to change your
editor. Your editor writes code. Gitalia manages your history.

This repository holds Prototype 1, as defined in
`standalone-git-management-app-plan.md`. It covers one workflow: open a
repository*, read its history, select commits, and switch branches.

## What works today

| Area | What you can do |
|---|---|
| Repository | Open any folder inside a repository. Gitalia finds the root itself. |
| Current branch | See the branch you are on, pinned above the branch list. |
| Recent list | Reopen a repository you used before. |
| Graph | Read the full commit graph with lanes, merges, branches and tags. |
| Selection | Select one commit, several commits, or a range. |
| Context menu | Right click a commit or a branch to act on it. |
| Branches | Switch, create, rename and delete local branches. |
| Remote branches | Check out a remote branch as a local branch. |
| Commit details | Read the full message and the list of changed files. |
| Squash | Combine a run of selected commits into one, as IntelliJ IDEA does. |
| Search | Filter the graph by message, author, hash* or branch name. |
| Safety | Read what a destructive action will do before it runs. |
| Themes | Switch between a dark and a light theme. |

Fetch is available. Push and pull are not yet built.

## How squashing works

Select two or more commits that sit next to each other, then right click and
choose **Squash Commits**. Gitalia joins their messages, oldest first, and lets
you edit the result before anything happens.

Gitalia refuses to squash in these cases, and says which one applies:

| Case | Reason |
|---|---|
| Fewer than two commits | There is nothing to combine. |
| The commits are not in the history of the current branch | There is nothing for Git to rewrite. Gitalia names the branches that do hold them. |
| The commits are not next to each other | Only a continuous run can become one commit. |
| The selection contains a merge commit | A merge commit joins two histories, so it cannot be folded into another commit. |
| The selection includes the first commit | It has no parent to build on. |
| The working tree has uncommitted changes | They would be swept into the new commit. |
| A rebase or merge is already running | Two history changes at once would collide. |
| A merge sits between the selection and the branch tip | Squashing would flatten that merge, losing the record of it. |

Squashing takes one of two routes. When the selection reaches the tip of the
branch, Gitalia moves the branch back and makes one new commit. Nothing else
moves, and nothing can conflict. Otherwise Git replays the later commits on top
of the combined one. This cannot conflict either, because the combined commit
leaves exactly the same files behind as the newest commit it replaced. Those
later commits do get new hashes, and the dialog says so before you agree.

If the commits already exist on a remote, the dialog warns you that a force
push would be needed. After a squash, the message tells you where the branch
pointed before, so you can undo it with `git reset --hard`.

## What is not built yet

Staging, diffs, cherry-pick, revert, reset, interactive rebase, stash and
conflict resolution all come later. The plan document lists the order.

## Requirements

You need Node.js* version 20 or newer, and Git version 2.30 or newer.

## How to run it

1. Install the dependencies: `npm install`
2. Start the application: `npm run dev`
3. Open the address that the command prints, normally `http://localhost:5183`
4. Paste the path of a repository into the box and press Open.

You can also open a repository directly from the address:

```
http://localhost:5183/?repo=/path/to/repository
http://localhost:5183/?repo=/path/to/repository&theme=light
```

Other commands:

| Command | What it does |
|---|---|
| `npm run dev` | Starts the application for development. |
| `npm run build` | Builds the files for production. |
| `npm run check` | Checks all types. |
| `npm run preview` | Serves the built files. |

## Keyboard

The plan asks for a keyboard first application. These keys work now.

| Key | Action |
|---|---|
| Up and Down arrows | Move the cursor through the graph. |
| Shift with Up or Down | Extend the selection. |
| Page Up and Page Down | Move by 20 commits. |
| Home and End | Go to the newest or oldest commit. |
| Enter | Open the context menu for the commit under the cursor. |
| Escape | Clear the search, then reduce the selection to one commit. |
| Command or Control with K | Move the cursor to the search box. |
| Command or Control with R | Reload the repository state. |
| Command or Control with Shift and F | Fetch from all remotes. |
| Command or Control with Shift and B | Create a branch at the selected commit. |

## How it is built

The plan asks for Tauri* and Rust*. Rust is not installed on this machine, so
Git runs in a small Node.js backend for now. Everything above that backend is
already the final design, so the change to Tauri later is contained.

```
Svelte user interface
        |
  GitRepository service      (src/lib/git/repository.ts)
        |
    Transport                (src/lib/git/transport.ts)
        |
   +----+----------------+
   |                     |
HttpTransport      TauriTransport
   |                     |
Node backend         Rust commands
   |                     |
  Git command line executable
```

The user interface never builds a Git command. It calls named methods such as
`branch.checkout` and `log.list`. The Node backend answers those names today.
Rust will answer the same names later. Only `transport.ts` knows which one is
in use.

### Where the code lives

| Path | What it holds |
|---|---|
| `server/git.mjs` | Starts the Git command line executable. This is the only file that does so. |
| `server/api.mjs` | The list of methods, such as `log.list` and `branch.create`. |
| `server/rebase-helper.mjs` | Stands in for the editor that `git rebase -i` would open. |
| `server/vite-plugin-git.mjs` | Serves those methods over HTTP* during development. |
| `src/lib/git/` | Types, the transport, and the repository service. |
| `src/lib/graph/layout.ts` | Turns the commit graph into columns for drawing. |
| `src/lib/state/` | Repository state, dialogs and messages. |
| `src/lib/actions.ts` | Every user action, with its safety check attached. |
| `src/lib/components/` | The Svelte* components. |
| `src/lib/components/Icon.svelte` | The small glyphs used in the branch panel. |

### The graph

`src/lib/graph/layout.ts` is the important part. It reads the list of commits
and decides which column each commit and each line belongs to. It produces
plain data. It knows nothing about the screen, so you can test it on its own
and draw it any way you like.

A lane stays open while it waits for a named commit. When that commit appears,
the lane passes to the commit's first parent. This is what keeps one branch in
one column instead of letting it move sideways.

Measured on a repository with 1307 commits and 35 branches: Git returns the log
in about 83 milliseconds, and the layout takes about 4 milliseconds. The graph
uses 6 columns. The list on screen is virtualised, so only the visible rows
exist in the page.

### Safety

Section 18 of the plan asks the application to protect the user. Before a
branch is deleted, Gitalia asks Git three questions: is this branch merged, does
a copy exist on a remote, and how many commits would become unreachable. It
then states those facts in the dialog. It only uses the forced delete when the
answer shows that commits would be lost, and only after you agree.

Every action lives in `src/lib/actions.ts`, so a check cannot be present in one
place and missing in another.

The squash checks run twice. The screen runs the cheap ones, so the menu entry
is greyed out with a short reason the moment you select the commits. The
backend runs all of them again before it touches anything, so a mistake in the
screen cannot lead to a damaged repository. If a rebase fails part way, Gitalia
aborts it, which leaves the branch where it started.

## Known limits

1. The browser cannot open a folder chooser, so you paste a path instead. Tauri
   will provide a real folder chooser.
2. The graph loads the newest 5000 commits. Older commits are not drawn yet.
3. The recent list is stored in the browser, so it is lost if you clear the
   browser data.
4. The backend runs only during development. There is no packaged application
   yet.

## Glossary

Every term marked with an asterisk (*) in this document is explained here.

**Git**: The version control program that records the history of a project. It
stores every change as a commit, and it can show, compare and undo them.

**Hash**: The long identifier that Git gives to every commit, for example
`f08795d`. No two commits share one.

**HTTP**: HyperText Transfer Protocol. The rules that a web browser uses to ask
a server for data.

**IntelliJ IDEA**: A commercial development environment made by JetBrains. It
is well known for its Git tools, which this project takes as its standard.

**Node.js**: A program that runs JavaScript outside a web browser. Gitalia uses
it to run Git commands and to build the user interface.

**Repository**: A folder whose history Git records. It contains your files and a
hidden `.git` folder holding every past version.

**Rust**: A programming language used for fast and safe programs. Tauri uses it.

**Svelte**: A toolkit for building user interfaces. It turns components into
plain JavaScript when the project is built.

**Tauri**: A toolkit for building desktop applications. The window shows a web
page, and the program behind it is written in Rust. Applications built this way
are much smaller than ones built with Electron.
