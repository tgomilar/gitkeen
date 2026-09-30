/**
 * Syntax colouring for the diff and blame views.
 *
 * Lines are coloured as a block: the whole file for blame, and each side of
 * a hunk for a diff. A comment or a string that runs over several lines then
 * keeps its colour on all of them. A hunk can start part way into a block
 * comment; `*/` turning up before any `/*` gives that away, and the block is
 * read as if the comment had been opened above it.
 *
 * The colours are theme tokens (`--syn-*` in theme.css and palettes.css), so
 * every palette colours code its own way.
 */
import Prism from 'prismjs';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-kotlin';
import 'prismjs/components/prism-swift';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-ruby';
import 'prismjs/components/prism-markup-templating';
import 'prismjs/components/prism-php';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-scss';
import 'prismjs/components/prism-docker';

/** The colour classes a piece of code can have. Anything else is plain text. */
export type SyntaxClass =
  | 'keyword' | 'string' | 'comment' | 'number' | 'function' | 'type'
  | 'variable' | 'constant' | 'tag' | 'attr' | 'regex';

const BY_EXTENSION: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  json: 'json', jsonc: 'json',
  html: 'markup', htm: 'markup', xml: 'markup', svg: 'markup', plist: 'markup', xhtml: 'markup',
  css: 'css', scss: 'scss',
  py: 'python', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin', kts: 'kotlin', swift: 'swift',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp',
  rb: 'ruby', php: 'php',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  yml: 'yaml', yaml: 'yaml', toml: 'toml', sql: 'sql', md: 'markdown', markdown: 'markdown',
  // A component file mixes markup and script; see `languageForLine`.
  svelte: 'component', vue: 'component'
};

const BY_NAME: Record<string, string> = { dockerfile: 'docker', makefile: 'bash' };

/** The language to colour a file as, or null to leave it plain. */
export function languageFor(path: string): string | null {
  const name = path.split('/').pop()?.toLowerCase() ?? '';
  if (BY_NAME[name]) return BY_NAME[name];
  const ext = /\.([a-z0-9]+)$/.exec(name)?.[1];
  return (ext && BY_EXTENSION[ext]) || null;
}

/**
 * A Svelte or Vue file holds both markup and script. Line by line, a line that
 * starts with a tag is read as markup and anything else as TypeScript.
 */
function languageForLine(lang: string, text: string): string {
  if (lang !== 'component') return lang;
  return /^\s*<\/?[A-Za-z!]/.test(text) ? 'markup' : 'typescript';
}

const CLASS_OF: Record<string, SyntaxClass> = {
  keyword: 'keyword', 'control-flow': 'keyword', atrule: 'keyword', important: 'keyword',
  string: 'string', 'template-string': 'string', char: 'string', 'attr-value': 'string', url: 'string',
  comment: 'comment', prolog: 'comment', doctype: 'comment', cdata: 'comment',
  number: 'number', boolean: 'number', unit: 'number', hexcode: 'number',
  function: 'function', 'function-variable': 'function', method: 'function',
  'class-name': 'type', builtin: 'type', namespace: 'type', 'maybe-class-name': 'type',
  variable: 'variable', parameter: 'variable', property: 'variable', key: 'variable',
  constant: 'constant', symbol: 'constant', entity: 'constant',
  tag: 'tag', selector: 'tag',
  'attr-name': 'attr',
  regex: 'regex'
};

export interface SyntaxPiece {
  text: string;
  cls: SyntaxClass | null;
}

/** Walk Prism's token tree into flat pieces, the innermost known class winning. */
function flatten(stream: (string | Prism.Token)[], inherited: SyntaxClass | null, out: SyntaxPiece[]) {
  for (const token of stream) {
    if (typeof token === 'string') {
      if (token) out.push({ text: token, cls: inherited });
      continue;
    }
    const own = CLASS_OF[token.type] ?? (token.alias ? CLASS_OF[[token.alias].flat()[0] as string] : undefined);
    // `${...}` inside a template string is code again, not string.
    const cls = token.type === 'interpolation' ? null : own ?? inherited;
    if (typeof token.content === 'string') out.push({ text: token.content, cls });
    else flatten(Array.isArray(token.content) ? token.content : [token.content], cls, out);
  }
}

