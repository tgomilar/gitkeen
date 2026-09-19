# Standalone Git Management App --- Project Plan

## 1. Project Vision

Build a **standalone desktop Git client** focused on the Git experience
developers love in IntelliJ IDEA, without being an IDE.

The application should make advanced Git operations visual, fast,
understandable, and safe.

### Core positioning

> **IntelliJ-quality Git workflow for developers using VS Code, Cursor,
> Zed, Neovim, or any other editor.**

The app is not intended to replace an editor. It is a dedicated Git
workspace.

------------------------------------------------------------------------

## 2. Problem

Many developers use lightweight editors but miss the excellent Git
workflow provided by IntelliJ:

-   Visual commit graph
-   Easy branch switching
-   Cherry-picking
-   Interactive rebase
-   Squashing
-   Commit manipulation
-   Excellent diffs
-   Staging individual files or hunks
-   Clear Git operation feedback
-   Easy conflict handling

Existing Git clients often provide many of these features, but the
opportunity is to create a **focused, modern, developer-first Git
application** with an especially strong graph and history workflow.

------------------------------------------------------------------------

## 3. Product Principles

### 3.1 Git first

The app should not become another IDE.

No code editor, build system, terminal replacement, or
project-management features in the core product.

### 3.2 Visualize dangerous operations

Operations such as reset, rebase, squash, and force push should clearly
communicate what will happen before executing.

### 3.3 Keyboard-first

Experienced developers should be able to perform common operations
without touching the mouse.

### 3.4 Fast

Opening a repository and browsing history should feel immediate, even
for large repositories.

### 3.5 Native Git compatibility

Use the real Git implementation rather than reimplementing Git
semantics.

### 3.6 Framework independent

The application should work with repositories regardless of the editor
or framework used.

------------------------------------------------------------------------

# 4. Target Users

## Primary

Developers who:

-   Use VS Code, Cursor, Zed, Neovim, etc.
-   Know Git reasonably well
-   Prefer visual Git workflows
-   Miss IntelliJ's Git tooling
-   Work with feature branches and pull requests
-   Frequently rebase, squash, cherry-pick, and inspect history

## Secondary

Developers who:

-   Find Git CLI intimidating
-   Want a safer UI for history rewriting
-   Need to understand complicated branch graphs
-   Work across multiple repositories

------------------------------------------------------------------------

# 5. MVP

The MVP should focus on one core workflow:

> **Open repository → understand history → manipulate branches/commits →
> inspect changes.**

## Repository

-   Open local repository
-   Recent repositories
-   Detect Git repository
-   Repository information
-   Refresh repository state
-   Support multiple repositories

## Git Graph

The graph is the main product surface.

Display:

-   Commits
-   Branches
-   Remote branches
-   Tags
-   HEAD
-   Merge commits
-   Author
-   Date
-   Commit message
-   Short hash

Interactions:

-   Select commit
-   Multi-select commits
-   Right-click context menu
-   Checkout branch
-   Create branch
-   Cherry-pick
-   Revert
-   Reset
-   Rebase
-   Squash

## Branch management

-   Switch branch
-   Create branch
-   Delete branch
-   Rename branch
-   Create branch from commit
-   Track remote branch
-   Push branch
-   Pull branch
-   Fetch

## Commit management

-   Commit
-   Amend
-   Cherry-pick
-   Revert
-   Reset
-   Copy commit hash
-   Open commit details

## Changes

-   Working tree changes
-   Staged changes
-   Unstaged changes
-   File status
-   Stage file
-   Unstage file
-   Stage hunk
-   Unstage hunk
-   Discard changes
-   Diff viewer

## Remote operations

-   Fetch
-   Pull
-   Push
-   Push new branch
-   Force push with safety confirmation

------------------------------------------------------------------------

# 6. Phase 2 --- Advanced Git

After the MVP is stable, add the features that make the application
genuinely compelling.

## Interactive rebase

Visual replacement for:

``` bash
git rebase -i HEAD~N
```

UI:

``` text
☰  pick     Add animation
☰  squash   Fix animation
☰  squash   Fix Safari
☰  reword   Improve documentation
☰  drop     Temporary debug code
```

Support:

-   Reorder
-   Squash
-   Fixup
-   Reword
-   Edit
-   Drop
-   Continue
-   Abort

Allow drag-and-drop reordering.

## Squash

Example:

``` text
● Add feature
● Fix feature
● Fix tests
● Fix typo
```

Select commits and choose:

> Squash 4 commits

Show the resulting commit message before execution.

## Conflict resolution

Provide a visual three-way merge interface:

