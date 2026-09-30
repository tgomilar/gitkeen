# Gitalia

Gitalia is a standalone visual Git* client. It gives you the commit graph and
the history tools that IntelliJ IDEA* offers, without asking you to change your
editor. Your editor writes code. Gitalia manages your history.

The plan the app is built from is `plan.md`. Today Gitalia covers one
workflow: open a repository*, read its history, select commits, switch
branches, commit your work, and change the history you already have.

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
| Conflicts | Resolve them in the merge editor: keep one side, keep both, or edit the result, then continue or abandon the operation. |
| Stash | Set work aside without committing it, and take it back later. |
| Roll back | Throw away your changes to chosen files. |
| Push | Publish a branch, and create it on the remote if it is new. Force push replaces the remote branch, after showing what it would remove. |
| Pull | Bring the upstream branch in, after showing what is coming. |
| Merge | Join another branch into this one, after showing what would conflict. |
| Tags | Name a commit, with or without a description, and delete tags. |
| Reorder | Move a commit one place earlier or later in the history. |
| Rebase | Edit a run of commits in one go: reorder, reword, squash, fixup, drop, and stop at a commit to amend it. |
| Drop | Remove commits from the branch entirely. |
| Squash | Combine a run of selected commits into one, as IntelliJ IDEA does. |
| Search | Search the whole history by message, author, file, date, hash* or branch name. |
| Blame | See which commit last changed each line of a file, and follow a line back in time. |
| Bisect | Find the commit that broke something by testing a few commits in between. |
| Compare | See the commits and files that differ between two branches or commits. |
| Worktrees | Check out another branch in a folder of its own, and switch between the folders. |
| Submodules | See the repositories kept inside this one, check them out, and open them. |
| Signing | Sign a commit with your key, and see whether a commit's signature checks out. |
| Git LFS* | See which files are stored in LFS, track new kinds of file, and download their content. |
| Patches and bundles | Save commits as a patch file and apply one, or carry a whole repository in one bundle file. |
| GitHub | List the pull requests*, open one for the current branch, and see whether checks passed. |
| AI* help | Suggest a commit message, and explain a commit, a conflict, two branches or a risky operation in plain words. |
| Stats | Read a report on the history: who committed, how much, and when. |
| Safety | Read what a destructive action will do before it runs. |
| Undo | Put back a branch, tag or stash that an operation rewrote or deleted. |
| Themes | Switch between a dark and a light theme, in one of five well-known colour palettes, and make the text larger or smaller. |

## How squashing works

Select two or more commits that sit next to each other, then right click and
choose **Squash commits**. Gitalia joins their messages, oldest first, and lets
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
A partly staged file has some of its changes in the index and the rest not.
Its box shows a dash instead of a tick, and the row says **partly staged**,
because a commit would take only part of it. Click the box once to stage the
rest of the file. Click it again to unstage the whole file.

When you press Commit, Gitalia commits exactly what the index holds: whole
ticked files and, if you staged some of a file, only those hunks*. A file you
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
| Hunk box | Next to each hunk of a working tree change. Tick the hunks you want, then **Stage selected**. Do the same on the Staged tab to **Unstage selected**. |
| Line number of a changed line | Click it to leave that one line out of the stage, or to bring it back. A line left out is faded and crossed out, and its hunk box shows a dash. |
| Roll back selected… | On the Working tree tab: throws the selected hunks or lines away. What is staged is not touched, and the Undo panel can bring them back. |
| Stage file / Unstage file | Stages or unstages the whole file in one click, from the viewer. |

A file with part of its change in the index and part still in the working tree
opens on its **Working tree** half. When you stage or unstage every hunk, the
viewer follows the whole change over to the other tab by itself.

Code is coloured by its language, which Gitalia reads from the file name.
About 30 languages are known, among them TypeScript, JavaScript, Svelte, Vue,
Python, Rust, Go, Java, Kotlin, Swift, C, C++, C#, Ruby, PHP, shell, SQL, CSS,
HTML, JSON, YAML, TOML, Markdown and Dockerfiles. The colours follow the
colour palette you chose. Each side of a hunk is coloured as one piece, so a
comment or a string over several lines keeps its colour. The blame view is
coloured the same way, over the whole file.