const cache = new Map<string, SyntaxPiece[]>();
const CACHE_LIMIT = 5000;

/** One line of code, cut into pieces that each have one colour. */
export function highlightLine(text: string, lang: string | null): SyntaxPiece[] {
  if (!lang || !text) return [{ text, cls: null }];
  const key = `${lang}\u0000${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const grammar = Prism.languages[languageForLine(lang, text)];
  let pieces: SyntaxPiece[] = [{ text, cls: null }];
  if (grammar) {
    pieces = [];
    flatten(Prism.tokenize(text, grammar), null, pieces);
  }
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, pieces);
  return pieces;
}

const C_LIKE = new Set([
  'javascript', 'typescript', 'jsx', 'tsx', 'component', 'css', 'scss', 'java', 'kotlin',
  'swift', 'c', 'cpp', 'csharp', 'go', 'rust', 'php'
]);

/**
 * Colour lines that belong together, then cut the result back into lines.
 *
 * A component file is coloured line by line instead, because it switches
 * between markup and script and no one grammar reads both.
 */
export function highlightBlock(lines: string[], lang: string | null): SyntaxPiece[][] {
  if (!lang || lines.length === 0) return lines.map((text) => [{ text, cls: null }]);
  if (lang === 'component') return lines.map((text) => highlightLine(text, lang));
  const grammar = Prism.languages[lang];
  if (!grammar) return lines.map((text) => [{ text, cls: null }]);

  let text = lines.join('\n');
  // Started inside a block comment: open it first, and drop what was added.
  let lead = '';
  if (C_LIKE.has(lang)) {
    const close = text.indexOf('*/'), open = text.indexOf('/*');
    if (close !== -1 && (open === -1 || close < open)) lead = '/*';
  }
  const pieces: SyntaxPiece[] = [];
  flatten(Prism.tokenize(lead + text, grammar), null, pieces);
  if (lead) {
    let drop = lead.length;
    while (drop > 0 && pieces.length) {
      const first = pieces[0];
      if (first.text.length <= drop) { drop -= first.text.length; pieces.shift(); }
      else { pieces[0] = { ...first, text: first.text.slice(drop) }; drop = 0; }
    }
  }

  const out: SyntaxPiece[][] = [[]];
  for (const piece of pieces) {
    const parts = piece.text.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) out.push([]);
      if (part) out[out.length - 1].push({ text: part, cls: piece.cls });
    });
  }
  while (out.length < lines.length) out.push([]);
  return out.map((line, i) => (line.length ? line : [{ text: lines[i], cls: null }]));
}

/** A piece of a diff line: its colour, and whether the word changed. */
export interface PaintedPiece extends SyntaxPiece {
  changed: boolean;
}

/**
 * Lay the colours over a line's changed-word marks.
 *
 * Both cut the same text, at different places. Walking them together gives
 * pieces that each have one colour and one changed state, so a changed word
 * keeps its syntax colour and gets its highlight too.
 */
export function paint(
  text: string,
  colours: SyntaxPiece[],
  segments: { text: string; changed: boolean }[] | null
): PaintedPiece[] {
  const marks = segments && segments.length ? segments : [{ text, changed: false }];
  const out: PaintedPiece[] = [];
  let ci = 0, co = 0, mi = 0, mo = 0;
  while (ci < colours.length && mi < marks.length) {
    const colour = colours[ci], mark = marks[mi];
    const take = Math.min(colour.text.length - co, mark.text.length - mo);
    if (take > 0) {
      const piece = colour.text.slice(co, co + take);
      const last = out[out.length - 1];
      if (last && last.cls === colour.cls && last.changed === mark.changed) last.text += piece;
      else out.push({ text: piece, cls: colour.cls, changed: mark.changed });
    }
    co += take; mo += take;
    if (co >= colour.text.length) { ci++; co = 0; }
    if (mo >= mark.text.length) { mi++; mo = 0; }
  }
  return out;
}
