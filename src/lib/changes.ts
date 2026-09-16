/**
 * Turning `git status` rows into the two lists the commit panel shows.
 *
 * IntelliJ IDEA splits the working tree in two: "Changes", meaning files Git
 * already tracks, and "Unversioned Files", meaning files it has never seen.
 * The split matters because the second group is unticked by default, so a
 * stray build artefact never rides along in a commit.
 */
import type { StatusFile } from './git/types';
import type { IconName } from './components/Icon.svelte';

export type ChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'conflict' | 'unversioned';

export interface Change {
  file: StatusFile;
  /** Full path from the repository root. The identity of the row. */
  path: string;
  /** Last segment, shown as the row's name. */
  name: string;
  /** Everything before the name, shown dimmed beside it. Empty at the root. */
  dir: string;
  kind: ChangeKind;
  /** True when Git's index already holds part of this change. */
  staged: boolean;
}

/**
 * Which of the six states a row is in.
 *
 * porcelain v2 gives two letters: the index against HEAD, then the working
 * tree against the index. A file can be both, so the more structural change
 * wins, which is what IntelliJ shows too: a deleted-then-edited file reads
 * as deleted, not as modified.
 */
export function changeKind(file: StatusFile): ChangeKind {
  if (file.state === 'untracked') return 'unversioned';
  if (file.state === 'conflicted') return 'conflict';
  if (file.state === 'renamed') return 'renamed';
  const letters = `${file.index}${file.worktree}`;
  if (letters.includes('D')) return 'deleted';
  if (letters.includes('A')) return 'added';
  return 'modified';
}

export const KIND_LABEL: Record<ChangeKind, string> = {
  modified: 'Modified',
  added: 'Added',
  deleted: 'Deleted',
  renamed: 'Renamed',
  conflict: 'Merge conflict',
  unversioned: 'Not under version control'
};

export function toChange(file: StatusFile): Change {
  const cut = file.path.lastIndexOf('/');
  return {
    file,
    path: file.path,
    name: cut === -1 ? file.path : file.path.slice(cut + 1),
    dir: cut === -1 ? '' : file.path.slice(0, cut),
    kind: changeKind(file),
    staged: file.state !== 'untracked' && file.index !== '.' && file.index !== '?'
  };
}

/** Tooltip text: the whole story of one row in a sentence. */
export function describeChange(change: Change): string {
  const parts = [`${KIND_LABEL[change.kind]}: ${change.path}`];
  if (change.file.origPath) parts.push(`was ${change.file.origPath}`);
  if (change.staged) parts.push('part of this change is already staged');
  return parts.join('\n');
}

const MARKUP = new Set(['xml', 'html', 'htm', 'svg', 'svelte', 'vue', 'xhtml', 'plist']);
const CODE = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'css', 'scss', 'less',
  'py', 'rs', 'go', 'java', 'kt', 'kts', 'rb', 'php', 'c', 'h', 'cpp', 'hpp',
  'cs', 'swift', 'sh', 'zsh', 'bash', 'sql', 'yml', 'yaml', 'toml', 'gradle', 'iml'
]);
const DOC = new Set(['md', 'markdown', 'txt', 'rst', 'adoc', 'pdf', 'rtf', 'csv']);
const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'avif']);

/** A glyph per file kind, so the list can be scanned before it is read. */
export function fileIcon(name: string): IconName {
  const dot = name.lastIndexOf('.');
  // A name that is all extension, like `.gitignore`, is configuration.
  const ext = dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
  if (MARKUP.has(ext)) return 'markup';
  if (CODE.has(ext)) return 'code';
  if (DOC.has(ext)) return 'doc';
  if (IMAGE.has(ext)) return 'image';
  return 'file';
}

export interface ChangeNode {
  /** Segment shown in the row. */
  name: string;
  /** Full path from the root, the stable key for expand state. */
  path: string;
  children: ChangeNode[];
  change?: Change;
}

function insert(root: ChangeNode, change: Change) {
  const segments = change.path.split('/');
  let node = root;
  for (let i = 0; i < segments.length; i++) {
    const leaf = i === segments.length - 1;
    const path = segments.slice(0, i + 1).join('/');
    let child = node.children.find((c) => c.name === segments[i] && (leaf ? !!c.change : !c.change));
    if (!child) {
      child = { name: segments[i], path, children: [] };
      node.children.push(child);
    }
    if (leaf) child.change = change;
    node = child;
  }
}

function sort(node: ChangeNode) {
  node.children.sort((a, b) => {
    const aFolder = !a.change;
    const bFolder = !b.change;
    if (aFolder !== bFolder) return aFolder ? -1 : 1; // folders first
    return a.name.localeCompare(b.name);
  });
  node.children.forEach(sort);
}

/**
 * Collapse a run of folders that hold nothing but each other, so a change
 * deep in `src/lib/components` costs one row rather than three.
 */
function flattenSingles(node: ChangeNode) {
  node.children = node.children.map((child) => {
    flattenSingles(child);
    if (!child.change && child.children.length === 1 && !child.children[0].change) {
      const only = child.children[0];
      return { ...only, name: `${child.name}/${only.name}` };
    }
    return child;
  });
}

/** Nest changes under their directories, the way IntelliJ groups by folder. */
export function buildChangeTree(changes: Change[]): ChangeNode[] {
  const root: ChangeNode = { name: '', path: '', children: [] };
  for (const change of changes) insert(root, change);
  sort(root);
  flattenSingles(root);
  return root.children;
}

/** Every change under a node, so a folder row can be ticked as a whole. */
export function changesUnder(node: ChangeNode): Change[] {
  const found = node.change ? [node.change] : [];
  for (const child of node.children) found.push(...changesUnder(child));
  return found;
}
