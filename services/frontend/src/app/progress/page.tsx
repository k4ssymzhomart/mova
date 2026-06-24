"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import AppHeader from "@/components/app/AppHeader";
import RequireAuth from "@/components/auth/RequireAuth";
import { CountUp } from "@/components/site/primitives";
import { computeInsights, summarize } from "@/lib/insights/engine";
import { loadSessions } from "@/lib/insights/store";
import type { Insight, SessionRecord } from "@/lib/insights/types";

export default function ProgressPage() {
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null);
  useEffect(() => setSessions(loadSessions()), []);

  return (
    <RequireAuth>
    <div className="min-h-screen bg-paper text-ink">
      <AppHeader active="/progress" />
      <main className="mx-auto max-w-shell px-5 py-10 sm:px-8">
        <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-ink-faint">
          Your rehabilitation · personalised
        </div>
        <h1 className="mt-2 max-w-2xl font-serif text-5xl italic leading-[1.05] text-ink">
          Every session, charted into progress.
        </h1>

        {sessions === null ? (
          <p className="mt-10 font-mono text-sm text-ink-faint">Loading…</p>
        ) : sessions.length === 0 ? (
          <Empty />
        ) : (
          <Body sessions={sessions} />
        )}
      </main>
    </div>
    </RequireAuth>
  );
}

function Empty() {
  return (
    <div className="mt-10 rounded-card border border-line bg-paper-soft p-10 text-center">
      <p className="mx-auto max-w-md text-ink-soft">
        No sessions yet. Complete a reaching or gait bout and Mova starts charting your range, speed,
        cadence, and consistency — and surfaces personalised insights here.
      </p>
      <Link
        href="/session"
        className="mt-6 inline-block rounded-pill bg-night px-6 py-3 text-sm font-medium text-paper-soft transition-colors hover:bg-ink"
      >
        Start your first session →
      </Link>
    </div>
  );
}

