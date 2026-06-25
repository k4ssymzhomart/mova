"use client";

// SessionInsightsCoach — a dynamic, data-driven read on the session just finished, compared against the
// patient's own history. It writes plain-language coaching lines ("cadence held steady, but on-beat
// accuracy dropped 6 pts — focus on rhythm") from the metric deltas, and draws sparklines of the key
// metrics across recent sessions. Editorial Spatial; no canned copy.

import type { SessionRecord } from "@/lib/insights/types";
import { cn } from "@/lib/utils";

type Tone = "positive" | "watch" | "neutral";

export default function SessionInsightsCoach({
  record,
  history,
}: {
  record: SessionRecord;
  history: SessionRecord[];
}) {
  const past = history.filter((h) => h.id !== record.id);
  const isGait = record.exercise === "gait";
  const lines = isGait ? gaitLines(record, past) : reachLines(record, past);
  const series = isGait ? gaitSeries(history) : reachSeries(history);

  return (
    <section className="mt-6 rounded-xl border border-line bg-card p-6 shadow-sm sm:p-8">
      <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-signal">Session analysis</div>
      <h2 className="mt-2 text-2xl text-ink">Here's what your movement is telling us.</h2>

      <div className="mt-5 space-y-2.5">
        {lines.map((l, i) => (
          <div key={i} className="flex items-start gap-3">
            <span
              className={cn(
                "mt-1.5 size-1.5 shrink-0 rounded-full",
                l.tone === "positive" ? "bg-signal" : l.tone === "watch" ? "bg-amber-500" : "bg-ink-faint",
              )}
            />
            <p className="text-[14px] leading-relaxed text-ink-soft">{l.text}</p>
          </div>
        ))}
      </div>

      {series.length > 0 && (
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {series.map((s) => (
            <div key={s.label} className="rounded-lg border border-line bg-paper-soft/40 p-4">
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">{s.label}</span>
                <span className="font-mono text-sm tabular-nums text-ink">{s.current}</span>
              </div>
              <Sparkline data={s.data} invert={s.invert} />
              <div className="mt-1 font-mono text-[10px] text-ink-faint">{s.note}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// — line generators ————————————————————————————————————————————————

function mean(xs: number[]): number | null {
  const v = xs.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function gaitLines(r: SessionRecord, past: SessionRecord[]): { tone: Tone; text: string }[] {
  const out: { tone: Tone; text: string }[] = [];
  const g = r.gait;
  if (!g) return [{ tone: "neutral", text: "No gait metrics were captured this session." }];

  const pastRhythm = mean(past.map((p) => (p.gait ? p.gait.rhythmPct * 100 : NaN)));
  const rhythm = Math.round(g.rhythmPct * 100);
  if (pastRhythm != null) {
    const d = Math.round(rhythm - pastRhythm);
    out.push({
      tone: d >= 2 ? "positive" : d <= -3 ? "watch" : "neutral",
      text:
        d >= 2
          ? `On-beat accuracy rose to ${rhythm}% — up ${d} points on your average. Your rhythm control is improving.`
          : d <= -3
            ? `On-beat accuracy was ${rhythm}%, down ${Math.abs(d)} points from your average. Cadence consistency dropped — focus on stepping with the beat next time.`
            : `On-beat accuracy held at ${rhythm}%, in line with your average.`,
    });
  } else {
    out.push({ tone: "neutral", text: `On-beat accuracy was ${rhythm}% — your first gait baseline.` });
  }

  if (g.cadenceSpm) {
    const pastCad = mean(past.map((p) => p.gait?.cadenceSpm ?? NaN));
    const d = pastCad != null ? Math.round(g.cadenceSpm - pastCad) : 0;
    out.push({
      tone: "neutral",
      text:
        pastCad != null && Math.abs(d) >= 3
          ? `Cadence averaged ${g.cadenceSpm} spm (${d > 0 ? "+" : ""}${d} vs your usual ${Math.round(pastCad)} spm).`
          : `Cadence averaged ${g.cadenceSpm} spm across ${g.steps} steps.`,
    });
  }

  if (r.fogRiskMean != null) {
    const fog = Math.round(r.fogRiskMean * 100);
    const pastFog = mean(past.map((p) => (p.fogRiskMean != null ? p.fogRiskMean * 100 : NaN)));
    const d = pastFog != null ? Math.round(fog - pastFog) : 0;
    out.push({
      tone: fog <= 30 ? "positive" : fog >= 60 ? "watch" : "neutral",
      text:
        pastFog != null && Math.abs(d) >= 5
          ? `Freeze-risk averaged ${fog}% — ${d < 0 ? `${Math.abs(d)} points calmer than` : `${d} points above`} your recent sessions.`
          : `Freeze-risk averaged ${fog}% this session${r.fogValid ? "" : " (upper-limb preview — not a clinical reading)"}.`,
    });
  }
  return out;
}

function reachLines(r: SessionRecord, past: SessionRecord[]): { tone: Tone; text: string }[] {
  const out: { tone: Tone; text: string }[] = [];
  out.push({
    tone: r.reaches >= 8 ? "positive" : "neutral",
    text: `You completed ${r.reaches} reaches in ${r.attempts} attempts${
      r.attempts ? ` (${Math.round((r.reaches / r.attempts) * 100)}% success)` : ""
    }.`,
  });
  if (r.reachMs.mean) {
    const pastReach = mean(past.map((p) => p.reachMs?.mean ?? NaN));
    const d = pastReach != null ? Math.round(r.reachMs.mean - pastReach) : 0;
    out.push({
      tone: d < -20 ? "positive" : d > 30 ? "watch" : "neutral",
      text:
        pastReach != null && Math.abs(d) >= 20
          ? `Average reach time was ${r.reachMs.mean} ms — ${d < 0 ? `${Math.abs(d)} ms faster than` : `${d} ms slower than`} your average. ${d < 0 ? "Smoothness is trending up." : "Take your time — accuracy before speed."}`
          : `Average reach time was ${r.reachMs.mean} ms (best ${r.reachMs.best} ms).`,
    });
  }
  out.push({
    tone: "neutral",
    text:
      past.length >= 1
        ? `That's session ${past.length + 1}. Consistency is what moves the recovery curve — keep the cadence.`
        : "Your first reaching session is logged — the baseline your progress is measured against.",
  });
  return out;
}

// — sparkline series ————————————————————————————————————————————————

interface Series {
  label: string;
  current: string;
  note: string;
  data: number[];
  invert?: boolean;
}

function recent(history: SessionRecord[], pick: (s: SessionRecord) => number | null): number[] {
  return history
    .slice(-8)
    .map(pick)
    .filter((v): v is number => v != null && Number.isFinite(v));
}

function gaitSeries(history: SessionRecord[]): Series[] {
  const gait = history.filter((h) => h.exercise === "gait");
  const rhythm = recent(gait, (s) => (s.gait ? Math.round(s.gait.rhythmPct * 100) : null));
  const cadence = recent(gait, (s) => s.gait?.cadenceSpm ?? null);
  const fog = recent(gait, (s) => (s.fogRiskMean != null ? Math.round(s.fogRiskMean * 100) : null));
  const out: Series[] = [];
  if (rhythm.length >= 2) out.push({ label: "On-beat %", current: `${rhythm[rhythm.length - 1]}%`, note: "higher is steadier", data: rhythm });
  if (cadence.length >= 2) out.push({ label: "Cadence", current: `${cadence[cadence.length - 1]} spm`, note: "steps per minute", data: cadence });
  if (fog.length >= 2) out.push({ label: "Freeze-risk", current: `${fog[fog.length - 1]}%`, note: "lower is calmer", data: fog, invert: true });
  return out;
}

function reachSeries(history: SessionRecord[]): Series[] {
  const reach = history.filter((h) => h.exercise === "reaching");
  const times = recent(reach, (s) => (s.reachMs?.mean ? s.reachMs.mean : null));
  const reaches = recent(reach, (s) => s.reaches);
  const out: Series[] = [];
  if (times.length >= 2) out.push({ label: "Reach time", current: `${times[times.length - 1]} ms`, note: "lower is faster", data: times, invert: true });
  if (reaches.length >= 2) out.push({ label: "Reaches", current: `${reaches[reaches.length - 1]}`, note: "per session", data: reaches });
  return out;
}

function Sparkline({ data, invert = false }: { data: number[]; invert?: boolean }) {
  const w = 180;
  const h = 40;
  const pad = 4;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - 2 * pad);
    const up = invert ? 1 - (v - min) / span : (v - min) / span;
    return [x, pad + (1 - up) * (h - 2 * pad)] as const;
  });
  const line = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 h-10 w-full" preserveAspectRatio="none">
      <polyline points={line} fill="none" stroke="#16a35b" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="2.2" fill="#16a35b" />
    </svg>
  );
}
