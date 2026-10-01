# GitHub and AI help

## GitHub

When a repository has a remote on github.com, **GitHub** appears in the rail.
Gitkeen needs a token to reach GitHub. It looks for one in this order:

1. `GITHUB_TOKEN` in the environment.
2. A token saved in **Settings**, under GitHub.
3. The sign-in of the GitHub CLI, if you ran `gh auth login`.

A fine-grained token needs access to the repository, **Pull requests** (read
and write), and **Commit statuses** and **Actions** (read). The token stays in
Gitkeen's backend. The page in the browser only learns whether there is one.

| Where | What it shows or does |
|---|---|
| GitHub panel | The pull requests (open, closed or all), each with its branches, author, age and checks. Click one to open it on GitHub. |
| GitHub panel, **New pull request for …** | Opens a pull request from the current branch into the default branch. The title and description start from the branch's commits, and it can be a draft. |
| Branches panel | A dot next to each branch that is on GitHub: green when its checks passed, red when one failed, and amber while they run. |
| Commit details | Each check of the selected commit, with a link to it. |

Push the branch, with every commit, before you open a pull request for it.
GitHub makes the pull request from what it has.

## AI help

Gitkeen can ask an AI model for help. Add an Anthropic or OpenAI key in
**Settings** (the sparkle button in the title bar), or use a model that runs on
your own computer in LM Studio or Ollama. A local model sends nothing off your
computer. When no model is set up, none of these buttons appear.

When more than one is set up, the one marked **In use** answers. Press **Use
this** on another to switch. Gitkeen remembers the choice. If the chosen one
stops running or loses its key, the next one that works is used instead.

| Where | What it does |
|---|---|
| Commit panel, the sparkle button | Writes a commit subject from the staged change, following the repository's commit rules. |
| Commit details, **Explain this commit** | Says what the commit changed and why it probably matters. |
| Merge editor, **Explain this conflict** | Says what each side tried to do, and what a good resolution keeps. |
| Compare view, **Explain how they differ** | Says what each branch did after the two split. |
| A warning dialog, **Explain in plain words** | Says what the operation will do, what could be lost, and how to undo it. |
| Console, **Explain this error** | Says why a command failed. |

Each explanation names the model that wrote it. It can be wrong, so read it as
a second opinion. Asking for one never changes the repository.

Keys are stored in `~/.config/gitkeen/config.json`, readable only by you, and
never sent to the browser. A key in the environment (`ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`) is used before a saved one.