Both layouts mark the words that changed inside a line, so a line where one
name was edited does not read as a line that was rewritten. When two lines have
almost nothing in common, the whole line is marked instead, because marking
every word would be harder to read than marking none.

Gitalia handles these cases and says which one applies:

| Case | What you see |
|---|---|
| A renamed file | The old name in the header. If only the name changed, the viewer says so. |
| An image | The picture before and after, side by side on a checkerboard so transparent parts show, with each one's size in pixels and in bytes. PNG, JPEG, GIF, WebP, BMP, ICO and AVIF are shown. |
| Another binary file | A note that the file changed. Gitalia cannot show how. |
| A permission change | A note that Git recorded a change although the text is the same. |
| A very large file | The first 800 lines, with a button to draw more. Above 20000 lines the rest is not read at all. |

## Copying, undoing and moving commits

Right click a commit in the graph. Select several commits first to act on all
of them at once.

| Action | What it does |
|---|---|
| Cherry-pick | Applies the commit again on top of the current branch, as a new commit with a new hash. The original stays where it is. |
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

A merge, a pull, a cherry-pick, a revert and a rebase from the rebase editor
can all stop on a conflict. Git then waits. The status bar shows which
operation is open and offers two ways out.

| Button | What it does |
|---|---|
| Continue | Carries on. It stays switched off until no file has a conflict left. |
| Abandon | Puts the branch back as it was before the operation started. |

Open the commit panel to see the conflicted files. The status bar's
**Resolve…** button, or right clicking the file and choosing **Resolve in
Merge Editor…**, opens the merge editor.

The editor walks the file from top to bottom. Each `<<<<<<<` block is shown
in three columns: **Ours** on the left, **Theirs** on the right, and the
**Result** between them. **Keep ours**, **Keep theirs** or **Keep both** (ours
first, then theirs) fills the result. You can then edit the result by hand,
and **Undo edits** goes back to the side you chose. The two sides are:

| Side | In a merge, cherry-pick or revert | In a rebase |
|---|---|---|
| Ours | The branch you are on. | The branch you are rebasing onto. |
| Theirs | The commit or branch coming in. | Your own commit, being replayed. |

The editor says which is which during a rebase, because there the two names
are the reverse of what most people expect. **Show base** shows the common
ancestor that both sides changed. A block with no choice keeps Git's markers.
**Mark resolved** writes the file and tells Git the conflict is dealt with.
The operation's **Continue** in the status bar then becomes available.

When one side deleted the file and the other side changed it, the editor shows
the whole file as one choice. The side that deleted it offers **Delete the
file**, and choosing it removes the file.

Gitalia refuses to mark a file that still contains markers, so a line such as
`<<<<<<<` cannot reach your history by accident. It also refuses to open a
symbolic link*, because writing through one could change a file outside the
repository. A binary file, a link, or a file you would rather fix by hand can
still be resolved outside Gitalia and then marked resolved from the commit
panel.

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

Right click a commit and choose **Rebase from here**. Gitalia opens the todo
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

Drag a row by its grip (⋮⋮) to another place, or use the arrows on each row
to move it one place earlier or later. A dropped row stays in place,
greyed and struck through, so the list never jumps under the pointer while you
are working in it. A folded row is indented under the one it joins.

An **Edit** row does exactly what the name says. The run stops at that commit,
the status bar reports the rebase as paused, and you amend it however you want:
edit its files in your own editor, or write a new message for it here first.
**Continue** in the status bar adds that to the commit and applies the rest of
the plan. It pauses again at the next Edit row if there is one. **Abandon**
puts the branch back as it was before the rebase started.

This is what Continue adds to the stopped commit:

| Change | Added? |
|---|---|
| A new message written for the Edit row | Yes |
| Edits to files Git already tracks | Yes, staged or not |
| A new file you staged | Yes |
| A new file you did not stage | No. It stays in the working tree, untracked. |

If you make commits of your own while the rebase is paused (for example, to
split the commit in two), Continue keeps them exactly as you made them and
amends nothing. The plan is saved with the rebase, so Continue still writes
the messages that come later in the plan after you reload Gitalia.

