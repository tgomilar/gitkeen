# Gitalia

Gitalia is a standalone visual Git* client. It gives you the commit graph and
the history tools that IntelliJ IDEA* offers, without asking you to change your
editor. Your editor writes code. Gitalia manages your history.

This repository holds Prototype 1, as defined in
`standalone-git-management-app-plan.md`. It covers one workflow: open a
repository*, read its history, select commits, switch branches, commit your
work, and change the history you already have.

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
| Commit panel | Tick the files you want, write a message, and commit. |
| Diff | Read what changed in a file, unified or side by side. |
| Cherry-pick | Copy one or more commits onto the current branch. |
| Revert | Undo a commit with a new commit that reverses it. |
| Reset | Move the current branch to another commit, in one of three modes. |
| Conflicts | Resolve them in the merge editor, choose a side per conflict, then continue or abandon the operation. |
| Stash | Set work aside without committing it, and take it back later. |
| Roll back | Throw away your changes to chosen files. |
| Push | Publish a branch, and create it on the remote if it is new. Force push replaces the remote branch, after showing what it would remove. |
| Pull | Bring the upstream branch in, after showing what is coming. |
| Merge | Join another branch into this one, after showing what would conflict. |
| Tags | Name a commit, with or without a description, and delete tags. |
| Reorder | Move a commit one place earlier or later in the history. |
| Rebase | Edit a run of commits in one go: reorder, reword, squash, fixup, drop. |
| Drop | Remove commits from the branch entirely. |
| Squash | Combine a run of selected commits into one, as IntelliJ IDEA does. |
| Search | Filter the graph by message, author, hash* or branch name. |
| Stats | Read a report on the history: who committed, how much, and when. |
| Safety | Read what a destructive action will do before it runs. |
| Themes | Switch between a dark and a light theme. |

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

## How the commit panel works

Choose **Commit** in the rail on the left. The panel lists everything in your
working tree that differs from the last commit, in two groups.

| Group | What it holds | Ticked at the start |
|---|---|---|
| Changes | Files Git already tracks: edited, added, deleted or renamed. | Yes |
| Unversioned Files | Files Git has never seen. | No |

Unversioned files start unticked on purpose. A build folder or an editor
setting file should never join a commit because you failed to notice it.

A tick is a real stage, the way `git add` and `git reset` work: what Git's own
index holds is exactly what the panel shows as ticked. Stage a file with
`git add` in a terminal and it appears ticked; unstage it and it loses its tick.
A partially staged file — some of its changes in the index, the rest not — is
shown with its tick on and its name in a mixed colour, because part of it is
committed and part is not.

When you press Commit, Gitalia commits exactly what the index holds: whole
ticked files and, if you staged some of a file, only those hunks. A file you
prepared with `git add` but left untouched is part of the commit; a change you
never staged stays out of it, on purpose. A renamed file is one row on screen,
and Gitalia sends both the old name and the new name to Git, so the rename is
recorded as a rename.

The colour of a file name tells you its state.

| Colour | Meaning |
|---|---|
| Blue | The file is edited or renamed. |
| Green | The file is new and already prepared for the next commit. |
| Grey, with a line through it | The file is deleted. |
| Brown | Git has never seen this file. |
| Red | The file has a merge conflict. |

Tick **Amend** to replace the previous commit instead of making a new one. The
box fills the message field with the message of that commit, and gives your own
text back if you untick it. If the commit you are replacing already exists on a
remote, Gitalia says so first, because publishing the replacement would need a
force push.

Two situations change these rules, and the panel says so on screen.

1. While a merge or a rebase is unfinished, Git refuses to commit part of the
   working tree. The tick boxes stop applying and the commit takes everything.
2. A file with a merge conflict cannot be committed until you resolve it.
   Gitalia names those files instead of letting Git fail with its own message.

Click a file name to select it. Double click it, or press Enter, to read its
diff. Right click it for **Roll back**, which throws away your changes to it. A
file that was newly added becomes unversioned again and stays on disk. Gitalia
never deletes a file.