``` text
        OURS
          │
    ┌─────┴─────┐
    │  RESULT   │
    └─────┬─────┘
          │
        THEIRS
```

Support:

-   Rebase conflicts
-   Merge conflicts
-   Cherry-pick conflicts
-   Continue operation
-   Abort operation
-   Mark resolved

## Stash

-   Create stash
-   Apply stash
-   Pop stash
-   Drop stash
-   View stash diff

## Statistics

A report on the repository's own activity, for a developer or a project lead
rather than for an analyst. It answers who is working here, how much, on what,
and when. It is read-only: it runs `git log` and counts.

Report contents:

-   Headline totals --- commits, contributors, lines added and removed, files
    touched, active days, and the age of the last commit
-   Commits over time, bucketed by day, or by month once the history passes
    120 days
-   Per-contributor totals --- commits, share, lines, files, active days, and
    when each person was last seen
-   Activity by hour of the day and by day of the week, for the whole
    repository or for one contributor
-   Most changed files, with how many people have touched each
-   Lines by file type
-   The most recent commits in the period

Filters:

-   Period --- all time, last 7 / 30 / 90 days, last 12 months
-   One branch, or every branch
-   Merge commits in or out (out by default)
-   Generated files in or out (out by default)

Export: the contributor table as CSV.

### Decisions this feature rests on

**One pass, one question.** Everything in a report comes from a single
`git log --numstat` run. Aggregating several runs would let the headline
numbers and the per-contributor numbers drift apart whenever a commit landed
between them, and a report that contradicts itself is worse than no report.

**Commit dates throughout.** `--since` and `--until` filter on the commit
date, so the report counts by the commit date too. Author date and commit date
diverge as soon as a commit is rebased; filtering by one and counting by the
other would put commits in a report that fall outside its stated period.

**Generated files are excluded by default.** Lockfiles, bundles and vendored
trees are written by tools. Counted, they make whoever last ran an install the
largest contributor in the report.

**Merge commits are excluded by default.** An included merge is counted as a
commit and contributes no lines. `--numstat` prints no file rows for a merge
unless given `-m`, which counts the same lines once per parent, or
`--first-parent`, which stops the walk following side branches and so drops
both commits and contributors. Losing people when a filter is switched on is
the worse failure, so the merge is counted as what it is: a commit carrying no
changes of its own.

**Identity is the email address.** Git offers nothing better. One person with
two addresses is two rows, and the report does not pretend otherwise. Where one
address carries several spellings of a name, they are listed, so the ambiguity
is at least visible.

**A commit cap, admitted openly.** A report reads at most 20000 commits and
says when the cap bit, rather than quietly under-reporting.

------------------------------------------------------------------------

# 7. Phase 3 --- Power Features

-   Git worktrees
-   Submodules
-   Git LFS
-   Tags
-   Signed commits
-   GPG/SSH signing
-   Commit search
-   Author filtering
-   Date filtering
-   Path filtering
-   Branch comparison
-   Compare commits
-   Compare branches
-   Blame view
-   Bisect workflow
-   Patch generation
-   Apply patch
-   Bundle support

------------------------------------------------------------------------

# 8. GitHub / GitLab Integration

Do not make integrations a dependency of the core application.

Optional integrations:

### GitHub

-   Pull requests
-   PR status
-   PR branches
-   Open PR in browser
-   Checkout PR
-   Create PR
-   View checks

### GitLab

Equivalent workflow where practical.

The local Git workflow must remain fully functional without an account.

------------------------------------------------------------------------

# 9. AI Features

AI should be an enhancement, not the product identity.

Potential features:

### Explain commit

> Explain what this commit changed.

### Explain branch history

> Why did this branch diverge from main?

### Explain conflict

> Explain why these two changes conflict.

### Commit message

Generate a commit message from staged changes.

### Git operation explanation

Before a dangerous operation:

> This will rewrite the last 5 commits on `feature/login`.

AI can provide an explanation in plain language.

------------------------------------------------------------------------

# 10. Technology Stack

## Recommended

### Frontend

-   Svelte 5
-   TypeScript
-   CSS / design system
-   Vite

### Desktop

-   Tauri
-   Rust

### Git

Initially use the installed Git executable.

Architecture:

``` text
┌────────────────────────────────────┐
│            Svelte UI               │
│                                    │
│ Graph │ Branches │ Changes │ Diff  │
└─────────────────┬──────────────────┘
                  │
                Tauri
                  │
┌─────────────────▼──────────────────┐
│             Rust                   │
│                                    │
│ Repository service                 │
│ Git process manager                │
│ Filesystem access                  │
│ Event / state handling             │
└─────────────────┬──────────────────┘
                  │
                  ▼
              Git CLI
                  │
                  ▼
             .git repository
```

