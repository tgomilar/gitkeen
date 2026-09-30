# Worktrees, submodules, LFS, patches and bundles

## Worktrees: two branches side by side

A worktree is another folder of the same repository, with a different branch
checked out. You can work on a fix in one folder while a feature stays open in
another, without stashing or switching.

1. Right click a branch and choose **Open in a new worktree…**. To start a new
   branch in a new folder, choose **New worktree…** in the command palette.
2. Gitkeen suggests a folder next to the repository, named after it and the
   branch. You can change it.
3. Choose **Open it** to switch Gitkeen to the new folder.

The **Worktrees** list at the bottom of the Branches panel shows every folder
and its branch. Double click one to open it. Right click to copy its path or
remove it. Removing deletes the folder but keeps the branch and its commits.
Git refuses to remove a folder with uncommitted changes unless you choose to
throw them away.

## Submodules

A submodule is another repository inside this one, fixed at a commit this
repository records. The Branches panel lists them under **Submodules**:

| State | Meaning |
|---|---|
| A short hash | Checked out at the recorded commit. |
| not checked out | Not cloned yet, as after a fresh clone. |
| moved | Checked out at a different commit than the one recorded. |
| conflict | A merge left two different commits recorded for it. |

Right click a submodule to **Check out** or **Update** it to the recorded
commit, or to copy its path or URL. Double click it, or choose **Open in
Gitkeen**, to work in it as a repository of its own. Right click the
**Submodules** heading to update them all.

## Git LFS: large files

Git LFS keeps large files, such as images, videos and builds, outside the
repository. Git commits a small pointer to each file, and the content is
downloaded when it is needed. Gitkeen needs the `git-lfs` program for this. On
a Mac, install it with `brew install git-lfs`.

When a repository uses LFS, the status bar shows **LFS**. It warns when some
files are only pointers, when `git-lfs` is not installed, or when LFS is not
set up for the repository. Click it, or choose **Git LFS…** in the command
palette:

| Part | What it does |
|---|---|
| Set up for this repository | Sets up LFS for this repository only. Your global Git settings do not change. |
| Stored in LFS | The file patterns stored in LFS, such as `*.psd`. Type a pattern and press **Track**, or press **Stop tracking**. |
| Files | Every LFS file in the current commit, with its size and whether its content is downloaded. **Download them** fetches what is missing. |

Tracking a pattern changes `.gitattributes`. Commit that file, so other people
store the same files in LFS. In the commit panel, right click a file to store
every file of its type in LFS. The diff viewer shows a change to an LFS file as
the file itself, not as the pointer.

## Patches and bundles: moving work without a server

A patch file holds commits as text, the way `git format-patch` writes them.
Right click a commit and choose **Save as patch**, or select several commits
first. To apply a patch, choose **Apply a patch file…** in the command palette.

| Kind of patch | What applying it does |
|---|---|
| Written by `git format-patch` or Gitkeen | Adds its commits on top of the current branch, with their authors and messages. |
| A plain diff | Changes the files. The change then waits in the commit panel. |

Gitkeen checks the patch first. If it does not fit, nothing changes.

A bundle is one file that holds branches and tags, for moving a repository to
a place without a server. **Export a bundle** in the command palette saves
every branch and tag. **Import a bundle…** brings one in under a name you
choose, so its branches arrive as `name/branch`, like the branches of a
remote. None of your own branches move.
