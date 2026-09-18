// Heel Slide's score for the patient's own summary screen. Server-only, same shape as
// lib/clinic/heelSlideResult.ts: read the authoritative stored record (session_frames), compute once, and
// persist so a reload reads the same numbers back instead of recomputing them (and so the clinician side,
// which never recomputes, has a row to read at all).
//
// Computed and stored on the patient's own first visit to the summary screen, not inside
// finish_prescribed_session and not live during the exercise — see heelSlideStoredScore.ts's header for why
// the formulas run here rather than in SQL or in the browser during the session. A clinician opening a
// session the patient never viewed the summary for sees "not yet scored": accepted for v1, consistent with
// this app's preference for an honest gap over an invented number.
//
// Like _flow/load.ts, every read is filtered to the signed-in patient explicitly rather than trusting RLS
// alone (#20 is still open), and a failed query is "error", never silently "notScored".

import "server-only";

import type { BaselineWindow, StoredPitchPoint } from "@/lib/motion/flexion";
import { createClient } from "@/lib/supabase/server";

import { getExerciseConfig } from "./exerciseConfigs";
import {
  buildHeelSlideSessionResult,
  HEEL_SLIDE_DB_SLUG,
  sessionScoreFromRow,
  type StoredQualitySample,
} from "./heelSlideStoredScore";
import type { SessionResult } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type HeelSlideStoredScoreOutcome =
  | {
      kind: "ok";
      result: SessionResult;
      algorithmVersion: string;
      scoreVersion: string;
      scoreCapReason: string | null;
    }
  /** Not Heel Slide, the session hasn't finished yet, or it finished with no stored frames to score. */
  | { kind: "notScored" }
  | { kind: "error" };

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

type OneOrMany<T> = T | T[] | null | undefined;

/** PostgREST may return a to-one embed as an object or as a single-element array (same as _flow/load.ts). */
function one<T>(value: OneOrMany<T>): T | null {
  return (Array.isArray(value) ? (value[0] ?? null) : value) ?? null;
}

function doseReps(dose: unknown): number | null {
  if (!isRecord(dose)) return null;
  const reps = dose.reps;
  return typeof reps === "number" && Number.isInteger(reps) && reps > 0 ? reps : null;
}

function finiteWindow(raw: unknown): BaselineWindow | null {
  if (!isRecord(raw)) return null;
  const startMs = typeof raw.start === "number" && Number.isFinite(raw.start) ? raw.start : null;
  const endMs = typeof raw.end === "number" && Number.isFinite(raw.end) ? raw.end : null;
  return startMs === null || endMs === null ? null : { startMs, endMs };
}

/** summary.baseline_windows_ms: one { start, end } per start that took a zero, oldest first. Duplicated in
 *  miniature from lib/clinic/heelSlideView.ts's parseBaselineWindow(s) (not imported: that module is the
 *  clinician view and pulls in its own dependency chain) — keep the two in sync if the stored shape changes. */
function baselineWindows(raw: unknown): BaselineWindow[] {
  if (!Array.isArray(raw)) return [];
  const windows: BaselineWindow[] = [];
  for (const entry of raw) {
    const window = finiteWindow(entry);
    if (window) windows.push(window);
  }
  return windows;
}

function outcomeFromRow(row: JsonRecord): HeelSlideStoredScoreOutcome {
  const score = sessionScoreFromRow(row);
  if (!score) return { kind: "error" }; // a row exists but isn't a parseable Heel Slide score — never invent one
  return { kind: "ok", ...score };
}

/**
 * The signed-in patient's score for `sessionId`, computing and persisting it on first read. Returns the
 * already-stored row on every later read (store_session_score is idempotent on session_id) rather than
 * recomputing — a row's algorithm_version/score_version say which run produced it (NTZ AC-10).
 */
