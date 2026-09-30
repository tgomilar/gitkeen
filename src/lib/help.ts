/**
 * What the Help panel says: one short entry per thing a person wants to do,
 * grouped by the task rather than by the screen it happens on.
 *
 * Each entry is two sentences at most. The docs pages hold the detail, so an
 * entry says what the feature is for, where it lives and how to reach it, and
 * stops there.
 */
import type { DockPanel } from './components/ToolRail.svelte';

/**
 * A shortcut, written with `mod` for Command on a Mac and Control elsewhere,
 * and `+` between keys: 'mod+shift+P'. Several ways to press the same thing go
 * in an array.
 */
export type Keys = string;

/** Where Show me takes you. */
export type HelpTarget =
  | { panel: DockPanel }
  | { open: 'palette' | 'search' | 'console' | 'settings' };

export interface HelpEntry {
  title: string;
  text: string;
  /** Where to find it, when that is not obvious from the text. */
  where?: string;
  keys?: Keys[];
  /** The Git command it matches, for people who know Git from the terminal. */
  git?: string;
  show?: HelpTarget;
  /** Extra words to find it by. */
  also?: string;
}

export interface HelpGroup {
  title: string;
  entries: HelpEntry[];
}

export const HELP: HelpGroup[] = [
  {
    title: 'Get around',
    entries: [
      {
        title: 'Command palette',
        text: 'Every command in Gitkeen, in one searchable list. Type a few letters and press Enter.',
        keys: ['mod+shift+P'],
        show: { open: 'palette' },
        also: 'commands run anything'
      },
      {
        title: 'Search the history',
        text: 'Find commits by message, hash, author:, path:, since: or until:.',
        keys: ['mod+K'],
        git: 'git log --grep',
        show: { open: 'search' },
        also: 'find filter'
      },
      {
        title: 'Side panels',
        text: 'Choose a panel in the rail on the left to open it. Choose it again to close it and give the graph the full width.',
        also: 'rail dock sidebar'
      },
      {
        title: 'Move through commits',
        text: 'Click a commit, or press G and use the arrow keys. Shift-click adds a range and mod-click adds single commits, so you can act on several at once.',
        keys: ['G'],
        also: 'select selection cursor keyboard'
      },
      {
        title: 'Everything you can do with a commit',
        text: 'Right click a commit, or press Enter, for its menu: branch, tag, cherry-pick, revert, squash, rebase and more.',
        keys: ['Enter'],
        also: 'context menu right click'
      },
      {
        title: 'Read the repository again',
        text: 'Gitkeen does not watch the folder. Refresh after you change files in your editor.',
        keys: ['mod+R'],
        also: 'refresh reload'
      }
    ]
  },
  {
    title: 'Commit your work',
    entries: [
      {
        title: 'The commit panel',
        text: 'Tick the files you want and write a message. A tick is a real stage: it runs git add.',
        keys: ['mod+shift+K'],
        git: 'git add, git commit',
        show: { panel: 'commit' },
        also: 'stage staging index'
      },
      {
        title: 'Stage single lines',
        text: 'Double click a file to open its diff. Tick hunks, or click a line number to leave that line out, then press Stage selected.',
        keys: ['S'],
        git: 'git add -p',
        also: 'hunk partial diff viewer'
      },
      {
        title: 'Commit',
        text: 'Commits exactly what is staged. Tick Amend to replace the last commit instead.',
        keys: ['mod+Enter'],
        git: 'git commit, git commit --amend',
        also: 'amend'
      },
      {
        title: 'Commit message rules',
        text: 'Gitkeen reads the repository\'s commitlint rules and names each broken rule as you type. Commit stays off until the message follows them.',
        where: 'Under the message box',
        also: 'lint commitlint conventional'
      },
      {
        title: 'Suggest a message',
        text: 'Writes a subject for the ticked files with an AI model, following the rules. Connect a model in Settings.',
        where: 'Commit panel, Suggest',
        show: { open: 'settings' },
        also: 'ai model anthropic openai ollama lm studio'
      },
      {
        title: 'Stash',
        text: 'Sets the ticked files aside without committing them. Take them back from Stashes at the bottom of the commit panel, all of them or only the files you tick.',
        git: 'git stash push, git stash pop',
        show: { panel: 'commit' },
        also: 'shelve set aside'
      }
    ]
  },
  {
    title: 'Change history',
    entries: [
      {
        title: 'Squash',
        text: 'Select commits next to each other, right click and choose Squash commits. You edit the combined message first.',
        also: 'combine join fixup'
      },
      {
        title: 'Rebase editor',
        text: 'Right click a commit and choose Rebase from here. Drag commits into order and pick, reword, edit, squash, fixup or drop each one.',
        git: 'git rebase -i',
        also: 'interactive reorder reword drop'
      },
      {
        title: 'Move or drop one commit',
        text: 'Move up, Move down and Drop commit in the commit menu change one thing without opening the editor.',
        also: 'reorder remove delete'
      },
      {
        title: 'Cherry-pick and revert',
        text: 'Cherry-pick copies commits onto this branch. Revert adds a commit that undoes one, and R reverts the selection.',
        keys: ['R'],
        git: 'git cherry-pick, git revert',
        also: 'copy undo'
      },
      {
        title: 'Reset',
        text: 'Moves the branch to another commit: soft, mixed or hard. The dialog says what each mode keeps.',
        git: 'git reset',
        also: 'hard soft mixed'
      }
    ]
  },
  {
    title: 'Branches and sharing',
    entries: [
      {
        title: 'Switch branch',
        text: 'Double click a branch in the Branches panel, or press mod+B and choose one.',
        keys: ['mod+B'],
        git: 'git switch',
        show: { panel: 'branches' },
        also: 'checkout'
      },
      {
        title: 'New branch',
        text: 'Creates a branch at the selected commit.',
        keys: ['mod+shift+B'],
        git: 'git switch -c',
        also: 'create'
      },
      {
        title: 'Fetch, pull and push',
        text: 'Pull always merges and shows what is coming first. Force push names what it would remove, and refuses if the remote changed unseen.',
        keys: ['mod+shift+F', 'mod+shift+L', 'mod+shift+U'],
        git: 'git fetch, git pull --no-rebase, git push',
        also: 'remote upload download force'
      },
      {
        title: 'Merge',
        text: 'Right click a branch and choose Merge into. Gitkeen shows which files would conflict before anything changes.',
        git: 'git merge',
        show: { panel: 'branches' }
      },
      {
        title: 'Resolve a conflict',
        text: 'Press Resolve in the status bar. Keep ours, theirs or both for each block, then Mark resolved and Continue.',
        where: 'Status bar',
        git: 'git mergetool',
        also: 'merge editor conflicts ours theirs'
      }
    ]
  },
  {
    title: 'Find things',
    entries: [
      {
        title: 'Blame',
        text: 'Shows the commit that last changed each line. Before this follows a line back in time.',
        where: 'Diff viewer, Blame',
        git: 'git blame',
        also: 'annotate who'
      },
      {
        title: 'Bisect',
        text: 'Finds the commit that broke something. Right click a good commit, choose Bisect from here, then answer Good or Bad.',
        git: 'git bisect',
        also: 'bug regression'
      },
      {
        title: 'Compare',
        text: 'Right click a branch and choose Compare with, or select two commits and choose Compare these two.',
        git: 'git diff a...b',
        also: 'difference branches'
      },
      {
        title: 'Stats',
        text: 'A report on the history: who committed, how much, and when.',
        show: { panel: 'stats' },
        also: 'statistics contributors report'
      }
    ]
  },
  {
    title: 'Stay safe',
    entries: [
      {
        title: 'Undo',
        text: 'Before Gitkeen rewrites or deletes anything, it saves where things were. Restore puts them back.',
        show: { panel: 'undo' },
        also: 'restore recovery reflog'
      },
      {
        title: 'Know before you act',
        text: 'Every risky operation says what it will change first. Nothing runs until you confirm.',
        also: 'safety warning confirm'
      }
    ]
  },
  {
    title: 'The console',
    entries: [
      {
        title: 'Type Git commands',
        text: 'Commands with suggestions from your repository. Results are drawn as pictures, and risky commands ask first.',
        keys: ['ctrl+`'],
        show: { open: 'console' },
        also: 'terminal command line'
      },
      {
        title: 'In the console',
        text: 'Tab takes a suggestion. Up and Down bring back earlier commands. mod+L clears the console.',
        keys: ['Tab', 'Up', 'mod+L']
      }
    ]
  },
  {
    title: 'Look and feel',
    entries: [
      {
        title: 'Theme and palette',
        text: 'Light or dark, in five colour palettes. Choose them from ◐ at the right of the title bar.',
        also: 'dark light colours vs code github solarized dracula one'
      },
      {
        title: 'Text size',
        text: 'Makes the text larger or smaller, or returns it to the default.',
        keys: ['mod+=', 'mod+-', 'mod+0'],
        also: 'zoom font'
      }
    ]
  }
];

