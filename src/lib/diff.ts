/**
 * Turning a parsed diff into something a person can read quickly.
 *
 * Two jobs. One: pair deleted lines with added lines so a side-by-side view
 * puts a change and its replacement on the same row. Two: find which words
 * inside a changed line actually differ, so the eye lands on the edit instead
 * of scanning a line that is mostly unchanged.
 */
import type { DiffHunk, DiffLine } from './git/types';

/** One row of the side-by-side view. Either side can be missing. */
export interface DiffRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

/**
 * Pair a hunk's lines into rows.
 *
 * Deletions and additions arrive as two runs, one after the other. Lining up
 * the first deletion with the first addition is what makes an edited line read
 * as one change rather than two unrelated ones.
 */
export function pairLines(hunk: DiffHunk): DiffRow[] {
  const rows: DiffRow[] = [];
  const lines = hunk.lines;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.kind === 'context') {
      rows.push({ left: line, right: line });
      i++;
      continue;
    }

    // Take the whole run of deletions, then the whole run of additions that
    // follows it. Together they are one edit.
    const deletions: DiffLine[] = [];
    while (i < lines.length && lines[i].kind === 'del') deletions.push(lines[i++]);
    const additions: DiffLine[] = [];
    while (i < lines.length && lines[i].kind === 'add') additions.push(lines[i++]);

    const height = Math.max(deletions.length, additions.length);
    for (let n = 0; n < height; n++) {
      rows.push({ left: deletions[n] ?? null, right: additions[n] ?? null });
    }
  }

  return rows;
}

/** A stretch of a line, marked as changed or not. */
export interface Segment {
  text: string;
  changed: boolean;
}

/**
 * Split a line into words, keeping the separators.
 *
 * Whitespace and punctuation become their own tokens, so `foo(bar)` and
 * `foo(baz)` differ in one token rather than in the whole line.
 */
function tokenize(text: string): string[] {
  return text.match(/[A-Za-z0-9_$]+|\s+|[^A-Za-z0-9_$\s]/g) ?? [];
}

/** Length of the longest common subsequence table, walked back into a path. */
function commonSubsequence(a: string[], b: string[]): boolean[][] {
  // rows of (a.length + 1) x (b.length + 1)
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const keptA = new Array(a.length).fill(false);
  const keptB = new Array(b.length).fill(false);
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      keptA[i++] = true;
      keptB[j++] = true;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return [keptA, keptB];
}

/**
 * The cost of the table above grows with the product of the two token counts,
 * so very long lines are left unmarked rather than allowed to stall the page.
 */
const MAX_TOKENS = 600;

/**
 * Work out which parts of a removed line and its replacement differ.
 *
 * Returns the segments for each side. When the two lines have almost nothing
 * in common, marking every word would be noise, so the whole line is marked
 * instead and the reader treats it as a rewrite.
 */
export function wordDiff(before: string, after: string): { left: Segment[]; right: Segment[] } {
  const a = tokenize(before);
  const b = tokenize(after);

  if (a.length === 0 || b.length === 0 || a.length * b.length > MAX_TOKENS * MAX_TOKENS) {
    return { left: [{ text: before, changed: true }], right: [{ text: after, changed: true }] };
  }

  const [keptA, keptB] = commonSubsequence(a, b);

  const shared = keptA.reduce((n, kept, i) => (kept ? n + a[i].trim().length : n), 0);
  const total = Math.max(
    a.reduce((n, t) => n + t.trim().length, 0),
    b.reduce((n, t) => n + t.trim().length, 0)
  );
  // Below a quarter in common the two lines are different lines, not an edit.
  if (total > 0 && shared / total < 0.25) {
    return { left: [{ text: before, changed: true }], right: [{ text: after, changed: true }] };
  }

  return { left: toSegments(a, keptA), right: toSegments(b, keptB) };
}

/** Join neighbouring tokens that share a state, so the markup stays small. */
function toSegments(tokens: string[], kept: boolean[]): Segment[] {
  const segments: Segment[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const changed = !kept[i];
    const last = segments[segments.length - 1];
    if (last && last.changed === changed) last.text += tokens[i];
    else segments.push({ text: tokens[i], changed });
  }
  return segments;
}

/**
 * Segments for one row, computed only where they help.
 *
 * A row with a line on each side is an edit, and marking the changed words is
 * worth it. A row with one side is a plain insertion or removal, where the
 * whole line is the change and marking anything would be noise.
 */
export function rowSegments(row: DiffRow): { left: Segment[] | null; right: Segment[] | null } {
  if (row.left && row.right && row.left.kind === 'del' && row.right.kind === 'add') {
    const { left, right } = wordDiff(row.left.text, row.right.text);
    return { left, right };
  }
  return { left: null, right: null };
}

/**
 * Changed words for every line of a hunk, in the order the unified view draws
 * them. Index `n` holds the segments for `hunk.lines[n]`, or null where
 * marking words would not help.
 *
 * The pairing is the same as the side-by-side view uses: the first deleted
 * line of a run belongs with the first added line that follows it. Only the
 * layout differs, so the marks must not.
 */
export function unifiedSegments(hunk: DiffHunk): (Segment[] | null)[] {
  const marks: (Segment[] | null)[] = new Array(hunk.lines.length).fill(null);
  const lines = hunk.lines;
  let i = 0;

  while (i < lines.length) {
    if (lines[i].kind === 'context') { i++; continue; }

    const deletions: number[] = [];
    while (i < lines.length && lines[i].kind === 'del') deletions.push(i++);
    const additions: number[] = [];
    while (i < lines.length && lines[i].kind === 'add') additions.push(i++);

    const paired = Math.min(deletions.length, additions.length);
    for (let n = 0; n < paired; n++) {
      const { left, right } = wordDiff(lines[deletions[n]].text, lines[additions[n]].text);
      marks[deletions[n]] = left;
      marks[additions[n]] = right;
    }
  }

  return marks;
}

/**
 * Cut a diff down to the first `limit` lines, splitting a hunk if the limit
 * falls inside one. Returns how many lines were left out, so the viewer can
 * offer to draw them.
 */
export function limitHunks(hunks: DiffHunk[], limit: number): { hunks: DiffHunk[]; hidden: number } {
  const total = hunks.reduce((n, h) => n + h.lines.length, 0);
  if (total <= limit) return { hunks, hidden: 0 };

  const kept: DiffHunk[] = [];
  let budget = limit;
  for (const hunk of hunks) {
    if (budget <= 0) break;
    if (hunk.lines.length <= budget) {
      kept.push(hunk);
      budget -= hunk.lines.length;
    } else {
      kept.push({ ...hunk, lines: hunk.lines.slice(0, budget) });
      budget = 0;
    }
  }
  return { hunks: kept, hidden: total - limit };
}

/** Total changed lines, used for the "N of M" counter in the header. */
export function countChanges(hunks: DiffHunk[]): number {
  return hunks.reduce((n, h) => n + h.lines.filter((l) => l.kind !== 'context').length, 0);
}
