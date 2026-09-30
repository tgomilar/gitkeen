/**
 * The colour palette: which well-known editor theme Gitalia's colours follow.
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

const KEY = 'gitalia.palette';

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

  current = $derived(PALETTES.find((p) => p.id === this.palette) ?? PALETTES[0]);

  constructor() {
    this.apply();
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