The toolbar above the list can group the files by folder, expand and collapse
those folders, and read the working tree again.

## How the diff viewer works

There are two ways in.

1. In the commit panel, double click a file. You see the working tree compared
   with the last commit: exactly what committing that file would record.
2. In the commit details below the graph, click a file. You see what that one
   commit did to it.

The viewer covers the window, because a side by side comparison needs the
width. Press Escape to close it.

| Control | What it does |
|---|---|
| Unified | One column. Removed lines and added lines follow each other. |
| Side by side | Two columns. The old file on the left, the new one on the right. |
| Working tree | A working tree file shows this tab. It is the change that waits to be staged. |
| Staged | Its twin tab: the change already in the index. |
| Hunk box | Next to each hunk of a working tree change. Tick the hunks you want, then **Stage selected**; do the same on the Staged tab to **Unstage selected**. |
| Stage file / Unstage file | Stages or unstages the whole file in one click, from the viewer. |

A file with part of its change in the index and part still in the working tree
opens on its **Working tree** half. When you stage or unstage every hunk, the
viewer follows the whole change over to the other tab by itself.

Both layouts mark the words that changed inside a line, so a line where one
name was edited does not read as a line that was rewritten. When two lines have
almost nothing in common, the whole line is marked instead, because marking
every word would be harder to read than marking none.

Gitalia handles these cases and says which one applies:

| Case | What you see |
|---|---|
| A renamed file | The old name in the header. If only the name changed, the viewer says so. |
| A binary file | A note that the file changed. Comparing images and other binary files comes later. |
| A permission change | A note that Git recorded a change although the text is the same. |
| A very large file | The first 800 lines, with a button to draw more. Above 20000 lines the rest is not read at all. |

## Copying, undoing and moving commits

Right click a commit in the graph. Select several commits first to act on all
of them at once.

| Action | What it does |
|---|---|
| Cherry-Pick | Applies the commit again on top of the current branch, as a new commit with a new hash. The original stays where it is. |
| Revert | Adds a new commit that undoes the change. Nothing is removed from the history. |
| Reset Current Branch to Here | Moves the branch to this commit. |

Gitalia asks Git about the state of the repository before it offers to run any
of these, and says what it found.

| Case | What happens |
|---|---|
| The working tree has uncommitted changes | Cherry-pick and revert are refused, because Git would overwrite your work. |
| Another operation is unfinished | All three are refused until you finish or abandon it. |
| A merge commit is selected | Cherry-pick is switched off. Revert explains that it undoes the merge against the first parent, which is the branch the merge was made on. |
| The commit is already in this branch | Cherry-pick warns you that copying it would repeat the change. |
| The commit is not in this branch | Revert warns you that there is nothing here to undo. |

Cherry-picking several commits applies them oldest first, so they land in the
order they were written. Reverting several applies them newest first, which is
the order that works: undoing an old change before a newer one built on it
would conflict for no reason.

### Reset

Reset is the sharpest action in the application, so the dialog states the cost
of each mode beside the mode itself.

| Mode | Your files | The staging area |
|---|---|---|
| Soft | Not changed | Everything from the commits you leave behind is kept staged, ready to commit again |
| Mixed | Not changed | Nothing is staged. This is the usual choice |
| Hard | Made to match the target commit, so uncommitted work is destroyed | Nothing is staged |

Before anything moves, the dialog tells you how many commits would leave the
branch, whether a remote still holds them, and how many files you have not
committed. Choosing **Hard** while you have uncommitted work asks a second
time, because that work cannot be recovered by any means. After the reset, the
message tells you where the branch pointed before, so you can put it back.

### When an operation stops on a conflict

Cherry-pick and revert both change files, so both can stop on a conflict. Git
then waits. The status bar shows which operation is open and offers two ways
out.

| Button | What it does |
|---|---|
| Continue | Carries on. It stays switched off until no file has a conflict left. |
| Abandon | Puts the branch back as it was before the operation started. |

