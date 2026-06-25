import type { Metadata } from "next";
import { Flame, Lock } from "lucide-react";

import BadgeMark from "@/components/gamification/BadgeMark";
import { levelProgress } from "@/lib/gamification/levels";
import { createClient } from "@/lib/supabase/server";
import { getTranslation } from "@/locales/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Achievements · Mova" };

interface Def {
  code: string;
  title: string;
  description: string | null;
  xp_reward: number;
}

export default async function AchievementsPage() {
  const { t } = getTranslation();
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
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-signal">{t("achievements.eyebrow")}</div>
        <h1 className="mt-2 text-4xl leading-none text-ink">{t("achievements.title")}</h1>
      </div>

      {/* Level / XP banner */}
      <section className="relative overflow-hidden rounded-xl border border-line bg-card px-7 py-7 sm:px-9 sm:py-9">
        <div className="relative">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-signal">{t("achievements.levelLabel")}</div>
              <div className="mt-1.5 flex items-baseline gap-3">
                <span className="text-6xl leading-none text-ink">{lp.level}</span>
                <span className="font-mono text-sm text-ink-faint">{lp.totalXp.toLocaleString()} XP</span>
              </div>
            </div>
            <div className="text-right">
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint">
                {t("achievements.toLevelN", { n: lp.level + 1 })}
              </div>
              <div className="mt-1 text-2xl text-ink">{lp.toNext.toLocaleString()} XP</div>
            </div>
          </div>
          <div className="mt-6">
            <div className="h-2 w-full overflow-hidden rounded-pill bg-paper-soft">
              <div
                className="h-full rounded-pill bg-signal transition-[width] duration-700 ease-editorial"
                style={{ width: `${Math.round(lp.fraction * 100)}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between font-mono text-[11px] text-ink-faint">
              <span>{t("achievements.thisLevel", { into: lp.intoLevel.toLocaleString(), span: lp.span.toLocaleString() })}</span>
              <span>{t("achievements.badgesCount", { n: earnedCount, total: catalog.length })}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Streaks */}
      <section className="grid gap-4 sm:grid-cols-2">
        <StreakCard
          label={t("achievements.currentStreak")}
          value={current}
          active={current > 0}
          sub={current > 0 ? t("achievements.keepAlive") : t("achievements.startToday")}
          dayLabel={current === 1 ? t("achievements.day") : t("achievements.days")}
        />
        <StreakCard label={t("achievements.longestStreak")} value={longest} active={false} sub={t("achievements.personalBest")} dayLabel={longest === 1 ? t("achievements.day") : t("achievements.days")} />
      </section>

      {/* Badges */}
      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-2xl text-ink">{t("achievements.badges")}</h2>
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
            {t("achievements.earnedCount", { n: earnedCount })}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {catalog.map((d) => {
            const isEarned = earned.has(d.code.toLowerCase());
            return (
              <div
                key={d.code}
                className={cn(
                  "flex items-start gap-4 rounded-lg border p-5",
                  isEarned ? "border-signal/30 bg-signal/[0.04]" : "border-line bg-card",
                )}
              >
                <div
                  className={cn(
                    "grid size-14 shrink-0 place-items-center rounded-lg",
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
                    {isEarned ? t("achievements.earned") : `${d.xp_reward} XP`}
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
  dayLabel,
}: {
  label: string;
  value: number;
  active: boolean;
  sub: string;
  dayLabel: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-5",
        active ? "border-signal/30 bg-signal/[0.05]" : "border-line bg-card",
      )}
    >
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em]">
        <Flame className={cn("size-3.5", active ? "text-signal" : "text-ink-faint")} strokeWidth={2} />
        <span className={active ? "text-signal-deep" : "text-ink-faint"}>{label}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-4xl text-ink">{value}</span>
        <span className="text-sm text-ink-faint">{dayLabel}</span>
      </div>
      <p className="mt-1 text-[13px] text-ink-soft">{sub}</p>
    </div>
  );
}