export async function loadHeelSlideStoredScore(sessionId: string): Promise<HeelSlideStoredScoreOutcome> {
  if (!UUID.test(sessionId)) return { kind: "notScored" };
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { kind: "notScored" };

  const { data: patientRow, error: patientError } = await supabase
    .from("patients")
    .select("id")
    .eq("profile_id", user.id)
    .maybeSingle();
  if (patientError) return { kind: "error" };
  if (!patientRow) return { kind: "notScored" };
  const patientId = patientRow.id as string;

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select(
      "id, status, summary, exercise:exercises(slug, scoring_rubric, default_dose), prescription:prescriptions(dose)",
    )
    .eq("id", sessionId)
    .eq("patient_id", patientId)
    .maybeSingle();
  if (sessionError) return { kind: "error" };
  if (!session) return { kind: "notScored" };
  if (session.status !== "completed") return { kind: "notScored" };

  const exercise = one<{ slug: string | null; scoring_rubric: unknown; default_dose: unknown }>(session.exercise);
  if (exercise?.slug !== HEEL_SLIDE_DB_SLUG) return { kind: "notScored" }; // scope: Heel Slide only (see plan)

  const existing = await supabase.from("session_scores").select("*").eq("session_id", sessionId).maybeSingle();
  if (existing.error) return { kind: "error" };
  if (existing.data) return outcomeFromRow(existing.data as JsonRecord);

  const { data: frames, error: framesError } = await supabase
    .from("session_frames")
    .select("recorded_at, imu, quality")
    .eq("session_id", sessionId)
    .eq("patient_id", patientId)
    .order("recorded_at", { ascending: true })
    .order("seq", { ascending: true });
  if (framesError) return { kind: "error" };
  if (!frames || frames.length === 0) return { kind: "notScored" };

  const thigh: StoredPitchPoint[] = [];
  const shank: StoredPitchPoint[] = [];
  const quality: StoredQualitySample[] = [];
  for (const row of frames) {
    const tMs = Date.parse(row.recorded_at as string);
    if (!Number.isFinite(tMs)) continue;
    const imu = isRecord(row.imu) ? row.imu : null;
    const euler = imu?.euler_deg;
    const pitch = Array.isArray(euler) && typeof euler[1] === "number" ? (euler[1] as number) : null;
    if (imu?.role === "thigh") thigh.push([tMs, pitch]);
    else if (imu?.role === "shank") shank.push([tMs, pitch]);
    quality.push({ tMs, quality: typeof row.quality === "number" ? row.quality : null });
  }

  const prescription = one<{ dose: unknown }>(session.prescription);
  const prescribedReps = doseReps(prescription?.dose) ?? doseReps(exercise.default_dose) ?? 0;
  const summary = isRecord(session.summary) ? session.summary : {};
  const windows = baselineWindows(summary.baseline_windows_ms);

  const config = getExerciseConfig("heel_slide");
  const score = buildHeelSlideSessionResult({
    config,
    series: { thigh, shank },
    qualitySamples: quality,
    prescribedReps,
    rubric: exercise.scoring_rubric,
    baselineWindow: finiteWindow(summary.baseline_window_ms),
    baselineWindows: windows.length ? windows : null,
  });

  const validReps = score.result.reps.filter((rep) => rep.validForVolume).length;
  const payload = {
    exercise_slug: score.result.exerciseSlug,
    algorithm_version: score.algorithmVersion,
    score_version: score.scoreVersion,
    signal_confidence: { frozen: score.result.frozen, frozen_reasons: score.result.frozenReasons },
    correctness_score: score.result.correctnessScore,
    volume_score: score.result.volumeScore,
    target_score: score.result.targetScore,
    execution_effectiveness: score.result.executionEffectiveness,
    target_reached_count: score.result.targetReachedCount,
    valid_reps: validReps,
    prescribed_reps: score.result.prescribedReps,
    rom_max_deg: score.result.romMaxDeg,
    rom_mean_deg: score.result.romMeanDeg,
    frozen: score.result.frozen,
    frozen_reasons: score.result.frozenReasons,
    score_cap_reason: score.scoreCapReason,
    reps: score.result.reps,
  };

  const stored = await supabase.rpc("store_session_score", { p_session: sessionId, p_score: payload });
  if (stored.error || !stored.data) return { kind: "error" };
  return outcomeFromRow(stored.data as JsonRecord);
}
