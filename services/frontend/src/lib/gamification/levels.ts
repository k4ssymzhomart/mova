// Level curve. XP totals follow a gentle triangular ramp — reaching level L needs 50·L·(L−1)
// cumulative XP (L1=0, L2=100, L3=300, L4=600, L5=1000…). Levels are derived from the append-only
// xp_ledger, so this lives in one place and both the Achievements page and the session-complete
// summary agree.

export function xpForLevel(level: number): number {
  const L = Math.max(1, Math.floor(level));
  return 50 * L * (L - 1);
}

export function levelForXp(totalXp: number): number {
  const xp = Math.max(0, totalXp);
  return Math.floor((1 + Math.sqrt(1 + (8 * xp) / 100)) / 2);
}

export interface LevelProgress {
  level: number;
  totalXp: number;
  intoLevel: number; // XP earned within the current level
  span: number; // XP from this level to the next
  toNext: number; // XP remaining to the next level
  fraction: number; // 0..1 progress to the next level
}

export function levelProgress(totalXp: number): LevelProgress {
  const xp = Math.max(0, Math.round(totalXp));
  const level = levelForXp(xp);
  const floor = xpForLevel(level);
  const ceil = xpForLevel(level + 1);
  const span = Math.max(1, ceil - floor);
  const intoLevel = xp - floor;
  return {
    level,
    totalXp: xp,
    intoLevel,
    span,
    toNext: Math.max(0, ceil - xp),
    fraction: Math.min(1, intoLevel / span),
  };
}
