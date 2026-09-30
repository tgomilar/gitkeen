/**
 * Autocomplete for the console: from what is typed up to the cursor, the
 * command, option or value that can come next, with the values taken from
 * the open repository (its branches, files, commits, tags, remotes and
 * stashes).
 */
import { COMMANDS, COMMAND_BY_NAME, type ValueKind } from './spec';

export interface Suggestion {
  /** What replaces the word being typed. */
  value: string;
  /** What the list shows, when it differs from the value. */
  label?: string;
  /** A short description beside it. */
  detail?: string;
  kind: 'command' | 'subcommand' | 'flag' | ValueKind;
}

export interface CompletionContext {
  branches: string[];
  remoteBranches: string[];
  tags: string[];
  remotes: string[];
  stashes: { ref: string; message: string }[];
  commits: { shortHash: string; subject: string }[];
  changed: string[];
  staged: string[];
  currentBranch: string | null;
}

export interface Completion {
  /** Where in the line the word being completed starts. */
  from: number;
  items: Suggestion[];
}

/** Words so far, and the one under the cursor, split on spaces outside quotes. */
function words(text: string): { done: string[]; partial: string; partialStart: number } {
  const done: string[] = [];
  let current = '', start = 0, quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === quote) quote = null; else current += c; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === ' ') { if (current) done.push(current); current = ''; start = i + 1; continue; }
    current += c;
  }
  return { done, partial: current, partialStart: start };
}

function match(items: Suggestion[], partial: string, limit = 40): Suggestion[] {
  const q = partial.toLowerCase();
  const starts = items.filter((i) => i.value.toLowerCase().startsWith(q));
  const contains = q ? items.filter((i) => !i.value.toLowerCase().startsWith(q) && (i.value.toLowerCase().includes(q) || i.detail?.toLowerCase().includes(q))) : [];
  return [...starts, ...contains].slice(0, limit);
}

function valuesOf(kind: ValueKind | 'text' | undefined, ctx: CompletionContext): Suggestion[] {
  const v = (value: string, k: ValueKind, detail?: string, label?: string): Suggestion => ({ value, kind: k, detail, label });
  switch (kind) {
    case 'branch':
      return ctx.branches.map((b) => v(b, 'branch', b === ctx.currentBranch ? 'current branch' : 'branch'));
    case 'ref':
      return [
        ...ctx.branches.map((b) => v(b, 'branch', b === ctx.currentBranch ? 'current branch' : 'branch')),
        ...ctx.remoteBranches.map((b) => v(b, 'ref', 'remote branch')),
        ...ctx.tags.map((t) => v(t, 'tag', 'tag')),
        ...ctx.commits.slice(0, 30).map((c) => v(c.shortHash, 'commit', c.subject))
      ];
    case 'commit':
      return [
        v('HEAD', 'commit', 'the commit you are on'), v('HEAD~1', 'commit', 'the one before'),
        ...ctx.commits.map((c) => v(c.shortHash, 'commit', c.subject)),
        ...ctx.branches.map((b) => v(b, 'branch', 'branch')),
        ...ctx.tags.map((t) => v(t, 'tag', 'tag'))
      ];
    case 'changed':
    case 'file':
      return ctx.changed.map((f) => v(f, 'changed', 'changed'));
    case 'staged':
      return ctx.staged.map((f) => v(f, 'staged', 'staged'));
    case 'remote':
      return ctx.remotes.map((r) => v(r, 'remote', 'remote'));
    case 'tag':
      return ctx.tags.map((t) => v(t, 'tag', 'tag'));
    case 'stash':
      return ctx.stashes.map((s) => v(s.ref, 'stash', s.message));
    default:
      return [];
  }
}

export function complete(line: string, cursor: number, ctx: CompletionContext): Completion {
  const before = line.slice(0, cursor);
  const { done: all, partial, partialStart } = words(before);
  const done = all[0] === 'git' ? all.slice(1) : all;

  // The command itself.
  if (done.length === 0) {
    if (partial === 'git') return { from: partialStart, items: [] };
    return {
      from: partialStart,
      items: match(COMMANDS.map((c) => ({ value: c.name, detail: c.about, kind: 'command' as const })), partial)
    };
  }

  const spec = COMMAND_BY_NAME.get(done[0]);
  if (!spec) return { from: partialStart, items: [] };
  const rest = done.slice(1);

  // A subcommand, for stash, remote and worktree.
  const sub = spec.subcommands?.find((s) => s.name === rest[0]);
  if (spec.subcommands && rest.length === 0 && !partial.startsWith('-')) {
    return { from: partialStart, items: match(spec.subcommands.map((s) => ({ value: s.name, detail: s.about, kind: 'subcommand' as const })), partial) };
  }

  // An option.
  const pastDashes = rest.includes('--');
  if (partial.startsWith('-') && !pastDashes) {
    const used = new Set(rest);
    return { from: partialStart, items: match(spec.flags.filter((fl) => !used.has(fl.flag)).map((fl) => ({ value: fl.flag, detail: fl.about, kind: 'flag' as const })), partial) };
  }

  // The value an option takes: `-m "…"`, `-b name`, `--source commit`.
  const flag = spec.flags.find((fl) => fl.flag === rest[rest.length - 1]);
  if (flag?.takes) {
    return { from: partialStart, items: flag.takes === 'text' ? [] : match(valuesOf(flag.takes, ctx), partial) };
  }

  // A positional value, by where it stands among the others.
  if (pastDashes) return { from: partialStart, items: match(valuesOf('changed', ctx), partial) };
  const args = sub ? sub.args ?? [] : spec.args;
  let index = 0;
  for (let i = sub ? 1 : 0; i < rest.length; i++) {
    const word = rest[i];
    if (word.startsWith('-')) {
      if (spec.flags.find((fl) => fl.flag === word)?.takes) i++;
      continue;
    }
    index++;
  }
  let kind = args.length ? args[Math.min(index, args.length - 1)] : undefined;
  // Unstaging picks from what is staged.
  if (spec.name === 'restore' && (rest.includes('--staged') || rest.includes('-S'))) kind = 'staged';
  let items = valuesOf(kind, ctx);
  // Nobody switches to, or merges, the branch they are already on.
  if ((spec.name === 'switch' || spec.name === 'merge') && ctx.currentBranch) items = items.filter((i) => i.value !== ctx.currentBranch);
  return { from: partialStart, items: match(items, partial) };
}
