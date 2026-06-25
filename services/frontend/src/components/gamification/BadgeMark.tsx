// BadgeMark — a badge emblem drawn from the lucide icon set (no bespoke SVG geometry). The icon is chosen
// by the badge code where we know it, otherwise by a stable hash so every badge has a consistent glyph.
// Emerald when earned, muted when locked.

import {
  Award,
  Flame,
  Footprints,
  type LucideIcon,
  Medal,
  Sparkles,
  Star,
  Target,
  Timer,
  Trophy,
  Zap,
} from "lucide-react";

const EARNED = "#16A35B"; // signal
const LOCKED = "#B4B2A9"; // muted ink-faint

// Stable glyphs for the seeded badges; everything else hashes into the pool below.
const BY_CODE: Record<string, LucideIcon> = {
  first_session: Footprints,
  streak_7: Flame,
  rom_goal_met: Target,
};

const POOL: LucideIcon[] = [Award, Medal, Trophy, Star, Zap, Sparkles, Timer, Target];

function iconFor(code: string): LucideIcon {
  const known = BY_CODE[code.toLowerCase()];
  if (known) return known;
  let h = 0;
  for (let i = 0; i < code.length; i += 1) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  return POOL[h % POOL.length];
}

export default function BadgeMark({ code, earned }: { code: string; earned: boolean }) {
  const Icon = iconFor(code);
  return (
    <Icon
      size={26}
      strokeWidth={1.6}
      color={earned ? EARNED : LOCKED}
      aria-hidden="true"
    />
  );
}
