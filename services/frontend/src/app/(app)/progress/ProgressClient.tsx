"use client";

// ProgressClient — the patient's longitudinal read, scoped to THEIR on-device history (userId-namespaced
// store). Deliberately chart-free: progress is communicated through large editorial numerals, plain-language
// deltas, and lucide trend glyphs — no systematic graphs. Data comes from the same engine the coach uses.

import {
  Activity,
  ArrowRight,
  Flame,
  Footprints,
  Gauge,
  Minus,
  Target,
  TrendingDown,
  TrendingUp,
  Waves,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { CountUp } from "@/components/site/primitives";
import { computeInsights, summarize } from "@/lib/insights/engine";
import { loadSessions } from "@/lib/insights/store";
import type { Insight, SessionRecord } from "@/lib/insights/types";
import { useTranslation } from "@/locales/client";
import { cn } from "@/lib/utils";

export default function ProgressClient({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null);
  useEffect(() => setSessions(loadSessions(userId)), [userId]);

  return (
    <div className="space-y-8">
      <header>
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-signal">{t("progress.eyebrow")}</div>
        <h1 className="mt-2 max-w-2xl text-4xl leading-[1.05] text-ink sm:text-5xl">{t("progress.title")}</h1>
      </header>

      {sessions === null ? (
        <LoadingSkeleton />
      ) : sessions.length === 0 ? (
        <Empty />
      ) : (
        <Body sessions={sessions} />
      )}
    </div>
  );
}

function Empty() {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-line bg-card p-10 text-center">
      <Activity className="mx-auto size-7 text-ink-faint" strokeWidth={1.5} />
      <p className="mx-auto mt-4 max-w-md text-ink-soft">{t("progress.emptyBody")}</p>
      <Link
        href="/app/session/new"
        prefetch={false}
        className="mt-6 inline-flex items-center gap-2 rounded-pill bg-night px-6 py-3 text-sm text-paper-soft transition-colors hover:bg-ink"
      >
        {t("progress.startFirst")}
        <ArrowRight className="size-4" strokeWidth={1.8} />
      </Link>
    </div>
  );
}

