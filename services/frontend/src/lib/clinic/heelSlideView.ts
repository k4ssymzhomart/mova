// The clinician's view of one Heel Slide session, assembled from what clinician_session_result returns
// (migration 0034). Pure: no Supabase, no React, no runtime imports. The server loader (heelSlideResult.ts) does
// the two RPC calls and hands the motion functions in, so node:test can run the whole assembly with the real
// motion modules.
//
// What the clinician sees is recounted here, never read back from the patient's device: the stored thigh and
// shank pitch series are paired and oriented by lib/motion's batch rules and counted with the same state machine
// the exercise screen runs. The device's own count is carried separately so the view can say when the two differ.
//
// Honesty: the charted value is the flexion proxy, a relative orientation difference between two uncalibrated
// sensors. It is not knee flexion and nothing here turns it into a score. Anything the payload does not carry is
// null and is shown as unknown, never filled in.

import type { SensorRole } from "@/lib/ble/roles";
import type { PairingStats, ProxySample, StoredPitchPoint, StoredProxySeries } from "@/lib/motion/flexion";
import type { RepReason, RepReport, RepThresholds } from "@/lib/motion/reps";
import type { Locale } from "@/locales";

export const HEEL_SLIDE_SLUG = "heel-slide";

/** The chart never draws more points than this; the recount always runs on the full series. */
export const MAX_CHART_POINTS = 1500;

/** public.session_status (supabase/migrations/0002_schemas_and_enums.sql). */
export type SessionStatus = "scheduled" | "in_progress" | "completed" | "aborted" | "reviewed";
const SESSION_STATUSES: readonly SessionStatus[] = ["scheduled", "in_progress", "completed", "aborted", "reviewed"];

export type KneeFeels = "better" | "same" | "slightly_worse" | "much_worse";
const KNEE_FEELS: readonly KneeFeels[] = ["better", "same", "slightly_worse", "much_worse"];

export type Symptom = "swelling" | "redness" | "calf_pain" | "other";
const SYMPTOMS: readonly Symptom[] = ["swelling", "redness", "calf_pain", "other"];

export type RateFailure = "no_reply" | "mismatch" | "write_failed";
const RATE_FAILURES: readonly RateFailure[] = ["no_reply", "mismatch", "write_failed"];

const ROLES: readonly SensorRole[] = ["thigh", "shank", "foot"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function positiveInt(value: unknown): number | null {
  const n = count(value);
  return n !== null && n > 0 ? n : null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/** Ids reach the page from the URL; anything that is not a uuid cannot name a row. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

// --- session list ---------------------------------------------------------------------------------------------

export interface ReviewSessionItem {
  id: string;
  startedAt: string | null;
  endedAt: string | null;
  status: SessionStatus | null;
  exerciseSlug: string | null;
  /** Catalog name, shown verbatim. */
  exerciseName: string | null;
  hasCheckIn: boolean;
}

/** clinician_patient_sessions output. null means the caller may not review this patient (the RPC returns null). */
export function parseSessionList(raw: unknown): ReviewSessionItem[] | null {
  if (!Array.isArray(raw)) return null;
  const items: ReviewSessionItem[] = [];
  for (const row of raw) {
    if (!isRecord(row) || !isUuid(row.id)) continue;
    items.push({
      id: row.id,
      startedAt: str(row.started_at),
      endedAt: str(row.ended_at),
      status: oneOf(row.status, SESSION_STATUSES),
      exerciseSlug: str(row.exercise_slug),
      exerciseName: str(row.exercise_name),
      hasCheckIn: row.has_check_in === true,
    });
  }
  return items;
}

export type SessionPick =
  /** The patient has no Heel Slide session: the section is not rendered. */
  | { kind: "none" }
  | { kind: "selected"; sessions: ReviewSessionItem[]; selected: ReviewSessionItem }
  /** `?session=` named something that is not one of this patient's Heel Slide sessions. */
  | { kind: "unavailable"; sessions: ReviewSessionItem[] };

function startedMs(item: ReviewSessionItem): number {
  const ms = item.startedAt ? Date.parse(item.startedAt) : NaN;
  return Number.isFinite(ms) ? ms : -Infinity;
}

/**
 * Picks the session to show. Only this patient's Heel Slide sessions qualify, so a session id belonging to
 * another patient (whom the caller may also review) never renders under this patient's name. No request means
 * the newest one.
 */
export function pickHeelSlideSession(list: readonly ReviewSessionItem[], requested: string | undefined): SessionPick {
  const sessions = list
    .filter((item) => item.exerciseSlug === HEEL_SLIDE_SLUG)
    .sort((a, b) => startedMs(b) - startedMs(a));
  if (!sessions.length) return { kind: "none" };
  if (requested === undefined || requested === "") return { kind: "selected", sessions, selected: sessions[0] };
  const selected = sessions.find((item) => item.id === requested);
  return selected ? { kind: "selected", sessions, selected } : { kind: "unavailable", sessions };
}

// --- series helpers -------------------------------------------------------------------------------------------

/** frames.thigh / frames.shank: [[t_ms, pitch_deg], …]. Malformed entries are dropped, not repaired. */
export function parsePitchSeries(raw: unknown): StoredPitchPoint[] {
  if (!Array.isArray(raw)) return [];
  const points: StoredPitchPoint[] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const tMs = finite(entry[0]);
    if (tMs === null) continue;
    points.push([tMs, finite(entry[1])]);
  }
  return points;
}

