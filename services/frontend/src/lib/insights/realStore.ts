// Real (Supabase-backed) patient session history — server-only. Reads the caller's own completed
// sessions through patient_session_history (0024_patient_session_history.sql, SECURITY DEFINER, scoped
// via patients.profile_id = auth.uid()), then maps each row into the exact SessionRecord shape
// lib/insights/store.ts's localStorage mirror used to be the only source of — so computeInsights/summarize
// (lib/insights/engine.ts) and ProgressClient.tsx need no changes, only the data source swaps. Mirrors the
// RPC-to-typed-row pattern in lib/clinic/realData.ts.

import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { GaitMetrics, SessionRecord, Side } from "./types";

interface MetricsRow {
  reps?: number | null;
  quality_score?: number | null;
  fog_risk?: number | null;
  extras?: Record<string, unknown> | null;
}
interface SessionRow {
  id: string;
  started_at: string;
  ended_at: string | null;
  summary?: { mode?: string; side?: string; duration_s?: number } | null;
  metrics?: MetricsRow | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function mapRow(row: SessionRow): SessionRecord {
  const summary = row.summary ?? {};
  const extras = row.metrics?.extras ?? {};
  const exercise = summary.mode === "gait" ? "gait" : "reaching";
  const side: Side = summary.side === "left" ? "left" : "right";
  const startedAt = Date.parse(row.started_at) || Date.now();
  const endedAt = row.ended_at ? Date.parse(row.ended_at) || startedAt : startedAt;
  const durationSec = num(summary.duration_s) ?? Math.max(0, Math.round((endedAt - startedAt) / 1000));

  const gait: GaitMetrics | undefined =
    exercise === "gait"
      ? {
          steps: num(extras.gait_steps) ?? 0,
          beats: num(extras.gait_beats) ?? 0,
          cadenceSpm: num(extras.gait_cadence_spm) ?? 0,
          rhythmPct: num(extras.gait_rhythm_pct) ?? 0,
          bestStreak: num(extras.gait_best_streak) ?? 0,
        }
      : undefined;

  const fogSeries = Array.isArray(extras.fog_series) ? (extras.fog_series as number[]) : undefined;

  return {
    id: row.id,
    startedAt,
    endedAt,
    exercise,
    side,
    durationSec,
    reaches: num(extras.reaches) ?? 0,
    attempts: num(extras.attempts) ?? 0,
    reachMs: { mean: num(extras.reach_ms_mean) ?? 0, best: num(extras.reach_ms_best) ?? 0 },
    gait,
    fogRiskMean: num(row.metrics?.fog_risk),
    fogSeries,
    fogValid: extras.fog_valid === true,
    harTop: typeof extras.har_top === "string" ? extras.har_top : null,
    inferenceCount: num(extras.inference_count) ?? 0,
  };
}

/** The caller's real, completed session history — newest first. Empty when there is none yet. */
export async function loadRealSessions(limit = 200): Promise<SessionRecord[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("patient_session_history", { p_limit: limit });
  if (error || !Array.isArray(data)) return [];
  return (data as SessionRow[]).map(mapRow).sort((a, b) => a.startedAt - b.startedAt);
}