------------------------------------------------------------------------

# 11. Git Abstraction Layer

Do not call Git directly from UI components.

Create a dedicated Git service.

Example conceptual API:

``` ts
interface GitRepository {
  status(): Promise<GitStatus>;
  log(options?: LogOptions): Promise<Commit[]>;
  branches(): Promise<Branch[]>;
  switchBranch(name: string): Promise<void>;
  createBranch(name: string, from?: string): Promise<void>;
  cherryPick(commit: string): Promise<void>;
  revert(commit: string): Promise<void>;
  reset(commit: string, mode: ResetMode): Promise<void>;
  rebase(options: RebaseOptions): Promise<void>;
  commit(message: string): Promise<void>;
  push(): Promise<void>;
  pull(): Promise<void>;
  fetch(): Promise<void>;
}
```

The UI should know nothing about command-line syntax.

------------------------------------------------------------------------

# 12. State Management

Centralize repository state.

Important state:

``` text
Repository
├── currentBranch
├── HEAD
├── branches
├── remoteBranches
├── tags
├── commits
├── workingTree
├── stagedFiles
├── conflicts
├── operationState
└── remotes
```

Git operations can change several parts of state, so after operations
the application should refresh affected state rather than relying on
optimistic assumptions.

------------------------------------------------------------------------

# 13. Git Graph

The Git graph is one of the technically important parts of the project.

Requirements:

-   Handle merge commits
-   Multiple branches
-   Branch crossings
-   Tags
-   HEAD
-   Large histories
-   Virtualized rendering
-   Smooth scrolling
-   Stable graph lanes
-   Commit selection
-   Multi-selection
-   Context menus

The graph should remain usable with repositories containing tens or
hundreds of thousands of commits.

### Possible implementation

Build a graph layout engine that transforms Git's commit DAG into visual
lanes:

``` text
Commit DAG
    ↓
Graph layout algorithm
    ↓
Lane assignment
    ↓
Rendered graph
```

Do not tie the graph model directly to the DOM.

------------------------------------------------------------------------

# 14. Diff Viewer

The diff viewer should eventually support:

-   Side-by-side diff
-   Unified diff
-   Syntax highlighting
-   Line selection
-   Hunk selection
-   Stage hunk
-   Stage selected lines
-   Unstage hunk
-   Word-level diff
-   Binary file indication
-   Image diff where practical

Partial staging is especially valuable because it is one of the
strongest workflows in professional Git tools.

------------------------------------------------------------------------

# 15. UX / Visual Direction

The application should feel closer to a professional developer tool than
a consumer Git application.

Desired characteristics:

-   Dense but readable
-   Excellent keyboard navigation
-   Minimal visual noise
-   Dark and light themes
-   Familiar Git terminology
-   Strong visual hierarchy
-   Fast context menus
-   Command palette
-   Clear operation feedback

Avoid excessive animations.

The interface should prioritize information density and speed.

------------------------------------------------------------------------

# 16. Main Layout

Recommended initial layout:

``` text
┌───────────────────────────────────────────────────────────────┐
│ Repository     Branch ▾        Fetch   Pull   Push    Search │
├───────────────┬───────────────────────────────────────────────┤
│               │                                               │
│ BRANCHES      │                 GIT GRAPH                     │
│               │                                               │
│ Local         │   ●────●────●────● main                     │
│   main        │        \                                      │
│   develop     │         ●────●──── feature/login             │
│               │              \                                │
│ Remote        │               ●────● feature/ui               │
│   origin/main │                                               │
│               │                                               │
├───────────────┴───────────────────────────────────────────────┤
│ Commit details                                                │
│                                                               │
│ Fix authentication bug                                       │
│ a84d1c2 · Tanja · 2 hours ago                                │
│                                                               │
├───────────────────────────────────────────────────────────────┤
│ Changes / Diff                                                │
└───────────────────────────────────────────────────────────────┘
```

------------------------------------------------------------------------

# 17. Keyboard Shortcuts

Design shortcuts early.

Potential examples:

  Action                 Shortcut
  ---------------------- ----------------------
  Search commits         Cmd/Ctrl + K
  Refresh                Cmd/Ctrl + R
  Commit                 Cmd/Ctrl + Enter
  Push                   Cmd/Ctrl + Shift + P
  Fetch                  Cmd/Ctrl + Shift + F
  Switch branch          Cmd/Ctrl + B
  Create branch          Cmd/Ctrl + Shift + B
  Open command palette   Cmd/Ctrl + Shift + P
  Focus graph            G
  Stage selected         S
  Revert                 R