/**
 * Frames per second actually stored for one role: (n − 1) intervals over the span between the first and last
 * stored timestamp. recorded_at is the browser's receive time, so this includes Bluetooth jitter and any gap.
 * null when fewer than two timestamps or no span.
 */
export function deliveredHz(points: readonly StoredPitchPoint[]): number | null {
  let first = Infinity;
  let last = -Infinity;
  let n = 0;
  for (const [tMs] of points) {
    if (!Number.isFinite(tMs)) continue;
    n += 1;
    if (tMs < first) first = tMs;
    if (tMs > last) last = tMs;
  }
  if (n < 2 || !(last > first)) return null;
  return (n - 1) / ((last - first) / 1000);
}

/**
 * At most `maxPoints` samples for drawing. The series is cut into maxPoints / 2 equal runs of samples and each
 * run keeps its lowest and highest sample, in time order. Plain decimation would skip rep peaks; this keeps
 * every excursion's extreme visible.
 */
export function downsampleMinMax(samples: readonly ProxySample[], maxPoints: number = MAX_CHART_POINTS): ProxySample[] {
  if (!(maxPoints >= 2)) throw new RangeError("maxPoints must be at least 2");
  if (samples.length <= maxPoints) return samples.slice();
  const buckets = Math.floor(maxPoints / 2);
  const n = samples.length;
  const out: ProxySample[] = [];
  for (let b = 0; b < buckets; b += 1) {
    const from = Math.floor((b * n) / buckets);
    const to = Math.floor(((b + 1) * n) / buckets);
    if (from >= to) continue;
    let lo = from;
    let hi = from;
    for (let i = from + 1; i < to; i += 1) {
      if (samples[i].value < samples[lo].value) lo = i;
      if (samples[i].value > samples[hi].value) hi = i;
    }
    if (lo === hi) out.push(samples[lo]);
    else if (lo < hi) out.push(samples[lo], samples[hi]);
    else out.push(samples[hi], samples[lo]);
  }
  return out;
}

/** Axis ticks on a 1 / 2 / 5 × 10^k step that cover [min, max]. Empty for non-finite input. */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  let lo = Math.min(min, max);
  let hi = Math.max(min, max);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const raw = (hi - lo) / Math.max(1, Math.round(target));
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  const first = Math.floor(lo / step);
  const last = Math.ceil(hi / step);
  const ticks: number[] = [];
  for (let k = first; k <= last; k += 1) {
    const value = Math.round(k * step * 1e6) / 1e6;
    ticks.push(value === 0 ? 0 : value);
  }
  return ticks;
}

/** Decimal for display. Kazakh shares Russian's separators (space grouping, comma decimal), and ICU may lack kk. */
export function formatDecimal(value: number, locale: Locale, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat(locale === "en" ? "en-GB" : "ru-RU", { maximumFractionDigits }).format(value);
}