Open the commit panel to see the conflicted files. A merge, pull, cherry-pick
or revert that stops on a conflict stays open, and the status bar's **Resolve…**
button, or right clicking the file and choosing **Resolve in Merge Editor…**,
opens the three-way merge editor.

The editor walks the file from top to bottom. Around each `<<<<<<<` block it
shows the two sides — **Ours**, the current branch, and **Theirs**, the
incoming one — with **Keep ours** and **Keep theirs** buttons, and a **Show
base** toggle revealing the common ancestor the two sides both changed. A
block with no choice keeps Git's markers. **Mark resolved** writes the file
and tells Git the conflict is dealt with, and the operation's **Continue** then
lights up in the status bar.

Gitalia refuses to mark a file that still contains markers, so a line such as
`<<<<<<<` cannot reach your history by accident. A binary file, or one you
would rather fix by hand, can still be resolved outside Gitalia and then
marked resolved from the commit panel.

## Bringing in what others have pushed

Press **Pull** in the toolbar, or Command or Control with Shift and L. Gitalia
fetches first, then tells you what is actually coming before anything is
merged: how many commits, how many files they touch, and the first few of them
by subject, author and age.

Pull always merges. It never rebases, so nothing you have already committed is
rewritten and a pull can never leave you needing a force push. Git's own
`pull.rebase` setting is deliberately bypassed, so what the dialog described is
what runs.

What the dialog says depends on what it found:

| Situation | What happens |
|---|---|
| You have no commits of your own | The branch moves straight up to the remote. No merge commit is made. |
| You and the remote have both moved on | Git merges them and makes a merge commit. Your commits are kept as they are. |
| Nothing new on the remote | Gitalia says so and stops, rather than opening a dialog that would merge nothing. |

A pull will not start if you have uncommitted changes, if another operation is
already running, if the branch tracks nothing, or if HEAD is detached. The
reason is named in each case. An untracked file does not block a pull, because
Git can merge around it.

If the merge conflicts, Gitalia stops and leaves it open, exactly as it does
for a cherry-pick. The conflicted files appear in the commit panel, and the
status bar offers to continue once you have marked them resolved, or to
abandon the merge and put the branch back as it was.

When a push is refused because the branch is behind, the dialog that explains
it now offers to pull as the first way out.

## Rebasing a run of commits

Right click a commit and choose **Rebase from Here**. Gitalia opens the todo
list of `git rebase -i` as a list you edit, showing that commit and everything
newer.

Rows are listed **oldest first**, the order Git applies them in, which is the
opposite of the graph above. The heading says so, because getting that
backwards is how a rebase surprises you.

Each row takes one command:

| Command | What it does |
|---|---|
| Pick | Keep the commit as it is. |
| Reword | Keep the changes, write a new message. An Edit message button appears. |
| Edit | Stop the rebase here so the commit can be amended, then carry on. |
| Squash | Fold into the commit above, keeping both messages. |
| Fixup | Fold into the commit above, throwing this message away. |
| Drop | Remove the commit and the change it made. |

The arrows on each row move it earlier or later. A dropped row stays in place,
greyed and struck through, so the list never jumps under the pointer while you
are working in it. A folded row is indented under the one it joins.

An **Edit** row does exactly what the name says. The run stops at that commit,
the status bar reports the rebase as paused, and you amend it however you want:
edit its files in your own editor, or write a new message for it here first.
**Continue** in the status bar folds that into the commit and applies the rest
of the plan, pausing again at the next Edit row if there is one. **Abandon**
puts the branch back as it was before the rebase started.

Nothing runs until you press **Start Rebase**. Until then the plan is only a
plan, and Cancel costs nothing. **Reset** puts every row back as it arrived.

Gitalia will not start a rebase that changes nothing, that drops every commit,
or whose oldest kept commit folds upwards into something that is not there. It
says which of these is wrong underneath the list rather than waiting until you
press the button.

