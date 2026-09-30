/**
 * The colour palette: which well-known editor theme Gitkeen's colours follow.
 *
 * The palette and light or dark are chosen apart, so every palette comes in
 * both. The colours themselves live in theme.css (the default) and
 * palettes.css; this only sets `data-palette` on the page and remembers it.
 */
export interface Palette {
  id: string;
  name: string;
  /** What the palette's light and dark themes are called where they come from. */
  light: string;
  dark: string;
}

export const PALETTES: Palette[] = [
  { id: 'vscode', name: 'VS Code', light: 'Light Modern', dark: 'Dark Modern' },
  { id: 'github', name: 'GitHub', light: 'GitHub Light', dark: 'GitHub Dark' },
  { id: 'one', name: 'One', light: 'One Light', dark: 'One Dark' },
  { id: 'solarized', name: 'Solarized', light: 'Solarized Light', dark: 'Solarized Dark' },
  { id: 'dracula', name: 'Dracula', light: 'Alucard', dark: 'Dracula' }
];

const KEY = 'gitkeen.palette';
const SIZE_KEY = 'gitkeen.text-size';

/**
 * Text sizes, as a scale of the whole interface. Rows, spacing and text grow
 * together, the way an editor's zoom works, so nothing larger is clipped by
 * a row that stayed the same height.
 */
export const TEXT_SIZES = [
  { scale: 0.85, name: 'Smallest' },
  { scale: 0.9, name: 'Smaller' },
  { scale: 1, name: 'Default' },
  { scale: 1.1, name: 'Larger' },
  { scale: 1.25, name: 'Large' },
  { scale: 1.4, name: 'Largest' }
];

function storedSize(): number {
  try {
    const value = Number(localStorage.getItem(SIZE_KEY));
    return TEXT_SIZES.some((t) => t.scale === value) ? value : 1;
  } catch {
    return 1;
  }
}

function stored(): string {
  try {
    const id = localStorage.getItem(KEY);
    return PALETTES.some((p) => p.id === id) ? (id as string) : 'vscode';
  } catch {
    return 'vscode';
  }
}

class AppearanceStore {
  palette = $state(stored());
  textSize = $state(storedSize());

  current = $derived(PALETTES.find((p) => p.id === this.palette) ?? PALETTES[0]);

  constructor() {
    this.apply();
    this.applySize();
  }

  setTextSize(scale: number) {
    if (!TEXT_SIZES.some((t) => t.scale === scale)) return;
    this.textSize = scale;
    try { localStorage.setItem(SIZE_KEY, String(scale)); } catch { /* lasts this session */ }
    this.applySize();
  }

  /** One step larger or smaller, as ⌘+ and ⌘− do. */
  stepTextSize(delta: 1 | -1) {
    const i = TEXT_SIZES.findIndex((t) => t.scale === this.textSize);
    const next = TEXT_SIZES[Math.min(TEXT_SIZES.length - 1, Math.max(0, i + delta))];
    if (next) this.setTextSize(next.scale);
  }

  private applySize() {
    const root = document.documentElement;
    if (this.textSize === 1) root.style.removeProperty('zoom');
    else root.style.setProperty('zoom', String(this.textSize));
  }

  setPalette(id: string) {
    if (!PALETTES.some((p) => p.id === id)) return;
    this.palette = id;
    try { localStorage.setItem(KEY, id); } catch { /* private mode: it lasts this session */ }
    this.apply();
  }

  /** VS Code is the default in theme.css, so it needs no attribute. */
  private apply() {
    const root = document.documentElement;
    if (this.palette === 'vscode') delete root.dataset.palette;
    else root.dataset.palette = this.palette;
  }
}

export const appearance = new AppearanceStore();

/**
 * How much the interface is scaled right now. Mouse positions and measured
 * boxes are in screen pixels, while a scaled page lays itself out in its own
 * pixels, so anything placed at the mouse divides by this first.
 */
export function uiScale(): number {
  return appearance.textSize || 1;
}