/** A WitMotion rate code as the protocol docs write it, e.g. 0x08. */
export function hexCode(code: number): string {
  return `0x${code.toString(16).toUpperCase().padStart(2, "0")}`;
}

// --- device_info ----------------------------------------------------------------------------------------------

export type RateReadout =
  | { status: "confirmed"; requestedHz: number | null }
  | { status: "unconfirmed"; requestedHz: number | null; failure: RateFailure | null; readbackCode: number | null }
  /** Rate setup was still running when the session started. */
  | { status: "pending"; requestedHz: number | null }
  | { status: "unknown" };

function pick(record: JsonRecord, camel: string, snake: string): unknown {
  return record[camel] !== undefined ? record[camel] : record[snake];
}

/**
 * One role's rate readback as the sensors step stored it in device_info.roles[role].rate: a SampleRateResult,
 * the live store's RateState wrapping one, or its snake_case form. Anything else is unknown.
 */
export function parseRateReadout(raw: unknown): RateReadout {
  if (!isRecord(raw)) return { status: "unknown" };
  if (raw.status === "done" && isRecord(raw.result)) return parseRateReadout(raw.result);
  const requestedHz = finite(pick(raw, "requestedHz", "requested_hz"));
  if (raw.status === "configuring") return { status: "pending", requestedHz };
  if (raw.confirmed === true) return { status: "confirmed", requestedHz };
  if (raw.confirmed !== false) return { status: "unknown" };
  const readback = pick(raw, "readbackCode", "readback_code");
  return {
    status: "unconfirmed",
    requestedHz,
    failure: oneOf(raw.failure, RATE_FAILURES),
    readbackCode: count(readback),
  };
}

// --- check-in -------------------------------------------------------------------------------------------------

export interface CheckInAnswers {
  painBefore: number | null;
  painAfter: number | null;
  difficulty: number | null;
  kneeFeels: KneeFeels | null;
  /** Empty: the patient chose "none". */
  symptoms: Symptom[];
  otherNote: string | null;
  language: Locale | null;
  submittedAt: string | null;
}

function scale(value: unknown): number | null {
  const n = count(value);
  return n !== null && n <= 10 ? n : null;
}

export function parseCheckIn(raw: unknown): CheckInAnswers | null {
  if (!isRecord(raw)) return null;
  const symptoms = Array.isArray(raw.symptoms)
    ? SYMPTOMS.filter((symptom) => (raw.symptoms as unknown[]).includes(symptom))
    : [];
  return {
    painBefore: scale(raw.pain_before),
    painAfter: scale(raw.pain_after),
    difficulty: scale(raw.difficulty),
    kneeFeels: oneOf(raw.knee_feels, KNEE_FEELS),
    symptoms,
    otherNote: str(raw.other_note),
    language: oneOf(raw.language, ["ru", "kk", "en"] as const),
    submittedAt: str(raw.submitted_at),
  };
}

// --- the view -------------------------------------------------------------------------------------------------

/** lib/motion, passed in by the caller (see the header). */
export interface MotionDeps {
  buildStoredProxySeries(series: {
    thigh: readonly StoredPitchPoint[];
    shank: readonly StoredPitchPoint[];
  }): StoredProxySeries;
  countOrientedRepetitions(samples: readonly ProxySample[], options?: Partial<RepThresholds>): RepReport;
  heelSlideThresholds(rubric: unknown): RepThresholds;
}

export interface RoleTechnical {
  role: SensorRole;
  /** Every stored frame for the role, including frames whose pitch was missing. */
  storedFrames: number | null;
  /** From stored timestamps. Always null for the foot: the result carries its count, not its times. */
  deliveredHz: number | null;
  deviceName: string | null;
  rate: RateReadout;
}

