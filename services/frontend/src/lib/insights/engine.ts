// Progression + personalised-insight engine. Pure functions over a session history; every figure is
// computed from real in-session measurements and mapped honestly to a rehab construct.

import type { Insight, ProgressSummary, SessionRecord } from "./types";

const DAY = 86_400_000;

function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** Consecutive-calendar-day streak ending today (or yesterday). */
function streakDays(sessions: SessionRecord[]): number {
  if (!sessions.length) return 0;
  const days = new Set(sessions.map((s) => dayKey(s.startedAt)));
  let streak = 0;
  const cursor = new Date();
  // allow the streak to count from today or yesterday so an evening gap doesn't reset it at midnight
  if (!days.has(dayKey(cursor.getTime()))) cursor.setTime(cursor.getTime() - DAY);
  while (days.has(dayKey(cursor.getTime()))) {
    streak += 1;
    cursor.setTime(cursor.getTime() - DAY);
  }
  return streak;
}

export function summarize(sessions: SessionRecord[]): ProgressSummary {
  const totalSessions = sessions.length;
  const totalReaches = sessions.reduce((a, s) => a + s.reaches, 0);
  const now = Date.now();
  const weekSessions = sessions.filter((s) => now - s.startedAt < 7 * DAY).length;
  const reachMeans = sessions.map((s) => s.reachMs.mean).filter((v) => v > 0);
  const avgReachMs = reachMeans.length ? Math.round(reachMeans.reduce((a, b) => a + b, 0) / reachMeans.length) : null;
  const bestReachMs = sessions.length
    ? Math.min(...sessions.map((s) => s.reachMs.best).filter((v) => v > 0))
    : null;

  let reachTrendPct: number | null = null;
  if (sessions.length >= 4) {
    const recent = sessions.slice(-2).map((s) => s.reachMs.mean).filter((v) => v > 0);
    const prior = sessions.slice(-5, -2).map((s) => s.reachMs.mean).filter((v) => v > 0);
    if (recent.length && prior.length) {
      const r = recent.reduce((a, b) => a + b, 0) / recent.length;
      const p = prior.reduce((a, b) => a + b, 0) / prior.length;
      if (p > 0) reachTrendPct = Math.round(((r - p) / p) * 100);
    }
  }

  return {
    totalSessions,
    totalReaches,
    streakDays: streakDays(sessions),
    weekSessions,
    avgReachMs,
    bestReachMs: bestReachMs && isFinite(bestReachMs) ? bestReachMs : null,
    reachTrendPct,
  };
}

/**
 * Personalised insights. Honest by construction: reach time is a *movement-speed proxy*; reaches are
 * dose/adherence; the FoG readout is an arm-derived preview, never a diagnosis.
 */
export function computeInsights(sessions: SessionRecord[]): Insight[] {
  if (!sessions.length) {
    return [
      {
        id: "welcome",
        tone: "neutral",
        title: "Your baseline starts today",
        body: "Finish your first reaching bout and Mova begins charting your range, speed, and consistency over time.",
        clinical: "First session establishes the personal baseline future progress is measured against.",
      },
    ];
  }

  const s = summarize(sessions);
  const latest = sessions[sessions.length - 1];
  const out: Insight[] = [];

  // 1) Movement-speed trend (reach time) — the headline progression signal.
  if (s.reachTrendPct !== null) {
    const faster = s.reachTrendPct < 0;
    out.push({
      id: "reach-trend",
      tone: faster ? "positive" : s.reachTrendPct > 8 ? "watch" : "neutral",
      title: faster ? "You're reaching faster" : "Reach speed held steady",
      body: faster
        ? `Your average reach time dropped over your last sessions — quicker, more confident movements.`
        : `Reach time is roughly stable. Short, frequent bouts tend to move this next.`,
      metric: `${s.reachTrendPct > 0 ? "+" : ""}${s.reachTrendPct}%`,
      clinical: "Reach time proxies upper-limb movement speed / bradykinesia; downward is improvement.",
    });
  }

  // 2) Personal best.
  if (s.bestReachMs && latest.reachMs.best > 0 && latest.reachMs.best <= s.bestReachMs) {
    out.push({
      id: "pb",
      tone: "positive",
      title: "New personal best",
      body: `Your fastest reach yet — ${latest.reachMs.best} ms. Speed under control is exactly the goal.`,
      metric: `${latest.reachMs.best} ms`,
      clinical: "Best single-rep movement time; tracks peak motor performance.",
    });
  }

  // 3) Consistency / streak.
  if (s.streakDays >= 2) {
    out.push({
      id: "streak",
      tone: "positive",
      title: `${s.streakDays}-day streak`,
      body: "Consistency is the strongest predictor of rehab outcomes — keep the run going.",
      metric: `${s.streakDays}d`,
      clinical: "Adherence (sessions/week) is the dominant driver of functional recovery.",
    });
  } else {
    out.push({
      id: "consistency",
      tone: "neutral",
      title: "Build the habit",
      body: `You've done ${s.weekSessions} session${s.weekSessions === 1 ? "" : "s"} this week. A short daily bout beats an occasional long one.`,
      clinical: "Frequent low-dose practice maximises motor consolidation.",
    });
  }

  // 4) Dose / volume.
  out.push({
    id: "volume",
    tone: "neutral",
    title: "Reaching volume",
    body: `${s.totalReaches} targets reached across ${s.totalSessions} session${s.totalSessions === 1 ? "" : "s"}. Range-of-motion repetitions add up.`,
    metric: `${s.totalReaches}`,
    clinical: "Total repetitions = cumulative ROM dose.",
  });

  // 5) Freeze-risk readout — honest, hedged.
  if (latest.fogRiskMean !== null) {
    const elevated = latest.fogRiskMean > 0.5;
    out.push({
      id: "fog",
      tone: elevated ? "watch" : "neutral",
      title: elevated ? "Freeze-risk readout elevated" : "Freeze-risk readout low",
      body: "Live preview from the on-device FoG model. This run uses an upper-limb signal, so treat it as a pipeline demonstration, not a clinical reading.",
      metric: `${Math.round(latest.fogRiskMean * 100)}%`,
      clinical: "Validated FoG needs a lower-limb/trunk sensor; shown here to prove the live model path.",
    });
  }

  return out;
}