Nothing runs until you press **Start rebase**. Until then the plan is only a
plan, and Cancel costs nothing. **Reset** puts every row back as it arrived.

Gitalia will not start a rebase that changes nothing, that drops every commit,
or whose oldest kept commit folds upwards into something that is not there. It
says which of these is wrong underneath the list rather than waiting until you
press the button.

If a commit does not apply cleanly in the order you asked for, the rebase
stops on that conflict. Resolve it in the merge editor and press **Continue**.
The rest of the plan then runs, and it stops again at the next conflict if
there is one. **Abandon** puts the branch back exactly as it was. A move or a
drop from the commit menu is different: it is abandoned at once if it
conflicts, because you asked for one small change, not for a rebase to finish.

## Moving and removing commits

Both of these rewrite history. Gitalia drives real `git rebase --interactive`
underneath, writing the todo list for you, so the result is what Git would
have produced had you edited that list by hand.

**Move up** and **Move down** in a commit's menu shift it one place towards or
away from HEAD. One step per click, so you can read the result before taking
the next one. **Drop commit** removes a commit and the change it made.

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
section, and choose **Merge into <current branch>…**. The item names the branch
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
| Apply and keep | Puts the change back and keeps the stash as well. |
| Delete | Throws the change away. It is in no commit, so this cannot be undone. |

Two details worth knowing:

1. An unversioned file that you stash is removed from disk until you put it
   back. The dialog says so before it runs.
2. If a stash does not fit the files you have now, Git leaves you with
   conflicts to resolve and keeps the stash, so nothing is lost. Delete it
   yourself once you are happy with the result.

Stashes do not appear in the graph. Git stores each one as a commit, but they
are not part of your history, so showing them would only be confusing.

## Searching the history

Type in the search box above the graph, or press Command or Control with K.
The commits already loaded are filtered at once. A moment after you stop
typing, Gitalia also asks Git to search the whole history, so older commits
are found too. An older commit appears at the end of the list without its
graph lines, because that part of the graph is not loaded. You can still
select it and read its details.

Each word must appear in the commit message, in any case. Put a phrase in
quotes to find those words together. These qualifiers narrow the search:

| Qualifier | Example | Finds commits |
|---|---|---|
| `author:` | `author:ann` | by an author whose name or email contains the text |
| `path:` | `path:src/app.ts` | that changed this file, or a file in this folder |
| `since:` | `since:2024-01-01` or `since:"2 weeks ago"` | made on or after this date |
| `until:` | `until:2024-06-30` | made on or before this date |

A hash, or the start of one, finds that commit. When the graph is narrowed to
a branch, the search stays inside that branch. Git returns at most 1000
matches, and the header above the graph says when there were more.

## Blame: who changed each line

Blame shows, for every line of a file, the commit that last changed it. Open it
in one of three ways:

1. In the diff viewer, press **Blame**. You see the file as it is in that
   commit, or in the working tree.
2. In the commit panel, right click a changed file and choose **Blame**.
3. In the command palette, choose **Blame a file…** and type its path.

Lines from the same commit form one block. The first line of a block shows
the commit's hash, author and date, and the second line shows its subject.
Lines you have not committed yet say so. Click a hash to select that commit in
the graph and read its details. **Before this** opens the file as it was just
before that commit, so you can follow a line back through each change to it.
**Back** returns to the newer version. Blame follows a file across a rename.

## Bisect: finding the commit that broke it

Bisect finds the first bad commit between one that works and one that does
not. Each answer you give halves the commits left, so a thousand commits take
about ten tests.

1. Right click a commit you know works and choose **Bisect from here…**. HEAD
   is taken as broken. To name both ends, select the two commits and choose
   **Bisect between these…**; the older one is taken as working.
2. Gitalia checks out a commit halfway between them. Build it, run it, or run
   your tests.
3. Press **Good** or **Bad** in the status bar. Press **Skip** if this commit
   cannot be tested. The graph marks every commit you answered for.
4. When one commit is left, the status bar names it and the graph selects it.
5. Press **Stop** to end the bisect and go back to your branch.

Git refuses to check out a commit that would overwrite your uncommitted
changes, so stash or commit them before you start.

## Comparing two branches or commits

