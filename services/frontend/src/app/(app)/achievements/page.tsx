import type { Metadata } from "next";
import { Flame, Lock } from "lucide-react";

import BadgeMark from "@/components/gamification/BadgeMark";
import { levelProgress } from "@/lib/gamification/levels";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Achievements · Mova" };

interface Def {
  code: string;
  title: string;
  description: string | null;
  xp_reward: number;
}

export default async function AchievementsPage() {
  const supabase = createClient();
  const [{ data: xpRows }, { data: streak }, { data: earnedRows }, { data: defs }] = await Promise.all([
    supabase.from("xp_ledger").select("delta"),
    supabase.from("streaks").select("current_streak, longest_streak").maybeSingle(),
    supabase.from("achievements").select("def_code, earned_at"),
    supabase
      .from("achievement_defs")
      .select("code, title, description, xp_reward")
      .order("xp_reward", { ascending: true }),
  ]);

  const totalXp = (xpRows ?? []).reduce((s: number, r: { delta: number }) => s + r.delta, 0);
  const lp = levelProgress(totalXp);
  const earned = new Set(
    (earnedRows ?? []).map((a: { def_code: string }) => String(a.def_code).toLowerCase()),
  );
  const catalog = (defs ?? []) as Def[];
  const earnedCount = catalog.filter((d) => earned.has(d.code.toLowerCase())).length;
  const current = streak?.current_streak ?? 0;
  const longest = streak?.longest_streak ?? 0;

  return (
    <div className="space-y-8">
      <div>
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-signal">Achievements</div>
        <h1 className="mt-2 font-serif text-4xl italic leading-none text-ink">
          Your rehabilitation, rewarded.
        </h1>
      </div>

      {/* Level / XP banner — dark emerald immersive */}
      <section className="relative overflow-hidden rounded-3xl bg-night px-7 py-7 shadow-sm sm:px-9 sm:py-9">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_120%_at_85%_-25%,rgba(22,163,91,0.30),transparent_60%)]" />
        <div className="relative">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-signal-bright">Level</div>
              <div className="mt-1.5 flex items-baseline gap-3">
                <span className="font-serif text-6xl italic leading-none text-paper">{lp.level}</span>
                <span className="font-mono text-sm text-paper/55">{lp.totalXp.toLocaleString()} XP</span>
              </div>
            </div>
            <div className="text-right">
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper/45">
                To level {lp.level + 1}
              </div>
              <div className="mt-1 font-serif text-2xl text-paper">{lp.toNext.toLocaleString()} XP</div>
            </div>
          </div>
          <div className="mt-6">
            <div className="h-2 w-full overflow-hidden rounded-pill bg-paper/[0.14]">
              <div
                className="h-full rounded-pill bg-signal transition-[width] duration-700 ease-editorial"
                style={{ width: `${Math.round(lp.fraction * 100)}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between font-mono text-[11px] text-paper/45">
              <span>
                {lp.intoLevel.toLocaleString()} / {lp.span.toLocaleString()} XP this level
              </span>
              <span>
                {earnedCount}/{catalog.length} badges
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Streaks */}
      <section className="grid gap-4 sm:grid-cols-2">
        <StreakCard
          label="Current streak"
          value={current}
          active={current > 0}
          sub={current > 0 ? "Keep it alive — train again today." : "Train today to start a streak."}
        />
        <StreakCard label="Longest streak" value={longest} active={false} sub="Your personal best." />
      </section>

      {/* Badges */}
      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-serif text-2xl italic text-ink">Badges</h2>
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
            {earnedCount} earned
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {catalog.map((d) => {
            const isEarned = earned.has(d.code.toLowerCase());
            return (
              <div
                key={d.code}
                className={cn(
                  "flex items-start gap-4 rounded-2xl border p-5",
                  isEarned ? "border-signal/30 bg-signal/[0.04]" : "border-line bg-card",
                )}
              >
                <div
                  className={cn(
                    "grid size-14 shrink-0 place-items-center rounded-2xl",
                    isEarned ? "bg-card ring-1 ring-signal/25" : "bg-paper-soft ring-1 ring-line",
                  )}
                >
                  <BadgeMark code={d.code} earned={isEarned} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn("font-medium", isEarned ? "text-ink" : "text-ink-soft")}>
                      {d.title}
                    </span>
                    {!isEarned && <Lock className="size-3 text-ink-faint" strokeWidth={2} />}
                  </div>
                  <p className="mt-1 text-[13px] leading-snug text-ink-soft">{d.description}</p>
                  <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.1em] text-ink-faint">
                    {isEarned ? "Earned" : `${d.xp_reward} XP`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function StreakCard({
  label,
  value,
  active,
  sub,
}: {
  label: string;
  value: number;
  active: boolean;
  sub: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-5",
        active ? "border-signal/30 bg-signal/[0.05]" : "border-line bg-card",
      )}
    >
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em]">
        <Flame className={cn("size-3.5", active ? "text-signal" : "text-ink-faint")} strokeWidth={2} />
        <span className={active ? "text-signal-deep" : "text-ink-faint"}>{label}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-serif text-4xl italic text-ink">{value}</span>
        <span className="text-sm text-ink-faint">{value === 1 ? "day" : "days"}</span>
      </div>
      <p className="mt-1 text-[13px] text-ink-soft">{sub}</p>
    </div>
  );
}
