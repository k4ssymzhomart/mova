// Real clinician data — server-side. Reads the live caseload through the SECURITY DEFINER RPCs added in
// migration 0022 (clinic_caseload / clinic_patient_overview), then maps each row into the SAME
// ClinicPatient shape the portal's mock used, so every downstream view (PatientDetail, PatientReport,
// caseload metrics, FHIR bundle) runs unchanged on real data. The RPCs are clinic-scoped, so a caller
// only ever sees their own clinic's patients.

import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { SessionRecord, Side } from "@/lib/insights/types";
import type { AffectedSide, Condition, Pack, RomBaseline } from "@/lib/profile/types";

import type { ClinicPatient, Prescription } from "./types";

interface MetricsRow {
  reps?: number | null;
  quality_score?: number | null;
  fog_risk?: number | null;
  rom_mean?: number | null;
}
interface SessionRow {
  id: string;
  started_at: string;
  ended_at: string | null;
  summary?: { mode?: string; side?: string; duration_s?: number } | null;
  metrics?: MetricsRow | null;
}
interface CarePlanRow {
  pack?: string;
  weekly_dose_sessions?: number;
  target_cadence_spm?: number;
  difficulty?: number;
  note?: string;
  updated_at?: string;
}
interface CaseRow {
  patient_id: string;
  profile_id: string;
  name: string;
  email: string | null;
  mrn: string | null;
  date_of_birth: string | null;
  affected_side: string | null;
  enrollment_status: string;
  baseline: unknown;
  condition_slug: string | null;
  last_session_at: string | null;
  fog_count: number;
  care_plan: CarePlanRow | null;
  sessions: SessionRow[];
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function mapCondition(slug: string | null, sessions: SessionRecord[]): Condition {
  const s = (slug ?? "").toLowerCase();
  if (s.includes("park")) return "parkinsons";
  if (s.includes("stroke") || s.includes("cva")) return "stroke";
  if (s.includes("ortho") || s.includes("acl") || s.includes("post")) return "ortho";
  // Infer from training history when the catalog link is absent.
  return sessions.some((x) => x.exercise === "gait") ? "parkinsons" : "stroke";
}

function mapSide(raw: string | null): AffectedSide {
  if (raw === "left" || raw === "right") return raw;
  return "bilateral"; // 'bilateral' | 'none' | null
}

function mapBaseline(raw: unknown): RomBaseline | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const arm = b.armElevationDeg as RomBaseline["armElevationDeg"] | undefined;
  const knee = b.kneeRaiseDeg as RomBaseline["kneeRaiseDeg"] | undefined;
  if (!arm || !knee || typeof arm.left !== "number" || typeof knee.left !== "number") return null;
  return {
    capturedAt: typeof b.capturedAt === "number" ? b.capturedAt : Date.now(),
    armElevationDeg: arm,
    kneeRaiseDeg: knee,
    frames: typeof b.frames === "number" ? b.frames : 0,
  };
}

function mapSession(row: SessionRow): SessionRecord {
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

function ageFromDob(dob: string | null): number {
  if (!dob) return 0;
  const d = Date.parse(dob);
  if (!Number.isFinite(d)) return 0;
  return Math.max(0, Math.floor((Date.now() - d) / (365.25 * 86_400_000)));
}

function mapPatient(row: CaseRow): ClinicPatient {
  const sessions = (row.sessions ?? []).map(mapSession).sort((a, b) => a.startedAt - b.startedAt);
  const condition = mapCondition(row.condition_slug, sessions);
  const recommendedPack: Pack = condition === "parkinsons" ? "gait" : "reaching";
  const baseline = mapBaseline(row.baseline);

  const cp = row.care_plan;
  const prescription: Prescription = cp
    ? {
        pack: cp.pack === "gait" ? "gait" : "reaching",
        weeklyDoseSessions: cp.weekly_dose_sessions ?? 5,
        targetCadenceSpm: cp.target_cadence_spm ?? 67,
        difficulty: typeof cp.difficulty === "number" ? cp.difficulty : 0.5,
        note: cp.note ?? "",
        updatedAt: cp.updated_at ? Date.parse(cp.updated_at) || Date.now() : Date.now(),
      }
    : {
        pack: recommendedPack,
        weeklyDoseSessions: 5,
        targetCadenceSpm: 67,
        difficulty: 0.5,
        note: "",
        updatedAt: Date.now(),
      };

  const lastActiveAt =
    (row.last_session_at ? Date.parse(row.last_session_at) : 0) ||
    (sessions.length ? sessions[sessions.length - 1].startedAt : 0);

  return {
    demo: {
      name: row.name || "Patient",
      age: ageFromDob(row.date_of_birth),
      mrn: row.mrn || `MV-${row.patient_id.slice(0, 8).toUpperCase()}`,
    },
    profile: {
      // patient_id is the canonical id across the portal (routing + RPC writes key off it).
      id: row.patient_id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      condition,
      affectedSide: mapSide(row.affected_side),
      recommendedPack,
      baseline,
    },
    sessions,
    prescription,
    lastActiveAt,
  };
}

/** Real caseload for the signed-in clinician's clinic. Empty array when unauthenticated / no clinic. */
export async function fetchRoster(): Promise<ClinicPatient[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("clinic_caseload");
  if (error || !Array.isArray(data)) return [];
  return (data as CaseRow[]).map(mapPatient);
}

/** Real detail for one patient if they are in the caller's clinic, else null. */
export async function fetchPatient(patientId: string): Promise<ClinicPatient | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("clinic_patient_overview", { p_patient: patientId });
  if (error || !data || typeof data !== "object") return null;
  return mapPatient(data as CaseRow);
}
