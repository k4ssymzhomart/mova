// Caseload metrics + risk flags. Pure derivations over a patient's real session history — adherence is
// measured against the prescribed weekly dose, and every flag maps to a concrete clinical signal the
// therapist can act on. Reuses the patient-side summarize() so the numbers match what the patient sees.

import { summarize } from "@/lib/insights/engine";

import type { CaseMetrics, ClinicPatient, RiskFlag } from "./types";

/** Mean freeze-risk over the most recent `n` in-distribution (gait) bouts, or null. */
function recentFreezeMean(p: ClinicPatient, n = 3): number | null {
  const valid = p.sessions.filter((s) => s.fogValid && s.fogRiskMean != null).slice(-n);
  if (!valid.length) return null;
  return valid.reduce((a, s) => a + (s.fogRiskMean ?? 0), 0) / valid.length;
}

export function computeCaseMetrics(p: ClinicPatient): CaseMetrics {
  const s = summarize(p.sessions);
  const dose = Math.max(1, p.prescription.weeklyDoseSessions);
  const adherencePct = Math.min(100, Math.round((s.weekSessions / dose) * 100));

  const flags: RiskFlag[] = [];

  const freeze = recentFreezeMean(p);
  if (freeze != null && freeze > 0.5) {
    flags.push({
      id: "freeze",
      severity: "high",
      label: "Elevated freeze-risk",
      detail: `Recent gait bouts average ${Math.round(freeze * 100)}% freeze-risk from the lower-limb FoG model.`,
    });
  }

  if (s.rhythmTrendPct != null && s.rhythmTrendPct < -10) {
    flags.push({
      id: "rhythm",
      severity: "watch",
      label: "Gait rhythm declining",
      detail: `On-beat stepping fell ${Math.abs(s.rhythmTrendPct)}% over recent sessions.`,
    });
  }

  if (s.reachTrendPct != null && s.reachTrendPct > 10) {
    flags.push({
      id: "reach",
      severity: "watch",
      label: "Reach speed slowing",
      detail: `Average reach time rose ${s.reachTrendPct}% — possible fatigue or regression.`,
    });
  }

  if (s.weekSessions < dose * 0.5) {
    flags.push({
      id: "adherence",
      severity: "watch",
      label: "Below prescribed dose",
      detail: `${s.weekSessions} of ${dose} prescribed sessions this week.`,
    });
  }

  if (!p.profile.baseline) {
    flags.push({
      id: "baseline",
      severity: "info",
      label: "Baseline not captured",
      detail: "No CV-guided ROM baseline on file — difficulty is running at a neutral default.",
    });
  }

  if (!flags.length) {
    flags.push({ id: "ontrack", severity: "info", label: "On track", detail: "No active alerts. Adherence and trends are within range." });
  }

  return {
    adherencePct,
    weekSessions: s.weekSessions,
    totalSessions: s.totalSessions,
    streakDays: s.streakDays,
    lastActiveAt: p.lastActiveAt,
    flags,
  };
}

/** Roster-level rollup for the overview header. */
export function caseloadSummary(patients: ClinicPatient[]) {
  const metrics = patients.map(computeCaseMetrics);
  const highAlerts = metrics.reduce((a, m) => a + m.flags.filter((f) => f.severity === "high").length, 0);
  const watchAlerts = metrics.reduce((a, m) => a + m.flags.filter((f) => f.severity === "watch").length, 0);
  const activeToday = patients.filter((p) => Date.now() - p.lastActiveAt < 86_400_000).length;
  const avgAdherence = metrics.length ? Math.round(metrics.reduce((a, m) => a + m.adherencePct, 0) / metrics.length) : 0;
  return { total: patients.length, highAlerts, watchAlerts, activeToday, avgAdherence };
}
