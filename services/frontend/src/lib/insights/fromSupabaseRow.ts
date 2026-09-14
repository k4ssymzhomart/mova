// Shared mapping from a raw Supabase `sessions` (+ embedded `session_metrics`) row into
// the app's SessionRecord shape. Used by both the clinician portal (rows arrive via the
// clinic_caseload/clinic_patient_overview RPCs) and the patient-facing pages (rows come
// straight from a `sessions` table query) — one definition, so /progress, the session
// coach, and the clinician portal can never disagree about how a session is summarized.

import type { SessionRecord, Side } from "./types";

export interface MetricsRow {
  reps?: number | null;
  quality_score?: number | null;
  fog_risk?: number | null;
  rom_mean?: number | null;
}
export interface SessionRow {
  id: string;
  started_at: string;
  ended_at: string | null;
  summary?: { mode?: string; side?: string; duration_s?: number } | null;
  metrics?: MetricsRow | null;
}

export const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export function mapSession(row: SessionRow): SessionRecord {
  const startedAt = Date.parse(row.started_at) || Date.now();
  const endedAt = row.ended_at ? Date.parse(row.ended_at) || startedAt : startedAt;
  const summary = row.summary ?? {};
  const m = row.metrics ?? {};
  const exercise = summary.mode === "gait" ? "gait" : "reaching";
  const side: Side = summary.side === "left" ? "left" : "right";
  const durationSec =
    typeof summary.duration_s === "number"
      ? Math.max(0, Math.round(summary.duration_s))
      : Math.max(0, Math.round((endedAt - startedAt) / 1000));
  const reps = num(m.reps) ?? 0;
  const quality = num(m.quality_score);
  const fog = num(m.fog_risk);

  if (exercise === "gait") {
    const rhythmPct = quality != null ? Math.max(0, Math.min(1, quality)) : 0;
    const steps = reps;
    const beats = rhythmPct > 0 ? Math.round(steps / rhythmPct) : steps;
    return {
      id: row.id,
      startedAt,
      endedAt,
      exercise: "gait",
      side,
      durationSec,
      reaches: 0,
      attempts: beats,
      reachMs: { mean: 0, best: 0 },
      gait: { steps, beats, cadenceSpm: 0, rhythmPct, bestStreak: 0 },
      fogRiskMean: fog,
      fogValid: true,
      harTop: "walking",
      inferenceCount: 0,
    };
  }

  const attempts = quality != null && quality > 0 ? Math.round(reps / quality) : reps;
  return {
    id: row.id,
    startedAt,
    endedAt,
    exercise: "reaching",
    side,
    durationSec,
    reaches: reps,
    attempts,
    reachMs: { mean: 0, best: 0 },
    fogRiskMean: fog,
    fogValid: false,
    harTop: null,
    inferenceCount: 0,
  };
}