Right click a branch or tag and choose **Compare with**, followed by the name
of your current branch. To compare two commits, select both and choose
**Compare these two**. The command palette also lists **Compare** for every
local branch.

The left side lists the commits that only one side has. The right side lists
the files that differ. Click a commit to select it in the graph. Click a file
to read its diff between the two sides. Press **⇄** to swap the sides.

| Mode | Which files are listed |
|---|---|
| Since they split | What the second side changed after the two went apart. This is what merging it would bring in. |
| Tip to tip | Every difference between the two ends as they are now, changes on both sides included. |

Two histories with no commit in common can only be compared tip to tip.

## Worktrees: two branches side by side

A worktree is another folder of the same repository with a different branch
checked out. You can work on a fix in one folder while a feature stays open in
another, without stashing or switching.

1. Right click a branch and choose **Open in a new worktree…**, or choose
   **New worktree…** in the command palette to start a new branch.
2. Gitalia offers a folder beside the repository, named after it and the
   branch. Change it if you want.
3. Choose **Open it** to switch Gitalia to the new folder.

The **Worktrees** list at the bottom of the Branches panel shows every folder
and the branch it has checked out. Double click one to open it. Right click to
copy its path or remove it. Removing deletes the folder but keeps the branch
and its commits. Git refuses to remove a folder with uncommitted changes
unless you choose to throw them away. A branch can be checked out in only one
folder at a time, so its menu offers **Open its worktree** instead.

## Submodules

A submodule is another repository kept inside this one. This repository
records which commit of it to use. When a repository has submodules, the
Branches panel lists them under **Submodules**, each with its state:

| State | Meaning |
|---|---|
| A short hash | Checked out at the commit this repository records. |
| not checked out | Not cloned yet, as after a fresh clone. |
| moved | Checked out at a different commit than the one recorded. |
| conflict | A merge left two different commits recorded for it. |

Right click a submodule to **Check out** or **Update** it to the recorded
commit, or to copy its path or URL. Double click it, or choose **Open in
Gitalia**, to work in it as a repository of its own. Right click the
**Submodules** heading, or use the command palette, to update them all.

## Signed commits

A signed commit carries proof of who made it. Git can sign with an OpenPGP*
key, an SSH* key or an X.509 certificate. You set this up once in Git itself,
with `user.signingkey` and, for SSH, `gpg.format ssh`.

When a signing key is set up, the commit panel shows a **Sign** box next to
**Amend**. It starts ticked if your Git settings sign every commit
(`commit.gpgsign`), and you can change it for one commit.

The commit details show how a signed commit stands:

| Label | Meaning |
|---|---|
| signed, verified | The signature is good, and Git trusts the key. |
| signed, key not trusted | The signature is good, but Git has not been told to trust the key. |
| signed, cannot be checked | This computer does not know the key. For SSH, the key is not in `gpg.ssh.allowedSignersFile`. |
| signed, signature expired, key expired or key revoked | The signature was good once, but no longer counts. |
| bad signature | The commit does not match its signature. It may have been changed after it was signed. |

Hover over the label to see the signer and the key.

## Git LFS: large files

Git LFS keeps large files, such as images, videos and builds, outside the
repository. Git commits a small pointer to each one, and the content is
downloaded when it is needed. Gitalia needs the `git-lfs` program for this. On
a Mac, install it with `brew install git-lfs`.

When a repository uses LFS, the status bar shows **LFS**. It warns when some
files are only pointers, when `git-lfs` is not installed, or when LFS is not
set up for the repository. Click it, or choose **Git LFS…** in the command
palette, to open the Git LFS window:

| Part | What it does |
|---|---|
| Set up for this repository | Sets LFS up for this repository only. Your global Git settings are not changed. |
| Stored in LFS | The file patterns sent to LFS, such as `*.psd`. Type a pattern and press **Track** to add one, or **Stop tracking** to remove one. |
| Files | Every LFS file in the current commit, with its size, and whether its content is here or only its pointer. **Download them** fetches what is missing. |

Tracking a pattern changes `.gitattributes`. Commit that file, so that other
people store the same files in LFS. In the commit panel, right click a file to
store every file of its kind in LFS. The diff viewer shows a change to an LFS
file as its size and content before and after, not as the pointer lines.