Exact shortcuts should be configurable because OS/editor conventions
differ.

------------------------------------------------------------------------

# 18. Safety Model

Git history rewriting can destroy work.

The application should actively protect users.

Before:

-   Hard reset
-   Force push
-   Drop commits
-   Rebase
-   Squash published commits

Show:

``` text
⚠ This operation rewrites history.

Branch:
feature/login

Commits affected:
5

Remote:
origin/feature/login

Continue?
```

Where possible:

-   Detect whether commits exist on a remote
-   Detect dirty working tree
-   Prevent obviously unsafe operations
-   Provide Abort
-   Provide recovery information
-   Keep an operation log

A future feature could create lightweight recovery references before
destructive operations.

------------------------------------------------------------------------

# 19. Performance Requirements

Target:

-   Repository open: \< 2 seconds for normal repositories
-   Initial graph rendering: immediate partial rendering
-   Large history: virtualized
-   Git operations: asynchronous
-   UI never blocks during Git operations

Large repositories must not require loading the entire history into the
DOM.

------------------------------------------------------------------------

# 20. Cross-Platform

Initial target:

1.  macOS
2.  Windows
3.  Linux

Use platform-specific Git discovery where necessary.

Potential Git locations:

``` text
macOS/Linux:
git

Windows:
git.exe
```

Eventually detect:

-   Git installation
-   Git version
-   Git config
-   credential helpers
-   SSH configuration

------------------------------------------------------------------------

# 21. MVP Roadmap

## Week 1 --- Foundation

-   Tauri setup
-   Svelte application
-   Rust ↔ frontend communication
-   Git process execution
-   Repository discovery
-   Basic repository state

## Week 2 --- Git history

-   `git log`
-   Commit model
-   Branch model
-   Graph data structure
-   Initial graph renderer
-   Commit selection

## Week 3 --- Core workflow

-   Branch switching
-   Create/delete branch
-   Commit
-   Stage/unstage
-   Working tree changes
-   Basic diff

## Week 4 --- Git operations

-   Cherry-pick
-   Revert
-   Reset
-   Merge
-   Push
-   Pull
-   Fetch

## Week 5 --- Polish

-   Context menus
-   Command palette
-   Keyboard shortcuts
-   Loading states
-   Error handling
-   Confirmation dialogs
-   Dark/light themes

## Week 6 --- Beta

-   Large repository testing
-   Cross-platform testing
-   Git edge cases
-   Performance
-   Crash/error reporting
-   Packaging
-   Auto-update strategy

The six-week timeline is an MVP target, not a promise. Advanced conflict
handling and interactive rebase should come after the core workflow is
reliable.

------------------------------------------------------------------------

# 22. First Version Scope

The first public version should intentionally NOT include:

-   Code editor
-   AI coding assistant
-   Full GitHub client
-   Issue tracker
-   Project management
-   CI/CD dashboard
-   Docker
-   Terminal replacement
-   Extensive plugin system

Focus on one thing:

> **Best standalone visual Git workflow.**

------------------------------------------------------------------------

# 23. Competitive Positioning

The application should not simply compete on number of Git features.

Position around:

### IntelliJ-style workflow

Familiar to developers coming from JetBrains.

### Editor independent

Works alongside:

-   VS Code
-   Cursor
-   Zed
-   Neovim
-   Sublime
-   WebStorm
-   IntelliJ
-   Any other editor

### Visual history manipulation

Make:

-   Rebase
-   Squash
-   Cherry-pick
-   Reset
-   Revert

feel understandable.

### Lightweight

No IDE overhead.

------------------------------------------------------------------------

# 24. Potential Product Names

Working-name directions:

-   GitFlow
-   GitDesk
-   GitView
-   GitGraph
-   GitPilot
-   GitSpace
-   GitStudio
-   GitWorkbench
-   GitForge
-   Branch
-   Commit
-   GitDock

The name should be checked for domain, GitHub organization, package, and
trademark availability before adoption.

------------------------------------------------------------------------

# 25. Business Model

Potential model:

### Free

-   Local repositories
-   Core Git operations
-   Graph
-   Diff
-   Branch management

### Pro

Potentially:

-   Advanced history tools
-   Multiple repository workspaces
-   GitHub/GitLab integrations
-   AI features
-   Advanced conflict resolution
-   Worktrees
-   Team features

However, validate willingness to pay before building a large paid
feature set.

A free core Git client could also be useful for adoption.

------------------------------------------------------------------------

# 26. Validation Before Heavy Development

Before spending months on the application:

