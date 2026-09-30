/**
 * The smart console: Git commands typed by hand, with autocomplete, a preview
 * of what a risky one will do, and results drawn rather than printed.
 */
import { repoStore } from './repo.svelte';
import { rebaseStore } from './rebase.svelte';
import { diffStore } from './diff.svelte';
import { describe } from './repo.svelte';
import { onEcho } from '../console/echo';
import type { ConsoleRedirect, ConsoleResult } from '../git/types';

export interface ConsoleEntry {
  id: number;
  line: string;
  state: 'running' | 'confirm' | 'done' | 'failed' | 'refused' | 'cancelled' | 'note';
  result: ConsoleResult | null;
  /** Set for a note about a button elsewhere in Gitalia, not a typed command. */
  note?: string;
  at: number;
}

const OPEN_KEY = 'gitalia.console.open';
const HEIGHT_KEY = 'gitalia.console.height';
const HISTORY_LIMIT = 200;
let nextId = 1;

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

const ENTRY_LIMIT = 300;

class ConsoleStore {
  open = $state(readStored(OPEN_KEY, false));
  height = $state(readStored(HEIGHT_KEY, 280));
  entries = $state<ConsoleEntry[]>([]);
  /** Commands typed in this repository, oldest first. */
  history = $state<string[]>([]);
  private historyFor: string | null = null;

  constructor() {
    // What the buttons do, as the Git command that does the same.
    onEcho((text, command) => this.note(text, command));
  }

  toggle() {
    this.setOpen(!this.open);
  }

  setOpen(open: boolean) {
    this.open = open;
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(open)); } catch { /* per session only */ }
  }

  setHeight(height: number) {
    this.height = Math.round(Math.min(window.innerHeight * 0.8, Math.max(140, height)));
    try { localStorage.setItem(HEIGHT_KEY, JSON.stringify(this.height)); } catch { /* per session only */ }
  }

  /** History belongs to a repository: load it when another one opens. */
  syncRepo(root: string | null) {
    if (root === this.historyFor) return;
    this.historyFor = root;
    this.entries = [];
    this.history = root ? readStored<string[]>(`gitalia.console.history:${root}`, []) : [];
  }

  private remember(line: string) {
    const next = this.history.filter((h) => h !== line);
    next.push(line);
    this.history = next.slice(-HISTORY_LIMIT);
    if (this.historyFor) {
      try { localStorage.setItem(`gitalia.console.history:${this.historyFor}`, JSON.stringify(this.history)); } catch { /* per session only */ }
    }
  }

  clear() {
    this.entries = [];
  }

  /** A line in the scrollback about something done with a button, and the command it matches. */
  note(text: string, command: string) {
    this.add({ id: nextId++, line: command, state: 'note', result: null, note: text, at: Date.now() });
  }

  /** The scrollback keeps the latest entries only, so a long session stays quick. */
  private add(entry: ConsoleEntry) {
    this.entries = [...this.entries, entry].slice(-ENTRY_LIMIT);
  }

  private update(id: number, patch: Partial<ConsoleEntry>) {
    this.entries = this.entries.map((e) => (e.id === id ? { ...e, ...patch } : e));
  }

  /** Run a typed command. A risky one stops at a question; see `confirm`. */
  async run(line: string) {
    const repo = repoStore.repo;
    const text = line.trim();
    if (!repo || !text) return;
    if (text === 'clear' || text === 'cls') { this.clear(); return; }
    this.remember(text);
    const id = nextId++;
    this.add({ id, line: text, state: 'running', result: null, at: Date.now() });
    await this.send(id, text, false);
  }

  async confirm(id: number) {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry || entry.state !== 'confirm') return;
    this.update(id, { state: 'running' });
    await this.send(id, entry.line, true);
  }

  cancel(id: number) {
    this.update(id, { state: 'cancelled' });
  }

  private async send(id: number, line: string, confirmed: boolean) {
    const repo = repoStore.repo;
    if (!repo) return;
    let result: ConsoleResult;
    try {
      result = await repo.consoleRun(line, confirmed);
    } catch (err) {
      result = { ok: false, error: describe(err) };
    }
    if (result.needsConfirm) {
      this.update(id, { state: 'confirm', result });
      return;
    }
    if (result.redirect) {
      this.update(id, { state: 'refused', result });
      this.follow(result.redirect);
      return;
    }
    this.update(id, { state: result.ok ? 'done' : result.error ? 'refused' : 'failed', result });
    if (result.changed) await repoStore.refresh();
  }

  /**
   * The oldest commit `git rebase -i <base>` would let you edit. Git names
   * the commit before them; the rebase editor starts from the first one, so
   * this walks HEAD's first parents back to the one just after `base`.
   */
  private rebaseStart(base: string | null): string | null {
    const byHash = new Map(repoStore.commits.map((c) => [c.hash, c]));
    const head = repoStore.head?.oid;
    if (!head) return repoStore.cursor;
    const line: string[] = [];
    for (let at = byHash.get(head); at && line.length < 5000; at = byHash.get(at.parents[0])) line.push(at.hash);
    const back = base ? /^HEAD~(\d+)$/.exec(base) : null;
    if (back) return line[Math.max(0, Number(back[1]) - 1)] ?? null;
    const target = base && repoStore.commits.find((c) => c.hash.startsWith(base) || c.refs.some((r) => r.name === base));
    if (!target) return repoStore.cursor;
    const at = line.indexOf(target.hash);
    return at > 0 ? line[at - 1] : null;
  }

  /** Open the Gitalia editor that does what the command would have waited for. */
  follow(redirect: ConsoleRedirect) {
    if (redirect.to === 'rebase') {
      const from = this.rebaseStart(redirect.base);
      if (from) rebaseStore.show(from);
    } else if (redirect.to === 'hunks' && redirect.file) {
      diffStore.show({ file: redirect.file, source: 'Working tree', side: 'unstaged', stageable: true });
    } else if (redirect.to === 'commit') {
      window.dispatchEvent(new CustomEvent('gitalia:focus-commit'));
    }
  }
}

export const consoleStore = new ConsoleStore();
