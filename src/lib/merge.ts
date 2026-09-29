/**
 * Turning the merge editor's choices back into a file.
 *
 * The editor never handles whole files by value: sections were cut from the
 * original bytes and are joined back, so nothing that sits outside a conflict
 * can be altered by accident, and a region left unchosen keeps Git's markers
 * rather than guessing.
 */
import type { ConflictChoice, MergeSection, MergeTextSection } from './git/types';

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
 * Assemble a resolved file from the sections and one choice per conflict.
 *
 * A block with no choice falls back to its original lines, markers included:
 * the server's marker check then refuses to stage it, which is the guard
 * against committing a half-resolution.
 */
export function mergeResult(sections: MergeSection[], choices: Record<number, ConflictChoice>): string {
  return sections
    .map((section, i) => {
      if (section.type === 'text') return section.lines.join('');
      const pick = choices[i];
      if (pick === 'ours') return section.ours.join('');
      if (pick === 'theirs') return section.theirs.join('');
      return section.lines.join('');
    })
    .join('');
}

/** A text section hanging alone with no damage done to the lines. */
export function asText(section: MergeTextSection): string {
  return section.lines.join('');
}