export const DOCS_URL = 'https://github.com/tgomilar/gitkeen/tree/main/docs';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const NAMES: Record<string, [mac: string, other: string]> = {
  mod: ['⌘', 'Ctrl'],
  shift: ['⇧', 'Shift'],
  ctrl: ['⌃', 'Ctrl'],
  alt: ['⌥', 'Alt'],
  enter: ['↩', 'Enter'],
  up: ['↑', '↑'],
  down: ['↓', '↓'],
  '=': ['+', '+'],
  '-': ['−', '−']
};

/** The keys of a shortcut as they should be printed on this computer. */
export function keyCaps(keys: Keys): string[] {
  return keys.split('+').map((k) => NAMES[k.toLowerCase()]?.[IS_MAC ? 0 : 1] ?? k);
}

/** `mod` in running text, as this computer calls it: mod+B, mod-click. */
export function withMod(text: string): string {
  return text.replace(/\bmod\+/g, IS_MAC ? '⌘' : 'Ctrl+').replace(/\bmod\b/g, IS_MAC ? '⌘' : 'Ctrl');
}

/** Entries matching every word of the query, in their groups. */
export function searchHelp(query: string): HelpGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return HELP;
  return HELP.map((group) => ({
    ...group,
    entries: group.entries.filter((e) => {
      const hay = `${group.title} ${e.title} ${e.text} ${e.where ?? ''} ${e.git ?? ''} ${e.also ?? ''}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
  })).filter((group) => group.entries.length > 0);
}