## Themes, colour palettes and text size

Click **◐** at the right of the title bar to choose light or dark, and the
colour palette. Light or dark and the palette are chosen apart, so every
palette comes in both:

| Palette | Light | Dark |
|---|---|---|
| VS Code (the default) | Light Modern | Dark Modern |
| GitHub | GitHub Light | GitHub Dark |
| One | One Light | One Dark |
| Solarized | Solarized Light | Solarized Dark |
| Dracula | Alucard | Dracula |

The command palette lists each palette too. Gitalia remembers your choice. The
graph lanes, the branch and tag labels, the file states and the diff colours
all follow the palette. The Git orange of the logo stays the same.

The same menu sets the text size, from 85% to 140%:

| Size | Scale |
|---|---|
| Smallest | 85% |
| Smaller | 90% |
| Default | 100% |
| Larger | 110% |
| Large | 125% |
| Largest | 140% |

Command or Control with + makes the text one step larger, with − one step
smaller, and with 0 puts it back to the default. These keys also work on the
welcome screen. The whole interface scales together, the way an editor zooms,
so rows, spacing and text keep their proportions and nothing is cut off.
Gitalia remembers the size.

## Patches and bundles: moving work without a server

A patch file holds commits as text, the way `git format-patch` writes them.
Right click a commit and choose **Save as patch**, or select several and
choose **Save … commits as a patch**. To apply one, choose **Apply a patch
file…** in the command palette.

| Kind of patch | What applying it does |
|---|---|
| Written by `git format-patch` or Gitalia | Adds its commits on top of the current branch, with their authors and messages. |
| A plain diff | Changes the files. The change then waits in the commit panel. |

Gitalia checks the patch first. If it does not fit, nothing is changed.

A bundle is one file that holds branches and tags, for moving a repository
where there is no server. **Export a bundle** in the command palette saves
every branch and tag. **Import a bundle…** brings one in under a name you
choose, so its branches arrive as `name/branch`, the way a remote's do. No
branch of your own moves.

## GitHub

When a repository has a remote on github.com, **GitHub** appears in the rail
on the left. Gitalia needs a token to reach GitHub. It uses, in this order:

1. `GITHUB_TOKEN` from the environment.
2. A token saved in Settings, under GitHub.
3. The GitHub CLI's sign-in, if you ran `gh auth login`.

A fine-grained token needs access to the repository, **Pull requests** (read
and write), and **Commit statuses** and **Actions** (read). The token stays in
Gitalia's backend. The page is told only whether there is one.

| Where | What it shows or does |
|---|---|
| GitHub panel | The pull requests (open, closed or all), each with its branches, author, age and checks. Click one to open it on GitHub. |
| GitHub panel, **New pull request for …** | Opens a pull request from the current branch into the default branch. The title and description start from the branch's commits, and you can open it as a draft. |
| Branches panel | A dot beside each branch GitHub has: green when its checks passed, red when one failed, and amber while they run. |
| Commit details | Each check of the selected commit, with a link to it. |

A branch must be pushed, with every commit, before a pull request can be
opened for it, because GitHub makes the pull request from what it has.

## AI help

Gitalia can ask an AI model for help. It works with an Anthropic or OpenAI
key, which you add in Settings (the sparkle button in the title bar), or with
a model running on your own computer in LM Studio* or Ollama*. A local model
sends nothing off your computer. When no provider is set up, none of these
buttons appear.

| Where | What it does |
|---|---|
| Commit panel, the sparkle button | Writes a commit subject from the staged change, following this repository's commit rules. |
| Commit details, **Explain this commit** | Says what the commit changed and why it probably matters. |
| Merge editor, **Explain this conflict** | Says what each side was trying to do, and what a good resolution would keep. |
| Compare view, **Explain how they differ** | Says what each branch did after the two split. |
| A warning dialog, **Explain in plain words** | Says what the operation will do, what could be lost, and how to undo it. |

An explanation names the model that wrote it. It can be wrong, so read it as
a second opinion, not as the truth. Nothing in the repository changes when
you ask for one.

## Undoing an operation