If the commits cannot be replayed in the order you asked for, the rebase is
abandoned and the branch is put back exactly as it was, the same as for a move
or a drop.

## Moving and removing commits

Both of these rewrite history. Gitalia drives real `git rebase --interactive`
underneath, writing the todo list for you, so the result is what Git would
have produced had you edited that list by hand.

**Move Up** and **Move Down** in a commit's menu shift it one place towards or
away from HEAD. One step per click, so you can read the result before taking
the next one. **Drop Commit** removes a commit and the change it made.

Dropping is not reverting, and the dialog says so. A revert adds a new commit
that undoes an old one, and the history records both. Dropping takes the
commit out as though it had never been made, so nothing is left to say it was
there. If you want the record, cancel and revert instead.

Everything after the commit you touch is replayed and gets a new hash. The
dialog says how many commits that is, and warns you when any of them have
already been pushed, because publishing the result then needs a force push.

If the commits cannot be replayed in the new order, because one depends on a
change another makes, Gitalia abandons the attempt and puts the branch back
exactly as it was. You are never left with a half-finished rebase to sort out.
Nothing is altered, and the message says so.

Neither is offered for a merge commit, and neither is offered when a merge
sits between the commit and the tip of the branch. Replaying commits across a
merge flattens it, throwing away the branch structure the merge records, so
Gitalia refuses rather than quietly rewriting your history into a straight
line. The same applies to the rebase editor.

Both name the branch's previous position in the message that follows. Gitalia
cannot undo a rewrite, but `git reset --hard <that hash>` in a terminal can.

## Tagging a commit

Right click a commit in the graph and choose **New tag here**, or right click
the **Tags** heading in the sidebar for a tag at HEAD. The heading carries its
own menu so there is a way in when you have no tags yet.

Gitalia asks for the name first and checks it against the rules Git uses, so a
name Git would refuse is caught before it is sent. It then asks for an
optional description:

| You type | What you get |
|---|---|
| A description | An annotated tag, which records who made it and when. Use these for releases. |
| Nothing | A lightweight tag: a plain name pointing at the commit, and nothing else. |

Tags appear in the Tags section of the sidebar and beside the commit in the
graph. Right click one to create a branch from it, copy its name or target, or
delete it.

Deleting removes the tag from your repository. The commit it pointed at is
untouched and stays in the history. If the tag has also been pushed, the
dialog says which remotes hold it and warns that it stays there: deleting a
pushed tag here does not remove it for anyone else, and your next fetch can
bring it back.

## Merging a branch into this one

Right click a branch in the sidebar, in either the Local or the Remote
section, and choose **Merge into <current branch>**. The item names the branch
you are on, so it is always clear which way the merge goes.

Before anything is touched, Gitalia asks Git what the merge would do and shows
it: how many commits are coming, how many files they touch, the first few
commits by subject and author, and **which files would conflict**. That last
part is a real answer from Git, not a general warning, and finding it out
costs nothing: the working tree is not touched and no merge is started.

If the branch you are on has no commits of its own, Gitalia fast-forwards it.
The branch simply moves up and no merge commit is made, which the dialog says
plainly so an absent merge commit is never a surprise. Otherwise Git joins the
two branches with a merge commit. Nothing on either branch is rewritten.

Merging is refused, with the reason named, when you have uncommitted changes,
when another operation is already running, when HEAD is detached, or when the
branch is the one you are already on. An untracked file does not block a
merge. If the branch is already contained in this one, Gitalia says so and
stops rather than making an empty merge.

A conflicted merge is left open, the same as a conflicted pull: resolve the
files in the commit panel, then continue or abandon it from the status bar.

## Stashing work you are not ready to commit

Sometimes you need your working tree clean but you are not finished. Tick the
files in the commit panel and press the stash button in its toolbar. The
changes are saved and taken out of your working tree, which is left as though
you had never made them.

This is Git's own stash, not a private store of Gitalia's own: `git stash
list` shows what you set aside here, and the command line can reach it.

