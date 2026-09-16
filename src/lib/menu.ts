export interface MenuItem {
  label?: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  action?: () => void;
}

export const SEPARATOR: MenuItem = { separator: true };