Before an operation rewrites or deletes history, Gitalia saves where the
affected branch, tag or stash pointed. This is a recovery point. It keeps the
old commits safe from Git's clean up, and it never appears in the graph.

Choose **Undo** in the rail on the left to see these operations, newest first.
**Restore** puts things back where they were before that operation:

| Operation | What Restore does |
|---|---|
| Reset, squash, drop, move, rebase or amend | Moves the branch back to its old commit. |
| Delete a branch | Creates the branch again at its old commit. |
| Delete a tag | Creates the tag again, if no tag has taken its name since. |
| Drop a stash | Puts the stash back on the stash list. |
| Force push | Creates a local branch named `recovered/<branch>` at the commit the remote had. Push it yourself to put the remote back. |
| Roll back a file, a hunk or a line | Writes back what the file held before the rollback. |

A restore is logged as well, so you can undo a restore the same way. Restoring
the branch you are on keeps your uncommitted changes. If a restore would
overwrite a file you changed, Git refuses it and nothing moves. Nothing can be
restored while a merge, rebase or other operation is still open.

The log keeps the newest 100 operations. It is stored in the repository's
`.git` folder, so it belongs to the repository and not to Gitalia.

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

The merge editor edits the result one conflict block at a time. The text
outside the conflicts cannot be edited there, and binary conflicts still go
through an external editor.

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
| `npm run desktop:dev` | Runs the desktop app in development. |
| `npm run desktop:build` | Builds the desktop app, `Gitalia.app` and a `.dmg` to share it. |

## The desktop app

Gitalia also runs as a desktop app, built with Tauri*. It is the same
interface and the same Git backend as in the browser. The backend runs as a
separate program inside the app, and only the app can reach it: it listens on
this computer alone, and answers nothing without a secret the app chooses
each time it starts.

To build it you need Rust* (install it from rustup.rs) and the Xcode command
line tools. Then run `npm run desktop:build`. The first build takes a few
minutes and needs about 3 GB of free disk space for Rust's build folder,
`src-tauri/target`, which you can delete afterwards. The app lands in
`src-tauri/target/release/bundle/`:

| File | Size |
|---|---|
| `macos/Gitalia.app` | about 97 MB, most of it the Node runtime the backend needs |
| `dmg/Gitalia_0.1.0_aarch64.dmg` | about 32 MB, for giving the app to someone else |

In the app, the welcome screen has a **Choose folder…** button, patches and
bundles are saved through the usual save dialog, and links to GitHub open in
your browser. The app reads `PATH`, `GITHUB_TOKEN` and the AI settings from
your login shell when it starts, the same ones a terminal has, so it finds
`git-lfs`, `gh` and your keys even when opened from the Finder.

The app is not signed with an Apple Developer ID or notarized yet. It opens
on the Mac that built it. On another Mac, macOS says it cannot check the app;
right click it and choose **Open** to open it anyway.

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
| Command or Control with B | Switch branch: opens the command palette with the branches listed. |
| Command or Control with + or − | Make the text one step larger or smaller. |
| Command or Control with 0 | Put the text size back to the default. |
| G | Put the keyboard on the commit graph. |
| R | Revert the selected commits. Gitalia asks before it changes anything. |
| S | Stage or unstage the file selected in the commit panel. In the diff viewer, stage or unstage the selected hunks. |

The single keys G, R and S do nothing while you type in a text field or while
a dialog or an editor is open.

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
| `server/test/rebase.test.mjs` | Squash, the interactive rebase editor, and continuing an Edit stop. |
| `server/test/remote.test.mjs` | Push, force push, pull and merge. |
| `server/test/repo.test.mjs` | Branch and tag operations, stashes, and the listings. |
| `server/test/changes.test.mjs` | Staging files and hunks, and what a commit takes from the index. |
| `server/test/conflicts.test.mjs` | Reading a conflicted file for the merge editor, and writing a resolution. |
| `server/test/log.test.mjs` | Reading the history a page at a time. |
| `server/test/recovery.test.mjs` | The operation log, and restoring what an operation changed. |
| `server/test/blame.test.mjs` | Which commit last changed each line of a file. |
| `server/test/bisect.test.mjs` | Finding the first bad commit with bisect. |
| `server/test/compare.test.mjs` | Comparing two branches or commits. |
| `server/test/worktree.test.mjs` | Adding, listing, removing and pruning worktrees. |
| `server/test/submodule.test.mjs` | Listing submodules and updating them to their recorded commits. |
| `server/test/signing.test.mjs` | Signing a commit, and reading whether a signature checks out. |
| `server/test/patch.test.mjs` | Saving and applying patches, and exporting and importing bundles. |
| `server/test/github.test.mjs` | Pull requests and checks, against a stand-in for GitHub's API. |
| `server/test/explain.test.mjs` | What each AI explanation is shown, against a stand-in model. |
| `server/test/lfs.test.mjs` | Tracking files in Git LFS, reading LFS diffs, and downloading content. Skipped without git-lfs. |