function Body({ sessions }: { sessions: SessionRecord[] }) {
  const s = summarize(sessions);
  const insights = computeInsights(sessions);
  const reachTrend = sessions.filter((x) => x.exercise === "reaching").map((x) => x.reachMs.mean).filter((v) => v > 0);
  const gaitTrend = sessions
    .filter((x) => x.exercise === "gait" && x.gait)
    .map((x) => Math.round(x.gait!.rhythmPct * 100));

  // up to four most-relevant headline tiles
  const tiles: { label: string; value: number; suffix?: string }[] = [
    { label: "Sessions", value: s.totalSessions },
    { label: "Day streak", value: s.streakDays },
  ];
  if (s.totalReaches > 0) tiles.push({ label: "Targets reached", value: s.totalReaches });
  if (s.totalSteps > 0) tiles.push({ label: "Cued steps", value: s.totalSteps });
  if (tiles.length < 4 && s.bestCadenceSpm) tiles.push({ label: "Best cadence", value: s.bestCadenceSpm, suffix: " spm" });
  if (tiles.length < 4 && s.bestReachMs) tiles.push({ label: "Best reach", value: s.bestReachMs, suffix: " ms" });

  return (
    <>
      {/* summary tiles */}
      <div className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line md:grid-cols-4">
        {tiles.slice(0, 4).map((t) => (
          <Tile key={t.label} label={t.label} value={t.value} suffix={t.suffix} />
        ))}
      </div>

      {/* trends */}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {reachTrend.length >= 2 && (
          <TrendCard
            title="Reach-time trend"
            note={s.reachTrendPct === null ? "more sessions needed" : `${s.reachTrendPct > 0 ? "+" : ""}${s.reachTrendPct}% · lower is faster`}
            data={reachTrend}
            invert
          />
        )}
        {gaitTrend.length >= 2 && (
          <TrendCard
            title="On-beat stepping trend"
            note={s.rhythmTrendPct === null ? "more gait bouts needed" : `${s.rhythmTrendPct > 0 ? "+" : ""}${s.rhythmTrendPct}% · higher is steadier`}
            data={gaitTrend}
          />
        )}
        {reachTrend.length < 2 && gaitTrend.length < 2 && (
          <div className="rounded-card border border-line bg-card p-6 shadow-soft">
            <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">Trends</span>
            <p className="mt-4 font-mono text-sm text-ink-faint">Two+ sessions of an exercise unlock its trend line.</p>
          </div>
        )}
      </div>

      {/* freeze-risk — folds the live FoG/HAR readout into a longitudinal + intra-session timeline */}
      <FreezeRisk sessions={sessions} />

      {/* insights */}
      <h2 className="mt-12 font-serif text-3xl italic text-ink">Insights for you</h2>
      <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {insights.map((ins) => (
          <InsightCard key={ins.id} ins={ins} />
        ))}
      </div>

      {/* history */}
      <h2 className="mt-12 font-serif text-3xl italic text-ink">Session history</h2>
      <div className="mt-5 overflow-hidden rounded-card border border-line bg-card shadow-soft">
        {[...sessions].reverse().map((x, i) => (
          <div
            key={x.id}
            className={`grid grid-cols-2 items-center gap-2 px-5 py-3.5 text-sm sm:grid-cols-5 ${
              i ? "border-t border-line" : ""
            }`}
          >
            <span className="text-ink">{new Date(x.startedAt).toLocaleDateString()}</span>
            <span className="font-mono tabular-nums text-ink-soft">
              {x.exercise === "gait" ? `${x.gait?.steps ?? 0} steps` : `${x.reaches} reaches`}
            </span>
            <span className="font-mono tabular-nums text-ink-soft">
              {x.exercise === "gait"
                ? x.gait?.cadenceSpm
                  ? `${x.gait.cadenceSpm} spm`
                  : "—"
                : x.reachMs.mean
                  ? `${x.reachMs.mean} ms`
                  : "—"}
            </span>
            <span className="font-mono tabular-nums text-ink-soft">{x.durationSec}s</span>
            <span className="truncate text-ink-faint">
              {x.exercise === "gait" ? "gait · FoG valid" : "reaching"}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * Freeze-risk timeline. Two views, both from the on-device FoG model already recorded per session:
 * (1) across sessions — mean risk over time, filled = lower-limb (valid), hollow = upper-limb preview;
 * (2) the latest bout's intra-session risk trace. The most-tracked activity (HAR) is folded in as context.
 */
function FreezeRisk({ sessions }: { sessions: SessionRecord[] }) {
  const withFog = sessions.filter((s) => s.fogRiskMean !== null);
  if (!withFog.length) return null;
  const last = [...sessions].reverse().find((s) => (s.fogSeries?.length ?? 0) >= 2) ?? null;
  const HAR = (s: string | null) => (s ? s.replace(/_/g, " ") : "—");

  return (
    <>
      <h2 className="mt-12 font-serif text-3xl italic text-ink">Freeze-risk</h2>
      <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-ink-soft">
        Live output from the on-device FoG model. Gait bouts feed it a lower-limb (ankle/shank) signal, so
        those readings are in-distribution; reaching bouts are an upper-limb preview. Research-grade, not a diagnosis.
      </p>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {/* across sessions */}
        <div className="rounded-card border border-line bg-card p-6 shadow-soft">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">Across sessions</span>
            <span className="font-mono text-xs text-ink-faint">lower is calmer</span>
          </div>
          <RiskTimeline data={withFog.map((s) => ({ risk: s.fogRiskMean ?? 0, valid: s.fogValid }))} />
          <div className="mt-3 flex items-center gap-4 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-signal" /> lower-limb · valid
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full border border-ink-faint" /> upper-limb · preview
            </span>
          </div>
        </div>

        {/* last bout intra-session */}
        <div className="rounded-card border border-line bg-card p-6 shadow-soft">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">Last bout · over time</span>
            <span className="font-mono text-xs text-ink-faint">
              {last ? `${last.fogValid ? "valid" : "preview"} · ${HAR(last.harTop)}` : "—"}
            </span>
          </div>
          {last?.fogSeries && last.fogSeries.length >= 2 ? (
            <RiskTrace data={last.fogSeries} />
          ) : (
            <p className="mt-6 font-mono text-sm text-ink-faint">Run a session to record a freeze-risk trace.</p>
          )}
        </div>
      </div>
    </>
  );
}

/** Per-session mean freeze-risk as dots+line. Filled dot = valid (lower-limb), hollow = preview. */
function RiskTimeline({ data }: { data: { risk: number; valid: boolean }[] }) {
  if (data.length < 2) {
    return <p className="mt-6 font-mono text-sm text-ink-faint">Two+ scored sessions plot the trend.</p>;
  }
  const w = 720;
  const h = 120;
  const pad = 10;
  const x = (i: number) => pad + (i / (data.length - 1)) * (w - 2 * pad);
  const y = (r: number) => pad + (1 - Math.max(0, Math.min(1, r))) * (h - 2 * pad);
  const line = data.map((d, i) => `${x(i).toFixed(1)},${y(d.risk).toFixed(1)}`).join(" ");
  const midY = y(0.5);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-4 h-32 w-full" preserveAspectRatio="none">
      <line x1={pad} y1={midY} x2={w - pad} y2={midY} stroke="rgba(18,19,17,0.18)" strokeWidth="1" strokeDasharray="4 5" />
      <polyline points={line} fill="none" stroke="#16a35b" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" opacity="0.55" />
      {data.map((d, i) =>
        d.valid ? (
          <circle key={i} cx={x(i)} cy={y(d.risk)} r="3.5" fill="#16a35b" />
        ) : (
          <circle key={i} cx={x(i)} cy={y(d.risk)} r="3.5" fill="#ffffff" stroke="#8A8B82" strokeWidth="1.5" />
        ),
      )}
    </svg>
  );
}

/** Intra-session freeze-risk trace as an area, with the 50% reference line. */
function RiskTrace({ data }: { data: number[] }) {
  const w = 720;
  const h = 120;
  const pad = 10;
  const x = (i: number) => pad + (i / (data.length - 1)) * (w - 2 * pad);
  const y = (r: number) => pad + (1 - Math.max(0, Math.min(1, r))) * (h - 2 * pad);
  const line = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${pad},${h - pad} ${line} ${(w - pad).toFixed(1)},${(h - pad).toFixed(1)}`;
  const midY = y(0.5);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-4 h-32 w-full" preserveAspectRatio="none">
      <polygon points={area} fill="#16a35b" opacity="0.1" />
      <line x1={pad} y1={midY} x2={w - pad} y2={midY} stroke="rgba(18,19,17,0.18)" strokeWidth="1" strokeDasharray="4 5" />
      <polyline points={line} fill="none" stroke="#16a35b" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Tile({ label, value, suffix = "" }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="bg-card p-6">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-ink-faint">{label}</div>
      <div className="mt-2 font-serif text-4xl italic text-ink">
        <CountUp value={value} suffix={suffix} />
      </div>
    </div>
  );
}

function InsightCard({ ins }: { ins: Insight }) {
  const ring =
    ins.tone === "positive" ? "border-signal/40" : ins.tone === "watch" ? "border-ink/25" : "border-line";
  return (
    <div className={`rounded-card border bg-card p-6 shadow-soft ${ring}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-serif text-xl italic text-ink">{ins.title}</h3>
        {ins.metric && <span className="font-mono text-sm tabular-nums text-signal-deep">{ins.metric}</span>}
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">{ins.body}</p>
      {ins.clinical && (
        <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-faint">
          {ins.clinical}
        </p>
      )}
    </div>
  );
}

function TrendCard({ title, note, data, invert = false }: { title: string; note: string; data: number[]; invert?: boolean }) {
  return (
    <div className="rounded-card border border-line bg-card p-6 shadow-soft">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">{title}</span>
        <span className="font-mono text-xs text-ink-faint">{note}</span>
      </div>
      <Sparkline data={data} invert={invert} />
    </div>
  );
}

/**
 * Minimal paper+emerald sparkline. `invert` maps a *lower* raw value to a *higher* point (used for reach
 * time, where falling = faster); otherwise higher value = higher point (rhythm %, where rising = better).
 */
function Sparkline({ data, invert = false }: { data: number[]; invert?: boolean }) {
  if (data.length < 2) {
    return <p className="mt-6 font-mono text-sm text-ink-faint">Two+ sessions needed to plot a trend.</p>;
  }
  const w = 720;
  const h = 120;
  const pad = 8;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - 2 * pad);
    const norm = (v - min) / span; // 0..1
    const up = invert ? 1 - norm : norm;
    const y = pad + (1 - up) * (h - 2 * pad);
    return [x, y] as const;
  });
  const line = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${pad},${h - pad} ${line} ${w - pad},${h - pad}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-4 h-32 w-full" preserveAspectRatio="none">
      <polygon points={area} fill="#16a35b" opacity="0.08" />
      <polyline points={line} fill="none" stroke="#16a35b" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r="2.5" fill="#16a35b" />
      ))}
    </svg>
  );
}
