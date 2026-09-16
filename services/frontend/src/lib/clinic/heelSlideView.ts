// The clinician's view of one Heel Slide session, assembled from what clinician_session_result returns
// (migration 0034). Pure: no Supabase, no React, no runtime imports. The server loader (heelSlideResult.ts) does
// the two RPC calls and hands the motion functions in, so node:test can run the whole assembly with the real
// motion modules.
//
// What the clinician sees is recounted here, never read back from the patient's device: the stored thigh and
// shank pitch series are paired and oriented by lib/motion's batch rules and counted with the same state machine
// the exercise screen runs, pause rule included. Every press of «Начать» took its own zero, and a reload started the
// device's count over, so the recount is split the same way: summary.baseline_windows_ms lists each start's zero
// window, each start is counted from its window up to the next start on its own zero, and the counts are added.
// Frames before the first start are drawn and not counted. Older summaries carry only baseline_window_ms, the latest
// start's window, and are recounted from it alone. The device's own count covers only the latest start, so the view
// compares it with the recount only when the session had a single start.
//
// Sensor facts come from two records the patient's app writes: device_info when the session starts, and
// summary.sensors when it finishes. The finish record wins, because a sensor can reconnect, be swapped or be
// re-rated during the session; a value known only from the start is marked as such.
//
// Honesty: the charted value is the flexion proxy, a relative orientation difference between two uncalibrated
// sensors. It is not knee flexion and nothing here turns it into a score. Anything the payload does not carry is
// null and is shown as unknown, never filled in. A session recorded on the simulated transport is flagged, so the page
// can say on every part of it that the data came from the program and not from sensors.

import type { SensorRole } from "@/lib/ble/roles";
import type {
  BaselineWindow,
  PairingStats,
  ProxySample,
  StoredPitchPoint,
  StoredProxySeries,
} from "@/lib/motion/flexion";
import type { RepCounterOptions, RepReason, RepReport, RepThresholds } from "@/lib/motion/reps";
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

/** The live store shows the last six characters of BluetoothDevice.id; the start record keeps the whole id. */
const DEVICE_ID_SHORT_LENGTH = 6;

/** A plausible battery voltage from register 0x64 (lib/ble/witRegister.ts accepts up to 10 V). */
const MAX_BATTERY_VOLTS = 10;

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

