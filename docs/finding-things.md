# Finding things

This page covers search, blame, bisect and compare.

## Searching the history

Type in the search box in the title bar, or press Command or Control with K.
The commits already loaded are filtered at once. When you stop typing, Gitkeen
also asks Git to search the whole history, so older commits are found too. An
older commit appears at the end of the list without graph lines, but you can
still select it and read its details.

Every word must appear in the commit message, in any case. Put a phrase in
quotes to find the words together. These words narrow the search:

| Write | Example | Finds commits |
|---|---|---|
| `author:` | `author:ann` | by an author whose name or email contains the text |
| `path:` | `path:src/app.ts` | that changed this file, or a file in this folder |
| `since:` | `since:2024-01-01` or `since:"2 weeks ago"` | made on or after this date |
| `until:` | `until:2024-06-30` | made on or before this date |

A hash, or the start of one, finds that commit. When the graph shows one
branch, the search stays in that branch. Git returns at most 1000 matches, and
the header above the graph says when there were more.

## Blame: who changed each line

Blame shows, for each line of a file, the commit that last changed it. Open it
in one of these ways:

1. In the diff viewer, press **Blame**.
2. In the commit panel, right click a changed file and choose **Blame**.
3. In the command palette, choose **Blame a file…** and type its path.

Lines from the same commit form one block, with the commit's hash, author, date
and subject. Click a hash to select that commit in the graph. **Before this**
opens the file as it was immediately before that commit, so you can follow a line back
through every change. **Back** returns to the newer version. Blame follows a
file across renames.

## Bisect: finding the commit that broke something

Bisect finds the first bad commit between one that works and one that does
not. Each answer halves the commits that are left, so 1000 commits take about
ten tests.

1. Right click a commit that works and choose **Bisect from here…**. HEAD is
   taken as broken. To choose both ends, select two commits and choose
   **Bisect between these…**. The older one is taken as working.
2. Gitkeen checks out a commit halfway between them. Build it, run it, or run
   your tests.
3. Press **Good** or **Bad** in the status bar. Press **Skip** if you cannot
   test this commit. The graph marks every commit you answered.
4. When one commit is left, the status bar names it and the graph selects it.
5. Press **Stop** to end the bisect and go back to your branch.

Commit or stash your changes before you start. Git refuses to check out a
commit that would overwrite them.

## Comparing two branches or commits

Right click a branch or tag and choose **Compare with** followed by your
current branch. To compare two commits, select both and choose **Compare these
two**. The command palette lists **Compare** for every local branch.

The left side lists the commits that only one side has. The right side lists
the files that differ. Click a commit to select it in the graph, or click a
file to read its diff. Press **⇄** to swap the sides.

| Mode | Which files are listed |
|---|---|
| Since they split | What the second side changed after the two went apart. This is what merging it would bring in. |
| Tip to tip | Every difference between the two ends as they are now. |

Two histories with no commit in common can only be compared tip to tip.
