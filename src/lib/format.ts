const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Short relative time, as in the plan's mockups: "2 hours ago". */
export function relativeTime(ms: number, now = Date.now()): string {
  const diff = now - ms;
  if (diff < 45_000) return 'just now';
  if (diff < HOUR) {
    const n = Math.round(diff / MINUTE);
    return `${n} minute${n === 1 ? '' : 's'} ago`;
  }
  if (diff < DAY) {
    const n = Math.round(diff / HOUR);
    return `${n} hour${n === 1 ? '' : 's'} ago`;
  }
  if (diff < 30 * DAY) {
    const n = Math.round(diff / DAY);
    return `${n} day${n === 1 ? '' : 's'} ago`;
  }
  return new Date(ms).toLocaleDateString(undefined, {
    day: 'numeric', month: 'short',
    year: new Date(ms).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric'
  });
}

export function absoluteTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

/** Compact column form: "14 Mar" or "14 Mar 2024". */
export function columnDate(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  if (now - ms < DAY) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: sameYear ? undefined : '2-digit'
  });
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Stable, low-saturation colour per author for the avatar chip. */
export function authorColor(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = (hash * 31 + email.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(hash) % 360} 42% 45%)`;
}

export function pluralize(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}