function record(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

/** Ids reach the page from the URL; anything that is not a uuid cannot name a row. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/**
 * Whether the session ran on the simulated sensor transport (a development server started with
 * NEXT_PUBLIC_SENSOR_SIMULATION=1, for recording the path without hardware): the start record says
 * device_info.transport "simulated", or the finish record says summary.simulated true. Either one is enough, because
 * a session that never finished has only the start record. Its frames were made by the program, not by sensors.
 */
export function isSimulatedSession(session: unknown): boolean {
  if (!isRecord(session)) return false;
  return record(session.device_info).transport === "simulated" || record(session.summary).simulated === true;
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

export type SessionListOutcome =
  /** The call failed: transport, PostgREST, or the function is missing. Never read as "no sessions". */
  | { kind: "error" }
  /** The RPC answered null: the caller may not review this patient. */
  | { kind: "not_allowed" }
  | { kind: "ok"; sessions: ReviewSessionItem[] };

/**
 * What a clinician_patient_sessions response means. The RPC answers an unauthorised caller with null and no error,
 * so an error is always a failed read and has to be shown as one.
 */
export function sessionListOutcome(response: { data: unknown; error: unknown }): SessionListOutcome {
  if (response.error) return { kind: "error" };
  const sessions = parseSessionList(response.data);
  return sessions ? { kind: "ok", sessions } : { kind: "not_allowed" };
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

/** Receive-time offsets between two sensors' stored frames. */
export interface SkewStats {
  /** Frames of the measured sensor. */
  frames: number;
  medianMs: number;
  /** Nearest-rank 95th percentile. */
  p95Ms: number;
  maxMs: number;
}

function sortedTimes(points: readonly StoredPitchPoint[]): number[] {
  const times: number[] = [];
  for (const [tMs] of points) if (Number.isFinite(tMs)) times.push(tMs);
  return times.sort((a, b) => a - b);
}

/**
 * For every `measured` frame, the time to the `reference` frame received nearest to it, with no cap: how far apart
 * two sensors' frames arrive. This is not the recount's pairing skew, which leaves out anything past the pairing
 * tolerance and so can never show a gap. Receive times, so Bluetooth delays and dropouts are included. null when
 * either side has no frame.
 */
export function nearestOffsetStats(
  reference: readonly StoredPitchPoint[],
  measured: readonly StoredPitchPoint[],
): SkewStats | null {
  const ref = sortedTimes(reference);
  const times = sortedTimes(measured);
  if (!ref.length || !times.length) return null;
  const offsets: number[] = [];
  let latestNotAfter = 0;
  for (const tMs of times) {
    while (latestNotAfter + 1 < ref.length && ref[latestNotAfter + 1] <= tMs) latestNotAfter += 1;
    let offset = Math.abs(ref[latestNotAfter] - tMs);
    if (latestNotAfter + 1 < ref.length) offset = Math.min(offset, Math.abs(ref[latestNotAfter + 1] - tMs));
    offsets.push(offset);
  }
  offsets.sort((a, b) => a - b);
  const n = offsets.length;
  const middle = Math.floor(n / 2);
  return {
    frames: n,
    medianMs: n % 2 ? offsets[middle] : (offsets[middle - 1] + offsets[middle]) / 2,
    p95Ms: offsets[Math.ceil(0.95 * n) - 1],
    maxMs: offsets[n - 1],
  };
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

/** A duration as m:ss, e.g. 1:05. Negative input is taken as its size. */
export function clockDuration(ms: number): string {
  const totalS = Math.round(Math.abs(ms) / 1000);
  return `${Math.floor(totalS / 60)}:${String(totalS % 60).padStart(2, "0")}`;
}

// --- sensor records -------------------------------------------------------------------------------------------

export type RateReadout =
  | { status: "confirmed"; requestedHz: number | null }
  | { status: "unconfirmed"; requestedHz: number | null; failure: RateFailure | null; readbackCode: number | null }
  /** Rate setup was still running when the record was taken (only the start record can say this). */
  | { status: "pending"; requestedHz: number | null }
  | { status: "unknown" };

function pick(source: JsonRecord, camel: string, snake: string): unknown {
  return source[camel] !== undefined ? source[camel] : source[snake];
}

/**
 * One rate readback as the patient's app stores it: device_info.roles[role].rate (a SampleRateResult, the live
 * store's RateState wrapping one, or their snake_case form), or one summary.sensors[role].rate_history entry.
 * Anything else is unknown.
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

export interface RateCheck {
  /** Epoch ms on the patient's device clock; null when not recorded. */
  atMs: number | null;
  readout: RateReadout;
}

/** summary.sensors[role].rate_history, oldest first. null when the record carries no history at all. */
export function parseRateHistory(raw: unknown, requestedHz: number | null): RateCheck[] | null {
  if (!Array.isArray(raw)) return null;
  const checks: RateCheck[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    checks.push({
      atMs: finite(pick(entry, "atMs", "at_ms")),
      readout: parseRateReadout({
        confirmed: entry.confirmed,
        readback_code: pick(entry, "readbackCode", "readback_code"),
        failure: entry.failure,
        requested_hz: requestedHz,
      }),
    });
  }
  return checks;
}

export interface BatteryValue {
  volts: number;
  /** WitMotion's interpolation table, not a measured charge. null when absent or out of range. */
  vendorPercent: number | null;
}

/** A battery reading as stored ({ volts, vendor_percent }). A missing, zero or implausible voltage is unknown. */
export function parseBattery(raw: unknown): BatteryValue | null {
  if (!isRecord(raw)) return null;
  const volts = finite(raw.volts);
  if (volts === null || volts <= 0 || volts > MAX_BATTERY_VOLTS) return null;
  const percent = finite(pick(raw, "vendorPercent", "vendor_percent"));
  return { volts, vendorPercent: percent !== null && percent >= 0 && percent <= 100 ? percent : null };
}

export interface DeviceIdentity {
  /** Advertised name; the three units usually share one. */
  name: string | null;
  /** Last six characters of the browser's BluetoothDevice.id. */
  idShort: string | null;
}

function shortId(value: unknown): string | null {
  const id = str(value);
  return id ? id.slice(-DEVICE_ID_SHORT_LENGTH) : null;
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
  buildStoredProxySeries(
    series: { thigh: readonly StoredPitchPoint[]; shank: readonly StoredPitchPoint[] },
    options?: {
      maxSkewMs?: number;
      baselineWindow?: BaselineWindow | null;
      baselineWindows?: readonly BaselineWindow[] | null;
    },
  ): StoredProxySeries;
  countOrientedRepetitions(samples: readonly ProxySample[], options?: RepCounterOptions): RepReport;
  heelSlideThresholds(rubric: unknown): RepThresholds;
  /** reps.ts MAX_REP_GAP_MS: a pause in the samples longer than this discards an open rep, live and here. */
  maxRepGapMs: number;
  /** flexion.ts DEFAULT_MAX_PAIR_SKEW_MS: thigh and shank frames further apart are not paired for the recount. */
  maxPairSkewMs: number;
}

export interface RoleTechnical {
  role: SensorRole;
  /** Every stored frame for the role, including frames whose pitch was missing. */
  storedFrames: number | null;
  /** From stored timestamps. Always null for the foot: the result carries its count, not its times. */
  deliveredHz: number | null;
  /** The device at finish when recorded, else the one recorded at start. */
  device: DeviceIdentity;
  deviceSource: "finish" | "start" | null;
  /** The device recorded at start, only when its id differs from the one recorded at finish. */
  deviceAtStartIfChanged: DeviceIdentity | null;
  requestedHz: number | null;
  /** The latest readback: the session's last rate check when recorded, else the one recorded at start. */
  rate: RateReadout;
  rateSource: "finish" | "start";
  /** Every rate check the device recorded, oldest first. null when the finish record carries none. */
  rateChecks: RateCheck[] | null;
  batteryStart: BatteryValue | null;
  batteryEnd: BatteryValue | null;
  /** Times the link to this device came back after dropping; null when not recorded. */
  reconnects: number | null;
}

/** One press of «Начать» that took a zero, recounted on that zero. */
export interface StartRecount {
  /** 1 for the first start, in time order. */
  number: number;
  /** Where its zero window begins: epoch ms, the receive-time clock of the patient's device. */
  windowStartMs: number;
  /** false when the saved window holds no stored pair, so this start could not be recounted. */
  zeroFound: boolean;
  /** null when not recounted: no zero, or too few paired samples to count. */
  count: number | null;
  /** Stored pairs from this start's window up to the next start. */
  pairs: number;
}

export interface HeelSlideView {
  patientName: string | null;
  session: {
    id: string;
    status: SessionStatus | null;
    startedAt: string | null;
    endedAt: string | null;
    durationMs: number | null;
    /** Recorded on the simulated transport: no frame came from a sensor. See isSimulatedSession. */
    simulated: boolean;
  };
  exerciseName: string | null;
  /** Prescribed reps, else the exercise's default dose. */
  targetReps: number | null;
  recount: {
    /** The sum over every start. null when no start had enough paired samples to count at all. */
    count: number | null;
    reason: RepReason | null;
    thresholds: RepThresholds;
    maxGapMs: number;
    /** Reps discarded because the data paused while they were open. */
    cancelled: number;
    baseline: {
      /** "window": zeroed on the saved start windows; "first_samples": on the first stored half second. */
      source: "window" | "first_samples";
      /** false when no saved window holds a stored pair, so nothing could be zeroed or counted. */
      zeroFound: boolean;
      /** Paired samples before the first start's window: drawn, not counted. */
      pairsBeforeWindow: number;
    };
    /** One per saved start, in time order, with "window". Empty with "first_samples". */
    starts: StartRecount[];
  };
  /** summary.reps_counted_on_device, as the patient's screen counted it: the latest start only. */
  deviceCount: number | null;
  /** summary.restarted_after_reload; null when not recorded. */
  restartedAfterReload: boolean | null;
  chart: {
    /** The recounted samples, one line per start with a zero (one line for "first_samples"), capped for drawing. */
    counted: ProxySample[][];
    /** Stored pairs drawn but not recounted: before the first start, and each start without a zero. Capped. */
    uncounted: ProxySample[][];
    /** Some pairs are drawn from before the first start. */
    beforeStart: boolean;
    /** Some uncounted line is zeroed on its own first half second, because a start's zero window held no stored pair. */
    ownZero: boolean;
    /** Where each start's zero window begins, when the session had more than one start. */
    startMarksMs: number[];
    /** Samples behind all lines before capping: every stored pair. */
    totalPoints: number;
    segments: { startMs: number; endMs: number }[];
    startMs: number | null;
    endMs: number | null;
  };
  roles: RoleTechnical[];
  /** The recount's pairing: its skew figures never exceed `pairingToleranceMs`. */
  pairing: PairingStats;
  pairingToleranceMs: number;
  /** Receive-time skew between sensors with no cap. Thigh and shank only: the result carries no foot frame times. */
  interSensorSkew: { thighShank: SkewStats | null };
  /** summary.telemetry: the device's own counters when the patient finished. */
  telemetry: {
    /** Rows the server reported receiving. Older summaries without this field are unknown, not zero. */
    framesConfirmed: number | null;
    pendingAtFinish: number | null;
    errors: number | null;
    dropped: number | null;
  };
  checkIn: CheckInAnswers | null;
}

function durationBetween(startedAt: string | null, endedAt: string | null): number | null {
  if (!startedAt || !endedAt) return null;
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
}

/** summary.baseline_window_ms { start, end } as the motion window, or null. flexion.ts rejects an empty span. */
export function parseBaselineWindow(raw: unknown): BaselineWindow | null {
  if (!isRecord(raw)) return null;
  const startMs = finite(raw.start);
  const endMs = finite(raw.end);
  return startMs === null || endMs === null ? null : { startMs, endMs };
}

/**
 * summary.baseline_windows_ms: one { start, end } per start that took a zero, in order. null when the summary has no
 * list (sessions saved before it existed); malformed entries are dropped.
 */
export function parseBaselineWindows(raw: unknown): BaselineWindow[] | null {
  if (!Array.isArray(raw)) return null;
  const windows: BaselineWindow[] = [];
  for (const entry of raw) {
    const window = parseBaselineWindow(entry);
    if (window) windows.push(window);
  }
  return windows;
}

export type DeviceCountNote = "missing" | "last_start_only" | "same" | "differs";

/**
 * How the patient device's own count relates to the recount. The device count covers only the latest start (a
 * reload starts it over), so with more than one start it is never compared with the sum.
 */
export function deviceCountNote(view: Pick<HeelSlideView, "deviceCount" | "recount">): DeviceCountNote {
  if (view.deviceCount === null) return "missing";
  if (view.recount.starts.length > 1) return "last_start_only";
  return view.recount.count !== null && view.deviceCount === view.recount.count ? "same" : "differs";
}

/**
 * How many of the chart's points each line gets, within `maxPoints`: in proportion to its samples, at least two
 * each. The total stays within the cap while it allows two points per line.
 */
function lineBudgets(lengths: readonly number[], maxPoints: number): number[] {
  const total = lengths.reduce((sum, n) => sum + n, 0);
  if (total <= maxPoints) return lengths.slice();
  const budgets = lengths.map((n) => Math.min(n, Math.max(2, Math.floor((maxPoints * n) / total))));
  let over = budgets.reduce((sum, n) => sum + n, 0) - maxPoints;
  while (over > 0) {
    let largest = -1;
    budgets.forEach((n, i) => {
      if (n > 2 && (largest < 0 || n > budgets[largest])) largest = i;
    });
    if (largest < 0) break;
    const take = Math.min(over, budgets[largest] - 2);
    budgets[largest] -= take;
    over -= take;
  }
  return budgets;
}

function roleTechnical(
  role: SensorRole,
  start: JsonRecord,
  finish: JsonRecord | null,
  storedFrames: number | null,
  storedHz: number | null,
): RoleTechnical {
  const startDevice: DeviceIdentity = {
    name: str(pick(start, "deviceName", "device_name")),
    idShort: shortId(pick(start, "deviceId", "device_id")),
  };
  const finishDevice: DeviceIdentity | null = finish
    ? { name: str(finish.device_name), idShort: str(finish.device_id_short) }
    : null;
  const finishKnown = finishDevice !== null && (finishDevice.name !== null || finishDevice.idShort !== null);
  const startKnown = startDevice.name !== null || startDevice.idShort !== null;
  const changed =
    finishDevice?.idShort != null && startDevice.idShort !== null && finishDevice.idShort !== startDevice.idShort;

  const startRate = parseRateReadout(start.rate);
  const startRequested = startRate.status === "unknown" ? null : startRate.requestedHz;
  const requestedHz = (finish ? finite(finish.requested_hz) : null) ?? startRequested;
  const rateChecks = finish ? parseRateHistory(finish.rate_history, requestedHz) : null;
  const latest = rateChecks ? [...rateChecks].reverse().find((check) => check.readout.status !== "unknown") : undefined;

  return {
    role,
    storedFrames,
    deliveredHz: storedHz,
    device: finishKnown ? (finishDevice as DeviceIdentity) : startDevice,
    deviceSource: finishKnown ? "finish" : startKnown ? "start" : null,
    deviceAtStartIfChanged: changed ? startDevice : null,
    requestedHz,
    rate: latest ? latest.readout : startRate,
    rateSource: latest ? "finish" : "start",
    rateChecks,
    batteryStart: (finish ? parseBattery(finish.battery_start) : null) ?? parseBattery(start.battery),
    batteryEnd: finish ? parseBattery(finish.battery_end) : null,
    reconnects: finish ? count(finish.reconnects) : null,
  };
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
  const frames = record(raw.frames);
  const frameCounts = record(raw.frame_counts);
  const summary = record(session.summary);
  const deviceRoles = record(record(session.device_info).roles);
  const summarySensors = isRecord(summary.sensors) ? summary.sensors : null;
  const telemetry = record(summary.telemetry);

  const thigh = parsePitchSeries(frames.thigh);
  const shank = parsePitchSeries(frames.shank);
  const series = motion.buildStoredProxySeries(
    { thigh, shank },
    {
      maxSkewMs: motion.maxPairSkewMs,
      baselineWindow: parseBaselineWindow(summary.baseline_window_ms),
      baselineWindows: parseBaselineWindows(summary.baseline_windows_ms),
    },
  );
  const thresholds = motion.heelSlideThresholds(exercise?.scoring_rubric);
  const counting = { ...thresholds, maxGapMs: motion.maxRepGapMs };

  // One count per start, each on its own zero; a start without a zero is not counted. "first_samples" is one span.
  const byWindow = series.baselineSource === "window";
  const reports: Array<RepReport | null> = byWindow
    ? series.starts.map((start) =>
        start.baselineDeg === null ? null : motion.countOrientedRepetitions(start.samples, counting),
      )
    : [motion.countOrientedRepetitions(series.samples, counting)];
  const isCountable = (report: RepReport | null): report is RepReport =>
    report !== null && report.reason !== "insufficient_samples";
  const countable = reports.filter(isCountable);
  const counted = countable.length ? countable.reduce((sum, report) => sum + report.count, 0) : null;
  const reason: RepReason | null =
    counted === null
      ? "insufficient_samples"
      : countable.every((report) => report.reason === "no_excursion_detected")
        ? "no_excursion_detected"
        : null;

  const starts: StartRecount[] = series.starts.map((start, i) => {
    const report = reports[i];
    return {
      number: i + 1,
      windowStartMs: start.window.startMs,
      zeroFound: start.baselineDeg !== null,
      count: isCountable(report) ? report.count : null,
      pairs: start.pairs,
    };
  });

  const dose = record(prescription?.dose);
  const defaultDose = record(exercise?.default_dose);
  const startedAt = str(session.started_at);
  const endedAt = str(session.ended_at);

  const countedLines = (byWindow ? series.starts.map((start) => start.samples) : [series.samples]).filter(
    (line) => line.length > 0,
  );
  const uncountedLines = [series.beforeBaselineWindow, ...series.starts.map((start) => start.uncounted)].filter(
    (line) => line.length > 0,
  );
  const lines = [...countedLines, ...uncountedLines];
  const budgets = lineBudgets(
    lines.map((line) => line.length),
    maxChartPoints,
  );
  const drawn = lines.map((line, i) => downsampleMinMax(line, Math.max(2, budgets[i])));

  const roles = ROLES.map((role) =>
    roleTechnical(
      role,
      record(deviceRoles[role]),
      summarySensors && isRecord(summarySensors[role]) ? summarySensors[role] : null,
      count(frameCounts[role]),
      role === "thigh" ? deliveredHz(thigh) : role === "shank" ? deliveredHz(shank) : null,
    ),
  );

  return {
    patientName: isRecord(raw.patient) ? str(raw.patient.name) : null,
    session: {
      id: session.id as string,
      status: oneOf(session.status, SESSION_STATUSES),
      startedAt,
      endedAt,
      durationMs: durationBetween(startedAt, endedAt),
      simulated: isSimulatedSession(session),
    },
    exerciseName: exercise ? str(exercise.name) : null,
    targetReps: positiveInt(dose.reps) ?? positiveInt(defaultDose.reps),
    recount: {
      count: counted,
      reason,
      thresholds,
      maxGapMs: motion.maxRepGapMs,
      cancelled: reports.reduce((sum, report) => sum + (report ? report.cancelled : 0), 0),
      baseline: {
        source: series.baselineSource,
        zeroFound: byWindow ? starts.some((start) => start.zeroFound) : series.baselineDeg !== null,
        pairsBeforeWindow: series.beforeBaselineWindow.length,
      },
      starts,
    },
    deviceCount: count(summary.reps_counted_on_device),
    restartedAfterReload: typeof summary.restarted_after_reload === "boolean" ? summary.restarted_after_reload : null,
    chart: {
      counted: drawn.slice(0, countedLines.length),
      uncounted: drawn.slice(countedLines.length),
      beforeStart: series.beforeBaselineWindow.length > 0,
      ownZero: series.beforeBaselineOwnZero || series.starts.some((start) => start.uncounted.length > 0),
      startMarksMs: series.starts.length > 1 ? series.starts.map((start) => start.window.startMs) : [],
      totalPoints: lines.reduce((sum, line) => sum + line.length, 0),
      segments: reports.flatMap((report) =>
        report ? report.segments.map(({ startMs, endMs }) => ({ startMs, endMs })) : [],
      ),
      startMs: lines.length ? Math.min(...lines.map((line) => line[0].tMs)) : null,
      endMs: lines.length ? Math.max(...lines.map((line) => line[line.length - 1].tMs)) : null,
    },
    roles,
    pairing: series.pairing,
    pairingToleranceMs: motion.maxPairSkewMs,
    interSensorSkew: { thighShank: nearestOffsetStats(thigh, shank) },
    telemetry: {
      framesConfirmed: count(telemetry.frames_confirmed),
      pendingAtFinish: count(telemetry.pending_at_finish),
      errors: count(telemetry.errors),
      dropped: count(telemetry.dropped),
    },
    checkIn: parseCheckIn(raw.check_in),
  };
}