Only the files you tick are stashed. Everything else stays in your working
tree, so you can set one piece of work aside and carry on with another.

The **Stashes** section at the bottom of the commit panel holds what you have
set aside. Open a stash to see the files in it, and click a file to read what
it holds. Right click a stash for the rest.

| Action | What it does |
|---|---|
| Unstash | Puts the change back into your working tree and removes the stash. |
| Apply and Keep | Puts the change back and keeps the stash as well. |
| Delete | Throws the change away. It is in no commit, so this cannot be undone. |

Two details worth knowing:

1. An unversioned file that you stash is removed from disk until you put it
   back. The dialog says so before it runs.
2. If a stash does not fit the files you have now, Git leaves you with
   conflicts to resolve and keeps the stash, so nothing is lost. Delete it
   yourself once you are happy with the result.

Stashes do not appear in the graph. Git stores each one as a commit, but they
are not part of your history, so showing them would only be confusing.

## The Stats report

Press **Stats** in the rail on the left. Gitalia reads the history and writes a
report on it: how much work was done, who did it, and when. It is meant for the
questions a developer or a project lead actually asks. Who is working on this?
Is the pace steady or did it stop in March? Which files does this project keep
reopening? Is all the knowledge in one person's head?

The report never changes anything. It reads the log and counts.

### What the report holds

| Part | What it answers |
|---|---|
| Headline numbers | Commits, contributors, lines added and removed, files touched, and when the last commit landed. |
| Commits over time | Whether the pace is steady, growing or stopped. One bar per day, or per month once the history is longer than 120 days. |
| Contributors | Who committed, how much each person did, and how long ago each was last seen. |
| When work happens | The hours of the day and the days of the week the work lands on. Click a contributor to see only theirs. |
| Most changed files | The files the project keeps returning to, and how many people have touched each one. |
| Where the lines go | Which file types the work goes into. |
| Latest commits | The most recent work in the period. |

### Choosing what it counts

The panel on the left holds the question, and the report answers it. Change
anything there and the report reads itself again.

| Control | What it does |
|---|---|
| Period | All time, or the last 7, 30 or 90 days, or the last 12 months. |
| Only the selected branch | Counts only the history that branch reaches. Pick the branch in the Branches panel first. |
| Merge commits | Off by default. A merge is counted as a commit but contributes no lines, because the changes it brings in are already counted on the commits it merges. |
| Generated files | Off by default. Lockfiles, bundles and vendored trees are written by tools, not by people. |

That last one matters more than it sounds. If `package-lock.json` is counted,
whoever last ran an install becomes the largest contributor in the report. That
is the kind of wrong number a report must not produce, so Gitalia leaves those
files out until you ask for them.

### Three things worth knowing

1. **Dates are commit dates.** The period filters on the commit date, so the
   report counts by the same clock. A rebased commit keeps the date it was
   written as its author date but gets a new commit date, so the two disagree.
   Counting by one and filtering by the other would put commits in a report
   that fall outside the period it claims to cover.

2. **People are grouped by email address.** One person with two addresses
   appears twice, because Git has no way to know they are the same person. When
   one address carries several spellings of a name, the report says "also" and
   lists them, so at least that much is visible.

3. **A report is read on demand.** Every other panel refreshes with the
   repository. This one costs a full pass over the log, which takes a few
   seconds on a large history, so it is read when you open it and again when
   you change the question. Press Command with R to read it again.

**Export CSV** saves the contributor table as a file, with every contributor in
it rather than the 25 the screen shows.

## What is not built yet

The merge editor resolves a conflict by choosing, per block, which side wins.
It does not yet let you hand-edit the merged result inside Gitalia itself, and
binary conflicts still go through an external editor.

The diff viewer has no syntax colouring yet, and it cannot roll back a single
hunk. Hunk staging is built; rolling back a hunk is the next step for it.

