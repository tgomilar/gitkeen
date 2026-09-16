/** Recently opened repositories, kept in the browser for now. */
const KEY = 'gitalia.recent-repositories';
const LIMIT = 12;

export interface RecentRepo {
  root: string;
  name: string;
  openedAt: number;
}

export function readRecent(): RecentRepo[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function rememberRepo(root: string, name: string): RecentRepo[] {
  const next = [{ root, name, openedAt: Date.now() }, ...readRecent().filter((r) => r.root !== root)]
    .slice(0, LIMIT);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode, or storage disabled: recents are a convenience, not state */
  }
  return next;
}

export function forgetRepo(root: string): RecentRepo[] {
  const next = readRecent().filter((r) => r.root !== root);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch { /* ignore */ }
  return next;
}
