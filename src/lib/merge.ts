/**
 * Turning the merge editor's choices back into a file.
 *
 * The editor never handles whole files by value: sections were cut from the
 * original bytes and are joined back, so nothing that sits outside a conflict
 * can be altered by accident, and a region left unchosen keeps Git's markers
 * rather than guessing.
 */
import type { ConflictChoice, MergeConflictSection, MergeSection, MergeTextSection } from './git/types';

/** How a piece of text is drawn: how many lines, and a trimmed sample. */
export interface TextPreview {
  total: number;
  first: string[];
  trailing: string[];
  /** The lines hidden between the previews, when the region is long. */
  hidden: number;
}

/**
 * The preview the editor shows for a text region.
 *
 * A conflict's surroundings matter for orientation, but a 4000-line region is
 * not worth drawing twice. Show the first and last few lines.
 */
export function previewText(lines: string[], window = 4): TextPreview {
  const text = lines.map((l) => l.replace(/\n$/, ''));
  const total = text.length;
  if (total <= window * 2) return { total, first: text, trailing: [], hidden: 0 };
  return {
    total,
    first: text.slice(0, window),
    trailing: text.slice(-window),
    hidden: total - window * 2
  };
}

/**
 * The text a choice puts in place of one conflict block.
 *
 * "Both" is ours followed by theirs. When ours is the end of a file with no
 * final newline, a newline is added between the two, so the last line of
 * ours and the first line of theirs do not run together.
 */
export function choiceText(section: MergeConflictSection, choice: ConflictChoice): string {
  const ours = section.ours.join('');
  const theirs = section.theirs.join('');
  if (choice === 'ours') return ours;
  if (choice === 'theirs') return theirs;
  const joint = ours && theirs && !ours.endsWith('\n') ? '\n' : '';
  return ours + joint + theirs;
}

/**
 * Assemble a resolved file from the sections and one choice per conflict.
 *
 * Text the user typed for a block (`edits`) wins over the choice it started
 * from. A block with neither falls back to its original lines, markers
 * included: the server's marker check then refuses to stage it, which is the
 * guard against committing a half-resolution.
 */
export function mergeResult(
  sections: MergeSection[],
  choices: Record<number, ConflictChoice>,
  edits: Record<number, string> = {}
): string {
  return sections
    .map((section, i) => {
      if (section.type === 'text') return section.lines.join('');
      if (edits[i] !== undefined) return edits[i];
      const pick = choices[i];
      return pick ? choiceText(section, pick) : section.lines.join('');
    })
    .join('');
}

/** A text section hanging alone with no damage done to the lines. */
export function asText(section: MergeTextSection): string {
  return section.lines.join('');
}