Gitalia does not offer a separate staging area. It follows the IntelliJ IDEA
model, where a tick box decides what goes into the commit. The tick is a real
stage: prepare files with `git add` outside Gitalia and they arrive ticked, and
a commit writes exactly what the index holds.

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
| Command or Control with Shift and L | Pull the current branch. |
| Command or Control with Shift and U | Push the current branch. |
| Command or Control with Shift and P | Open the command palette. |
| Command or Control with Shift and K | Open the commit panel and start typing a message. |
| Command or Control with Enter | Commit, while the message box has the cursor. |
| Enter | Read the diff of the selected file in the commit panel. |
| Escape | Close the diff viewer. |
| Command or Control with Shift and B | Create a branch at the selected commit. |

The command palette is a searchable list of everything the application can
do. It opens with Command or Control with Shift and P, filters as you type,
and runs a command with Enter. Selection based commands follow the commit you
have marked.

## Tests

```bash
npm test
```

Node's own test runner, so there is nothing to install. The tests run against
real Git: each one builds a throwaway repository in a temporary directory,
drives the same methods the user interface calls, and deletes it afterwards.
Your own repositories are never touched.

| File | What it covers |
|---|---|
| `server/test/harness.mjs` | Building and throwing away test repositories. |
| `server/test/rewrite.test.mjs` | Moving and dropping commits, and what must refuse. |
| `server/test/rebase.test.mjs` | Squash and the interactive rebase editor. |
| `server/test/remote.test.mjs` | Push, force push, pull and merge. |
| `server/test/repo.test.mjs` | Branch and tag operations, stashes, and the listings. |

The cases worth having are the ones where Gitalia must **refuse**. A wrong
refusal is an annoyance; a wrong rewrite loses work. So the suite checks that
a force push is still blocked when the remote moved unseen, that a rewrite
across a merge is turned down rather than flattening it, and that a rebase
that cannot be replayed puts the branch back exactly as it was.

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
| `src/lib/changes.ts` | Turns the file list from Git into the rows the commit panel draws. |
| `src/lib/diff.ts` | Pairs removed lines with added ones, and finds the words that changed. |
| `src/lib/components/` | The Svelte* components. |
| `src/lib/components/Icon.svelte` | The small glyphs used across the panels. |
| `src/lib/components/CommitPanel.svelte` | The commit panel. |
| `src/lib/components/DiffViewer.svelte` | The diff viewer. |
| `src/lib/components/StashSection.svelte` | The stash list, at the bottom of the commit panel. |
| `src/lib/components/SplitButton.svelte` | A button with a rarer second action behind a caret, used for Push. |
| `src/lib/components/RebaseEditor.svelte` | The interactive rebase todo list. |
| `src/lib/components/StatsPanel.svelte` | The Stats panel: the question the report answers. |
| `src/lib/components/StatsReport.svelte` | The report itself. |
| `src/lib/state/stats.svelte.ts` | The filters, and the report that came back. |
| `src/lib/state/commit.svelte.ts` | Which files are ticked, and the commit itself. |

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
uses 6 columns. Only the visible rows exist in the page: the rest of the history
is held in memory, not in the DOM.

The graph draws the newest 5000 commits the moment the log arrives, without
waiting for the slower status and branch calls. "Load older commits" at the
bottom walks deeper in pages of 5000, each read from Git with a skip rather
than the whole history, so a repository of any size stays usable without ever
loading it all. A refresh returns to the newest window.

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
2. The graph starts with the newest 5000 commits. "Load older commits" adds
   more a page at a time, and a refresh returns to the newest window.
3. The recent list is stored in the browser, so it is lost if you clear the
   browser data.
4. The backend runs only during development. There is no packaged application
   yet.
5. Gitalia does not watch the folder for changes. Press Refresh, or Command
   with R, after you edit files in your editor.
6. The Stats report reads the newest 20000 commits. If a repository holds more,
   the report says so and counts only those.
7. The Stats report groups people by email address, so one person with two
   addresses is counted as two contributors.
