"use client";

// SessionReward — the elegant end-of-session state. A dark emerald immersive panel that counts up the
// XP earned, animates the level bar (from where it was, or from zero on a level-up), surfaces any newly
// unlocked badges, and routes onward. Tasteful and clinical: no confetti, no rainbow — emerald accent
// on the night surface, crisp serif figures.

import { Flame } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { levelProgress } from "@/lib/gamification/levels";

import BadgeMark from "./BadgeMark";

export interface SessionRewardData {
  xp_awarded: number;
  total_xp: number;
  prev_total_xp: number;
  current_streak: number;
  longest_streak: number;
  new_badges: { code: string; title: string; xp_reward: number }[];
}

export default function SessionReward({
  reward,
  onRestart,
}: {
  reward: SessionRewardData;
  onRestart: () => void;
}) {
  const lp = levelProgress(reward.total_xp);
  const prevLp = levelProgress(reward.prev_total_xp);
  const leveledUp = lp.level > prevLp.level;

  const [xp, setXp] = useState(0);
  const [filled, setFilled] = useState(false);

  useEffect(() => {
    setFilled(true);
    const target = reward.xp_awarded;
    const dur = 900;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / dur);
      setXp(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reward.xp_awarded]);

  const barWidth = `${Math.round((filled ? lp.fraction : leveledUp ? 0 : prevLp.fraction) * 100)}%`;

  return (
    <section className="relative mt-10 overflow-hidden rounded-xl border border-line bg-card px-7 py-8 sm:px-10 sm:py-10">
      <div className="relative">
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-signal">
          Session complete
        </div>
        <div className="mt-3 flex items-baseline gap-3">
          <span className="text-5xl leading-none text-ink">
            +{xp.toLocaleString()}
          </span>
          <span className="font-mono text-sm uppercase tracking-[0.18em] text-ink-faint">XP earned</span>
        </div>

        <div className="mt-7 max-w-md">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint">
              Level {lp.level}
            </span>
            {leveledUp && (
              <span className="rounded-pill bg-signal px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-white">
                Level up
              </span>
            )}
            <span className="font-mono text-[11px] text-ink-faint">
              {lp.toNext.toLocaleString()} XP to {lp.level + 1}
            </span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-pill bg-paper-soft">
            <div
              className="h-full rounded-pill bg-signal transition-[width] duration-1000 ease-editorial"
              style={{ width: barWidth }}
            />
          </div>
        </div>

        <div className="mt-6 inline-flex items-center gap-2 text-ink-soft">
          <Flame className="size-4 text-signal" strokeWidth={2} />
          <span className="text-sm">
            {reward.current_streak > 0
              ? `${reward.current_streak}-day streak`
              : "Train tomorrow to start a streak"}
          </span>
        </div>

        {reward.new_badges.length > 0 && (
          <div className="mt-7">
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint">
              {reward.new_badges.length === 1 ? "Badge unlocked" : "Badges unlocked"}
            </div>
            <div className="mt-3 flex flex-wrap gap-3">
              {reward.new_badges.map((b) => (
                <div
                  key={b.code}
                  className="flex items-center gap-3 rounded-lg border border-line bg-paper-soft px-4 py-3"
                >
                  <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-card">
                    <BadgeMark code={b.code} earned />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-ink">{b.title}</div>
                    <div className="font-mono text-[11px] text-signal">+{b.xp_reward} XP</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/achievements"
            className="rounded-pill bg-signal px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-signal-bright"
          >
            View achievements →
          </Link>
          <Link
            href="/progress"
            className="rounded-pill border border-line px-5 py-2.5 text-sm font-medium text-ink-soft transition-colors hover:bg-paper-soft"
          >
            See progress
          </Link>
          <button
            type="button"
            onClick={onRestart}
            className="rounded-pill border border-line px-5 py-2.5 text-sm font-medium text-ink-soft transition-colors hover:bg-paper-soft"
          >
            New session
          </button>
        </div>
      </div>
    </section>
  );
}
