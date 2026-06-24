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

/** Mean of the last `n` finite values from the tail-slice produced by `pick`. */
function meanOf(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x) && x > 0);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function summarize(sessions: SessionRecord[]): ProgressSummary {
  const totalSessions = sessions.length;
  const totalReaches = sessions.reduce((a, s) => a + s.reaches, 0);
  const totalSteps = sessions.reduce((a, s) => a + (s.gait?.steps ?? 0), 0);
  const now = Date.now();
  const weekSessions = sessions.filter((s) => now - s.startedAt < 7 * DAY).length;
  const reachMeans = sessions.map((s) => s.reachMs.mean).filter((v) => v > 0);
  const avgReachMs = reachMeans.length ? Math.round(reachMeans.reduce((a, b) => a + b, 0) / reachMeans.length) : null;
  const bestReachMs = sessions.length
    ? Math.min(...sessions.map((s) => s.reachMs.best).filter((v) => v > 0))
    : null;

  const gaitSessions = sessions.filter((s) => s.exercise === "gait" && s.gait);
  const cadences = gaitSessions.map((s) => s.gait!.cadenceSpm).filter((v) => v > 0);
  const bestCadenceSpm = cadences.length ? Math.max(...cadences) : null;

  let reachTrendPct: number | null = null;
  if (sessions.length >= 4) {
    const recent = meanOf(sessions.slice(-2).map((s) => s.reachMs.mean));
    const prior = meanOf(sessions.slice(-5, -2).map((s) => s.reachMs.mean));
    if (recent !== null && prior !== null && prior > 0) reachTrendPct = Math.round(((recent - prior) / prior) * 100);
  }

  let rhythmTrendPct: number | null = null;
  if (gaitSessions.length >= 4) {
    const recent = meanOf(gaitSessions.slice(-2).map((s) => s.gait!.rhythmPct));
    const prior = meanOf(gaitSessions.slice(-5, -2).map((s) => s.gait!.rhythmPct));
    if (recent !== null && prior !== null && prior > 0) rhythmTrendPct = Math.round(((recent - prior) / prior) * 100);
  }

  return {
    totalSessions,
    totalReaches,
    totalSteps,
    streakDays: streakDays(sessions),
    weekSessions,
    avgReachMs,
    bestReachMs: bestReachMs && isFinite(bestReachMs) ? bestReachMs : null,
    reachTrendPct,
    bestCadenceSpm,
    rhythmTrendPct,
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

  if (latest.exercise === "gait") {
    // 1g) Rhythm / on-beat stepping — the headline gait progression signal.
    if (s.rhythmTrendPct !== null) {
      const better = s.rhythmTrendPct > 0;
      out.push({
        id: "rhythm-trend",
        tone: better ? "positive" : s.rhythmTrendPct < -8 ? "watch" : "neutral",
        title: better ? "Your stepping is more on-beat" : "Rhythm held steady",
        body: better
          ? "You're landing more steps on the cue — steadier, better-timed gait."
          : "On-beat stepping is roughly stable. Keep matching the metronome; consistency moves this.",
        metric: `${s.rhythmTrendPct > 0 ? "+" : ""}${s.rhythmTrendPct}%`,
        clinical: "Rhythmic-cue adherence proxies gait timing / freezing resistance; upward is improvement.",
      });
    }

    // 2g) Cadence personal best.
    if (latest.gait && latest.gait.cadenceSpm > 0 && s.bestCadenceSpm && latest.gait.cadenceSpm >= s.bestCadenceSpm) {
      out.push({
        id: "cadence-best",
        tone: "positive",
        title: "Best cadence yet",
        body: `${latest.gait.cadenceSpm} steps/min at your top streak of ${latest.gait.bestStreak}. Smooth, sustained cadence is the goal.`,
        metric: `${latest.gait.cadenceSpm} spm`,
        clinical: "Sustained cadence tracks gait initiation and continuation — the functions FoG disrupts.",
      });
    }

    // 3g) Step dose.
    out.push({
      id: "steps",
      tone: "neutral",
      title: "Stepping volume",
      body: `${s.totalSteps} cued steps across your gait bouts. Repeated, timed weight-shifts are the rehab dose.`,
      metric: `${s.totalSteps}`,
      clinical: "Total cued steps = cumulative gait-training dose.",
    });
  } else {
    // 1r) Movement-speed trend (reach time) — the headline reaching progression signal.
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

    // 2r) Personal best.
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

    // 3r) Reaching dose.
    out.push({
      id: "volume",
      tone: "neutral",
      title: "Reaching volume",
      body: `${s.totalReaches} targets reached across your reaching bouts. Range-of-motion repetitions add up.`,
      metric: `${s.totalReaches}`,
      clinical: "Total repetitions = cumulative ROM dose.",
    });
  }

  // 4) Consistency / streak.
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

  // 5) Freeze-risk readout — honest, and now distribution-aware.
  if (latest.fogRiskMean !== null) {
    const elevated = latest.fogRiskMean > 0.5;
    if (latest.fogValid) {
      out.push({
        id: "fog",
        tone: elevated ? "watch" : "positive",
        title: elevated ? "Freeze-risk reading elevated" : "Freeze-risk reading low",
        body: elevated
          ? "Your lower-limb signal sat in a higher freeze-risk band this bout. Cue-based stepping is exactly the kind of practice that helps — keep going, and share trends with your clinician."
          : "Your lower-limb signal stayed in a low freeze-risk band across the bout. Steady, cued stepping is doing its job.",
        metric: `${Math.round(latest.fogRiskMean * 100)}%`,
        clinical: "Ankle/shank virtual IMU is in-distribution for the Daphnet-trained FoG model — research-grade, not a diagnosis.",
      });
    } else {
      out.push({
        id: "fog",
        tone: "neutral",
        title: "Freeze-risk readout (preview)",
        body: "This bout used an upper-limb signal, so the FoG number is a pipeline preview. Run a Gait & balance session for a clinically valid lower-limb reading.",
        metric: `${Math.round(latest.fogRiskMean * 100)}%`,
        clinical: "Validated FoG needs a lower-limb/trunk sensor; gait mode supplies one.",
      });
    }
  }

  return out;
}