1.  Create a clickable UI prototype.
2.  Show the Git graph and commit interaction.
3.  Ask developers who use IntelliJ what they would miss most.
4.  Specifically test:
    -   Squash
    -   Rebase
    -   Cherry-pick
    -   Branch switching
    -   Staging
    -   Diff
5.  Build the smallest functional prototype.
6.  Release it to 10--20 developers.
7.  Observe which features they actually use.

The most important validation question is:

> **Would a developer keep this open next to their editor every day?**

------------------------------------------------------------------------

# 27. Killer MVP Workflow

The strongest initial workflow should be:

``` text
Open repository
      ↓
See complete Git graph
      ↓
Select commits
      ↓
Perform operation
      ↓
Preview consequences
      ↓
Execute
      ↓
Graph updates immediately
```

For example:

``` text
● Add authentication
● Fix authentication
● Fix tests
● Update documentation
```

Select three:

**Squash**

↓

``` text
● Add authentication
● Improve authentication implementation
```

This should feel dramatically easier than using:

``` bash
git rebase -i HEAD~4
```

------------------------------------------------------------------------

# 28. Success Criteria

The MVP is successful if developers say:

> "I would rather use this for Git than my IDE."

Measure:

-   Weekly active users
-   Repositories opened
-   Git operations performed
-   Daily sessions
-   Squash/rebase usage
-   Cherry-pick usage
-   Returning users
-   Crash rate
-   Average repository size
-   Time spent in app

The strongest signal is **repeat usage**, not downloads.

------------------------------------------------------------------------

# 29. Long-Term Vision

The long-term product could become a dedicated **Git workspace** rather
than just a Git GUI.

``` text
                    Git Workspace
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
      History           Changes          Branches
        │                 │                 │
      Graph              Diff             Rebase
        │                 │                 │
        └─────────────────┼─────────────────┘
                          │
                   Remote providers
                          │
                 GitHub / GitLab
                          │
                         AI
```

The core principle remains:

> **Your editor writes code. This app manages your history.**

------------------------------------------------------------------------

# 30. Recommended Next Step

Do **not** start by implementing every Git command.

Start with a prototype of the most compelling experience:

### Prototype 1

**Repository → Git graph → commit selection → context menu → branch
switching**

### Prototype 2

Add:

**Cherry-pick → Revert → Reset**

### Prototype 3

Add:

**Interactive rebase → Squash → Reorder → Drop**

If those interactions feel excellent, continue building the product.

The Git command execution is relatively straightforward. The real
product value is the **interaction model around the Git DAG**.

------------------------------------------------------------------------

## Initial Technical Backlog

### P0 --- Must have

-   [ ] Tauri project --- still a Vite dev server; the RPC seam is in place
-   [x] Svelte + TypeScript
-   [x] Git process runner
-   [x] Open repository
-   [x] Repository status
-   [x] Git log parser
-   [x] Branch parser
-   [x] Git graph
-   [x] Commit selection
-   [x] Branch switching
-   [x] Create branch
-   [x] Commit
-   [x] Stage / unstage --- by ticking files, IntelliJ style
-   [x] Diff
-   [~] Push / pull / fetch --- push, force push and fetch done; pull missing
-   [x] Cherry-pick
-   [x] Revert
-   [x] Reset

### P1 --- Important

-   [ ] Interactive rebase
-   [x] Squash
-   [ ] Reorder
-   [x] Stash --- as the Shelf
-   [ ] Merge
-   [x] Conflict detection --- detected and marked resolved; no editor yet
-   [ ] Partial staging --- whole files only, no hunk staging
-   [ ] Tags --- shown in the graph, but cannot be created or deleted
-   [ ] Command palette
-   [x] Keyboard shortcuts
-   [ ] Large repository optimization
-   [x] Statistics report

### P2 --- Later

-   [ ] Conflict resolution editor
-   [ ] Worktrees
-   [ ] GitHub integration
-   [ ] GitLab integration
-   [x] AI assistance --- commit subjects, with a suggested split when the
    change holds unrelated work. Anthropic, OpenAI, LM Studio or Ollama.
-   [ ] Git LFS
-   [ ] Submodules
-   [ ] Blame
-   [ ] Bisect
-   [ ] Advanced analytics

Key: `[x]` done, `[~]` partly done, `[ ]` not started.

------------------------------------------------------------------------

# Final Product Definition

**A standalone, cross-platform Git application that gives developers the
visual Git history and advanced commit-management workflow of IntelliJ
IDEA without requiring them to use IntelliJ as their IDE.**

The product should win through:

**excellent Git graph + excellent commit manipulation + excellent
diff/staging UX + safety + speed.**
