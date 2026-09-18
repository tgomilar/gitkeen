import type { IconName } from './components/Icon.svelte';

export interface MenuItem {
  label?: string;
  hint?: string;
  /**
   * The glyph shown before the label. Optional: an item without one still
   * lines up with the rest, because the column is reserved either way.
   */
  icon?: IconName;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  action?: () => void;
}

export const SEPARATOR: MenuItem = { separator: true };