export interface HeelSlideView {
  patientName: string | null;
  session: {
    id: string;
    status: SessionStatus | null;
    startedAt: string | null;
    endedAt: string | null;
    durationMs: number | null;
  };
  exerciseName: string | null;
  /** Prescribed reps, else the exercise's default dose. */
  targetReps: number | null;
  recount: {
    /** null when there were too few paired samples to count at all. */
    count: number | null;
    reason: RepReason | null;
    thresholds: RepThresholds;
  };
  /** summary.reps_counted_on_device, as the patient's screen counted it. */
  deviceCount: number | null;
  chart: {
    points: ProxySample[];
    totalPoints: number;
    segments: { startMs: number; endMs: number }[];
    startMs: number | null;
    endMs: number | null;
  };
  roles: RoleTechnical[];
  pairing: PairingStats;
  /** summary.telemetry.pending_at_finish: frames still unsent when the patient finished. */
  pendingAtFinish: number | null;
  checkIn: CheckInAnswers | null;
}

function durationBetween(startedAt: string | null, endedAt: string | null): number | null {
  if (!startedAt || !endedAt) return null;
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
}

/**
 * clinician_session_result output to the view. null when the payload is not a session result, or belongs to a
 * patient other than `expectedPatientId`.
 */
export function buildHeelSlideView(
  raw: unknown,
  motion: MotionDeps,
  { expectedPatientId, maxChartPoints = MAX_CHART_POINTS }: { expectedPatientId?: string; maxChartPoints?: number } = {},
): HeelSlideView | null {
  if (!isRecord(raw) || !isRecord(raw.session) || !isUuid(raw.session.id)) return null;
  const session = raw.session;
  if (expectedPatientId !== undefined && session.patient_id !== expectedPatientId) return null;

  const exercise = isRecord(raw.exercise) ? raw.exercise : null;
  const prescription = isRecord(raw.prescription) ? raw.prescription : null;
  const frames = isRecord(raw.frames) ? raw.frames : {};
  const frameCounts = isRecord(raw.frame_counts) ? raw.frame_counts : {};
  const summary = isRecord(session.summary) ? session.summary : {};
  const deviceInfo = isRecord(session.device_info) ? session.device_info : {};
  const deviceRoles = isRecord(deviceInfo.roles) ? deviceInfo.roles : {};
  const telemetry = isRecord(summary.telemetry) ? summary.telemetry : {};

  const thigh = parsePitchSeries(frames.thigh);
  const shank = parsePitchSeries(frames.shank);
  const series = motion.buildStoredProxySeries({ thigh, shank });
  const thresholds = motion.heelSlideThresholds(exercise?.scoring_rubric);
  const reps = motion.countOrientedRepetitions(series.samples, thresholds);

  const dose = isRecord(prescription?.dose) ? prescription.dose : {};
  const defaultDose = isRecord(exercise?.default_dose) ? exercise.default_dose : {};
  const startedAt = str(session.started_at);
  const endedAt = str(session.ended_at);
  const samples = series.samples;

  const roles = ROLES.map((role): RoleTechnical => {
    const device = isRecord(deviceRoles[role]) ? deviceRoles[role] : {};
    return {
      role,
      storedFrames: count(frameCounts[role]),
      deliveredHz: role === "thigh" ? deliveredHz(thigh) : role === "shank" ? deliveredHz(shank) : null,
      deviceName: str(pick(device, "deviceName", "device_name")),
      rate: parseRateReadout(device.rate),
    };
  });

  return {
    patientName: isRecord(raw.patient) ? str(raw.patient.name) : null,
    session: {
      id: session.id as string,
      status: oneOf(session.status, SESSION_STATUSES),
      startedAt,
      endedAt,
      durationMs: durationBetween(startedAt, endedAt),
    },
    exerciseName: exercise ? str(exercise.name) : null,
    targetReps: positiveInt(dose.reps) ?? positiveInt(defaultDose.reps),
    recount: {
      count: reps.reason === "insufficient_samples" ? null : reps.count,
      reason: reps.reason,
      thresholds,
    },
    deviceCount: count(summary.reps_counted_on_device),
    chart: {
      points: downsampleMinMax(samples, maxChartPoints),
      totalPoints: samples.length,
      segments: reps.segments.map(({ startMs, endMs }) => ({ startMs, endMs })),
      startMs: samples.length ? samples[0].tMs : null,
      endMs: samples.length ? samples[samples.length - 1].tMs : null,
    },
    roles,
    pairing: series.pairing,
    pendingAtFinish: count(telemetry.pending_at_finish),
    checkIn: parseCheckIn(raw.check_in),
  };
}