The cases worth having are the ones where Gitalia must **refuse**. A wrong
refusal is an annoyance; a wrong rewrite loses work. So the suite checks that
a force push is still blocked when the remote moved unseen, that a rewrite
across a merge is turned down rather than flattening it, and that a move or a
drop that cannot be replayed puts the branch back exactly as it was.

## How it is built

Git runs in a Node.js backend. In the browser it is reached over HTTP from
the development server. In the desktop app, built with Rust, the same
backend runs as a separate program, and the app passes each call on to it.

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
`branch.checkout` and `log.list`, and the Node backend answers them. Only
`transport.ts` knows how the call travels.

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
screen cannot lead to a damaged repository. If a squash, move or drop fails part
way, Gitalia aborts it, which leaves the branch where it started.

## Known limits

1. In the browser there is no folder chooser, so you paste a path instead. The
   desktop app has one.
2. The graph starts with the newest 5000 commits. "Load older commits" adds
   more a page at a time. A refresh keeps the commits already loaded.
3. The recent list is stored in the browser, so it is lost if you clear the
   browser data.
4. The desktop app is built for Apple silicon Macs only so far, and it is not
   signed for other Macs or updated automatically yet.
5. Gitalia does not watch the folder for changes. Press Refresh, or Command
   with R, after you edit files in your editor.
6. The Stats report reads the newest 20000 commits. If a repository holds more,
   the report says so and counts only those.
7. The Stats report groups people by email address, so one person with two
   addresses is counted as two contributors.

## Glossary

Every term marked with an asterisk (*) in this document is explained here.

**AI**: Artificial intelligence. Here, a language model that reads the change
and writes about it in words.

**Git**: A program that records every change made to a set of files, so that
people can see the history, work in parallel and combine their work.

**Git LFS**: Git Large File Storage. An add-on to Git that stores large files
on a separate server and commits only a small pointer to each one, so the
repository stays small.

**Hash**: The unique name Git gives a commit. It is a long string of letters
and numbers, and Gitalia usually shows only its first seven characters.

**HTTP**: Hypertext Transfer Protocol. The way a web browser and a server send
requests and answers to each other.

**Hunk**: One block of changed lines inside a file, with a few unchanged lines
around it. A file with changes in two separate places has two hunks.

**IDEA**: IntelliJ IDEA, a code editor made by the company JetBrains. Its Git
tools are the model for Gitalia.

**LM Studio**: A program that runs AI language models on your own computer.

**Node.js**: A program that runs JavaScript outside a web browser. Gitalia's
backend runs on it during development.

**Repository**: A folder whose history Git records, together with that
history.

**Ollama**: A program that runs AI language models on your own computer.

**OpenPGP**: A standard for signing and encrypting data with a pair of keys:
a private key that only you hold, and a public key that others use to check
your signature. The program gpg is the usual way to use it.

**Pull request**: A request, on a site such as GitHub, to merge one branch
into another. Others can review and discuss the change before it is merged.

**Rust**: A programming language. Tauri applications are written in it.

**SSH**: Secure Shell. A way to log in to other computers safely. SSH keys can
also sign Git commits, which is often simpler than setting up OpenPGP.

**Svelte**: A tool for building web user interfaces. Gitalia's screens are
written with it.

**Symbolic link**: A special file that points to another file or folder, which
can be anywhere on the computer.

**Tauri**: A tool for turning a web application into a desktop application for
Windows, macOS and Linux.