function Body({ sessions }: { sessions: SessionRecord[] }) {
  const { t } = useTranslation();
  const s = summarize(sessions);
  const insights = computeInsights(sessions);

  const reachTrend = sessions.filter((x) => x.exercise === "reaching").map((x) => x.reachMs.mean).filter((v) => v > 0);
  const gaitTrend = sessions
    .filter((x) => x.exercise === "gait" && x.gait)
    .map((x) => Math.round(x.gait!.rhythmPct * 100));
  const fogTrend = sessions
    .filter((x) => x.fogRiskMean !== null)
    .map((x) => Math.round((x.fogRiskMean ?? 0) * 100));

  const stats: { icon: typeof Activity; label: string; value: number; suffix?: string }[] = [
    { icon: Activity, label: t("progress.sessionsStat"), value: s.totalSessions },
    { icon: Flame, label: t("progress.dayStreak"), value: s.streakDays },
  ];
  if (s.totalReaches > 0) stats.push({ icon: Target, label: t("progress.targetsReached"), value: s.totalReaches });
  if (s.totalSteps > 0) stats.push({ icon: Footprints, label: t("progress.cuedSteps"), value: s.totalSteps });
  if (stats.length < 4 && s.bestCadenceSpm) stats.push({ icon: Gauge, label: t("progress.bestCadence"), value: s.bestCadenceSpm, suffix: " spm" });

  return (
    <div className="space-y-10">
      {/* headline numerals */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.slice(0, 4).map((st) => (
          <Stat key={st.label} icon={st.icon} label={st.label} value={st.value} suffix={st.suffix} />
        ))}
      </div>

      {/* trends — numbers + deltas, no graphs */}
      {(reachTrend.length >= 2 || gaitTrend.length >= 2 || fogTrend.length >= 2) && (
        <section>
          <h2 className="mb-4 text-2xl text-ink">{t("progress.trends")}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {reachTrend.length >= 2 && (
              <TrendTile label={t("progress.reachTime")} unit="ms" data={reachTrend} invert lowerNote={t("progress.faster")} />
            )}
            {gaitTrend.length >= 2 && (
              <TrendTile label={t("progress.onBeatAccuracy")} unit="%" data={gaitTrend} higherNote={t("progress.steadier")} />
            )}
            {fogTrend.length >= 2 && (
              <TrendTile label={t("progress.freezeRisk")} unit="%" data={fogTrend} invert lowerNote={t("progress.calmer")} icon={Waves} />
            )}
          </div>
        </section>
      )}

      {/* insights */}
      {insights.length > 0 && (
        <section>
          <h2 className="mb-4 text-2xl text-ink">{t("progress.insights")}</h2>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {insights.map((ins) => (
              <InsightCard key={ins.id} ins={ins} />
            ))}
          </div>
        </section>
      )}

      {/* history */}
      <section>
        <h2 className="mb-4 text-2xl text-ink">{t("progress.history")}</h2>
        <div className="overflow-hidden rounded-lg border border-line bg-card">
          {[...sessions].reverse().map((x, i) => (
            <div
              key={x.id}
              className={cn(
                "grid grid-cols-2 items-center gap-2 px-5 py-3.5 text-sm sm:grid-cols-5",
                i && "border-t border-line",
              )}
            >
              <span className="text-ink">{new Date(x.startedAt).toLocaleDateString()}</span>
              <span className="tnum text-ink-soft">
                {x.exercise === "gait" ? `${x.gait?.steps ?? 0} steps` : `${x.reaches} reaches`}
              </span>
              <span className="tnum text-ink-soft">
                {x.exercise === "gait"
                  ? x.gait?.cadenceSpm
                    ? `${x.gait.cadenceSpm} spm`
                    : "—"
                  : x.reachMs.mean
                    ? `${x.reachMs.mean} ms`
                    : "—"}
              </span>
              <span className="tnum text-ink-soft">{x.durationSec}s</span>
              <span className="truncate text-ink-faint">
                {x.exercise === "gait" ? "gait · FoG valid" : "reaching"}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  suffix = "",
}: {
  icon: typeof Activity;
  label: string;
  value: number;
  suffix?: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-card p-5">
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
        <Icon className="size-3.5" strokeWidth={1.8} />
        {label}
      </div>
      <div className="tnum mt-2 text-4xl text-ink">
        <CountUp value={value} suffix={suffix} />
      </div>
    </div>
  );
}

function TrendTile({
  label,
  unit,
  data,
  invert = false,
  higherNote,
  lowerNote,
  icon: Icon = TrendingUp,
}: {
  label: string;
  unit: string;
  data: number[];
  invert?: boolean;
  higherNote?: string;
  lowerNote?: string;
  icon?: typeof TrendingUp;
}) {
  const first = data[0];
  const last = data[data.length - 1];
  const diff = last - first;
  const flat = Math.abs(diff) < (unit === "ms" ? 5 : 1);
  const better = invert ? diff < 0 : diff > 0;
  const Arrow = flat ? Minus : diff > 0 ? TrendingUp : TrendingDown;
  const tone = flat ? "text-ink-faint" : better ? "text-signal-deep" : "text-amber-600";
  const direction = invert ? lowerNote : higherNote;

  return (
    <div className="rounded-lg border border-line bg-card p-5">
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
        <Icon className="size-3.5" strokeWidth={1.8} />
        {label}
      </div>
      <div className="tnum mt-2 flex items-baseline gap-1 text-4xl text-ink">
        {last}
        <span className="font-mono text-sm text-ink-faint">{unit}</span>
      </div>
      <div className={cn("mt-2 flex items-center gap-1.5 text-[12px]", tone)}>
        <Arrow className="size-3.5" strokeWidth={2} />
        <span className="tnum">
          {flat ? "Holding steady" : `${diff > 0 ? "+" : ""}${diff}${unit} vs first`}
        </span>
      </div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
        {direction ? `${invert ? "lower" : "higher"} is ${direction}` : `over ${data.length} sessions`}
      </div>
    </div>
  );
}

function InsightCard({ ins }: { ins: Insight }) {
  const ring =
    ins.tone === "positive" ? "border-signal/40" : ins.tone === "watch" ? "border-amber-400/50" : "border-line";
  return (
    <div className={cn("rounded-lg border bg-card p-5", ring)}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-lg text-ink">{ins.title}</h3>
        {ins.metric && <span className="tnum font-mono text-sm text-signal-deep">{ins.metric}</span>}
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">{ins.body}</p>
      {ins.clinical && (
        <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-faint">{ins.clinical}</p>
      )}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-10">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[104px] animate-pulse rounded-lg border border-line bg-paper-soft/60" />
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-[132px] animate-pulse rounded-lg border border-line bg-paper-soft/60" />
        ))}
      </div>
    </div>
  );
}
