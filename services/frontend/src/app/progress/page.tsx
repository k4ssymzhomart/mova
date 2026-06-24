"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import AppHeader from "@/components/app/AppHeader";
import { CountUp } from "@/components/site/primitives";
import { computeInsights, summarize } from "@/lib/insights/engine";
import { loadSessions } from "@/lib/insights/store";
import type { Insight, SessionRecord } from "@/lib/insights/types";

export default function ProgressPage() {
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null);
  useEffect(() => setSessions(loadSessions()), []);

  return (
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
  );
}

function Empty() {
  return (
    <div className="mt-10 rounded-card border border-line bg-paper-soft p-10 text-center">
      <p className="mx-auto max-w-md text-ink-soft">
        No sessions yet. Complete your first reaching bout and Mova starts charting your range, speed,
        and consistency — and surfaces personalised insights here.
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
  const trend = sessions.map((x) => x.reachMs.mean).filter((v) => v > 0);

  return (
    <>
      {/* summary tiles */}
      <div className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line md:grid-cols-4">
        <Tile label="Sessions" value={s.totalSessions} />
        <Tile label="Day streak" value={s.streakDays} />
        <Tile label="Targets reached" value={s.totalReaches} />
        <Tile label="Best reach" value={s.bestReachMs ?? 0} suffix=" ms" />
      </div>

      {/* trend */}
      <div className="mt-5 rounded-card border border-line bg-card p-6 shadow-soft">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">
            Reach-time trend
          </span>
          <span className="font-mono text-xs text-ink-faint">
            {s.reachTrendPct === null
              ? "more sessions needed"
              : `${s.reachTrendPct > 0 ? "+" : ""}${s.reachTrendPct}% · lower is faster`}
          </span>
        </div>
        <Sparkline data={trend} />
      </div>

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
            <span className="font-mono tabular-nums text-ink-soft">{x.reaches} reaches</span>
            <span className="font-mono tabular-nums text-ink-soft">
              {x.reachMs.mean ? `${x.reachMs.mean} ms` : "—"}
            </span>
            <span className="font-mono tabular-nums text-ink-soft">{x.durationSec}s</span>
            <span className="truncate text-ink-faint">{x.harTop?.replace(/_/g, " ") ?? "—"}</span>
          </div>
        ))}
      </div>
    </>
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

/** Minimal monochrome+emerald sparkline. Reach time per session; the line falling = getting faster. */
function Sparkline({ data }: { data: number[] }) {
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
    const y = pad + (1 - (v - min) / span) * (h - 2 * pad);
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
