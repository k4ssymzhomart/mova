// Longest-prefix route matching for navigation highlighting. Pure and dependency-free, so the rail, the
// mobile tab bar and the unit test all share one implementation. A child route highlights its parent:
// /app/session/<id>/calibrate belongs to /app, /program/<id> belongs to /program.

export interface MatchableItem {
  href: string;
  /** Active-state prefix; defaults to href. */
  match?: string;
}

export function activeHref(pathname: string, items: readonly MatchableItem[]): string | null {
  let best: string | null = null;
  let bestLen = -1;
  for (const it of items) {
    const m = it.match ?? it.href;
    if ((pathname === m || pathname.startsWith(`${m}/`)) && m.length > bestLen) {
      best = it.href;
      bestLen = m.length;
    }
  }
  return best;
}
