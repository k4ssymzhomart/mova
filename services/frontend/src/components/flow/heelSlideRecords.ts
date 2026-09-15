// What a Heel Slide session stores about itself, in one place so every writer uses the same shape and the node
// tests pin it:
//  - sessions.device_info, written once when SensorsStep opens the session, and read back by the exercise screen
//    after a reload (the rate the session was opened with, the battery at the start);
//  - sessions.summary (heel_slide_path.v1), written by the exercise screen through finish_prescribed_session and
//    read by the clinician view.
//
// A record says what the transport and the counter reported, nothing more: an unknown value is stored as null,
// never as a default. Only types come from lib/ble and lib/motion, so this module has no runtime imports.

import type { BatteryReading, LiveRoleState, LiveSensorsSnapshot, RateState } from "@/lib/ble/liveSensors";
import type { SensorRole } from "@/lib/ble/roles";
import type { BaselineWindow } from "@/lib/motion/flexion";
import type { RepSegment, RepThresholds } from "@/lib/motion/reps";

/** lib/ble/roles SENSOR_ROLE_ORDER, repeated so this module stays free of runtime imports. */
export const SENSOR_ROLES: readonly SensorRole[] = ["thigh", "shank", "foot"];

/** The model printed on the sensors has not been checked against the datasheet yet (hardware checklist). */
export const SENSOR_MODEL_LABEL = "WT901BLE68 (unverified)";

type RateFailure = "no_reply" | "mismatch" | "write_failed";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// — device_info ———————————————————————————————————————————————————————————————————

/** One role's rate write and readback, as stored in sessions.device_info. */
export interface RateRecord {
  status: "not_started" | "configuring" | "done";
  /** The rate asked of the sensor: the one written, or, before the write starts, the one the store will write. */
  requested_hz: number | null;
  requested_code: number | null;
  /** What the sensor reported from its rate register; null when it never answered or was not asked yet. */
  readback_code: number | null;
  /** null while unknown (not configured yet, or still configuring). */
  confirmed: boolean | null;
  attempts: number | null;
  failure: RateFailure | null;
}

export function rateRecord(rate: RateState, requestedHz: number | null = null): RateRecord {
  if (rate.status === "done") {
    const result = rate.result;
    return {
      status: "done",
      requested_hz: result.requestedHz,
      requested_code: result.requestedCode,
      readback_code: result.readbackCode,
      confirmed: result.confirmed,
      attempts: result.attempts,
      failure: result.failure,
    };
  }
  return {
    status: rate.status === "configuring" ? "configuring" : "not_started",
    requested_hz: rate.status === "configuring" ? rate.requestedHz : requestedHz,
    requested_code: null,
    readback_code: null,
    confirmed: null,
    attempts: null,
    failure: null,
  };
}

/**
 * A battery reading as stored: the voltage from register 0x64 and the percent WitMotion's interpolation table gives
 * for it. The percent is the vendor's table, not a measured state of charge.
 */
export interface BatteryRecord {
  volts: number;
  vendor_percent: number;
}

/** The latest reading, or null when there is none or the most recent read failed: a failed read is unknown. */
export function batteryRecord(battery: BatteryReading | null, batteryError: string | null): BatteryRecord | null {
  if (!battery || batteryError !== null) return null;
  return { volts: battery.volts, vendor_percent: battery.vendorPercent };
}

export interface SensorRoleRecord {
  device_id: string | null;
  device_name: string | null;
  rate: RateRecord;
  /** Measured from received frames when the record was taken; null while unknown. */
  delivered_hz: number | null;
  battery: BatteryRecord | null;
}

export interface SensorDeviceInfo {
  transport: "web-bluetooth";
  model_label: string;
  roles: Record<SensorRole, SensorRoleRecord>;
}

/** sessions.device_info for a session opened with the sensors in this snapshot. Hardware descriptors only. */
export function sensorDeviceInfo(snapshot: Pick<LiveSensorsSnapshot, "roles">): SensorDeviceInfo {
  const roles = {} as Record<SensorRole, SensorRoleRecord>;
  for (const role of SENSOR_ROLES) {
    const state = snapshot.roles[role];
    roles[role] = {
      device_id: state.deviceId,
      device_name: state.deviceName,
      rate: rateRecord(state.rate, state.requestedHz),
      delivered_hz: finiteOrNull(state.deliveredHz),
      battery: batteryRecord(state.battery, state.batteryError),
    };
  }
  return { transport: "web-bluetooth", model_label: SENSOR_MODEL_LABEL, roles };
}

/** A role as device_info recorded it when the session opened. */
export interface StartSensor {
  deviceId: string | null;
  battery: BatteryRecord | null;
}

/** A stored battery record, or null when it is missing or not a plausible reading. */
export function parseBatteryRecord(value: unknown): BatteryRecord | null {
  if (!isRecord(value)) return null;
  const volts = finiteOrNull(value.volts as number | null);
  const percent = finiteOrNull(value.vendor_percent as number | null);
  if (volts === null || volts <= 0 || percent === null || percent < 0 || percent > 100) return null;
  return { volts, vendor_percent: percent };
}

function deviceInfoRoles(deviceInfo: unknown): Record<string, unknown> {
  return isRecord(deviceInfo) && isRecord(deviceInfo.roles) ? deviceInfo.roles : {};
}

/** Each role's device id and battery as the session recorded them when it opened. */
export function startSensorsFromDeviceInfo(deviceInfo: unknown): Record<SensorRole, StartSensor> {
  const roles = deviceInfoRoles(deviceInfo);
  const result = {} as Record<SensorRole, StartSensor>;
  for (const role of SENSOR_ROLES) {
    const entry = roles[role];
    result[role] = isRecord(entry)
      ? {
          deviceId: typeof entry.device_id === "string" ? entry.device_id : null,
          battery: parseBatteryRecord(entry.battery),
        }
      : { deviceId: null, battery: null };
  }
  return result;
}

/** The rate the session was opened with (50 or 100 Hz), or null when device_info does not say. */
export function requestedHzFromDeviceInfo(deviceInfo: unknown): 50 | 100 | null {
  const roles = deviceInfoRoles(deviceInfo);
  for (const role of SENSOR_ROLES) {
    const entry = roles[role];
    const rate = isRecord(entry) ? entry.rate : null;
    const hz = isRecord(rate) ? rate.requested_hz : null;
    if (hz === 50 || hz === 100) return hz;
  }
  return null;
}

// — summary ———————————————————————————————————————————————————————————————————————

export const HEEL_SLIDE_SUMMARY_KIND = "heel_slide_path.v1";

export interface RepSegmentRecord {
  start_ms: number;
  end_ms: number;
  /** Relative sensor-orientation degrees, not knee flexion. */
  peak_rel_deg: number;
}

export interface RateHistoryRecord {
  at_ms: number;
  confirmed: boolean;
  readback_code: number | null;
  failure: RateFailure | null;
}

export interface SummarySensorRecord {
  device_name: string | null;
  device_id_short: string | null;
  requested_hz: number;
  rate_history: RateHistoryRecord[];
  delivered_hz: number | null;
  battery_start: BatteryRecord | null;
  battery_end: BatteryRecord | null;
  /** Reconnects that brought the link back. */
  reconnects: number;
}

/**
 * sessions.summary when Heel Slide finishes.
 *  - Rep segment times are browser receive times (epoch ms), the clock of session_frames.recorded_at.
 *  - baseline_window_ms is the span the live zero was taken over on the latest start, so the clinician recount
 *    zeroes on the same frames; null when no zero was taken.
 *  - restarted_after_reload: this session had recorded before the screen opened, so the device count covers only
 *    what was done since.
 *  - sensors describe the device bound to each role at finish; battery_start is that device's first known reading.
 *  - telemetry counters are this page's recorder's, null when it never recorded; pending_at_finish is the rows
 *    still stored on the device for this session, null when that could not be read.
 */
export interface HeelSlideSummary {
  kind: typeof HEEL_SLIDE_SUMMARY_KIND;
  reps_counted_on_device: number;
  target_reps: number | null;
  rep_segments: RepSegmentRecord[];
  proxy: { definition: string; calibrated: false; knee_flexion: false };
  thresholds: { enter_deg: number; exit_deg: number; min_rep_ms: number; max_gap_ms: number | null };
  baseline_window_ms: { start: number; end: number } | null;
  restarted_after_reload: boolean;
  sensors: Record<SensorRole, SummarySensorRecord>;
  telemetry: {
    frames_confirmed: number | null;
    pending_at_finish: number | null;
    errors: number | null;
    dropped: number | null;
  };
}

/** The first battery reading the exercise screen saw for a role, with the device it came from. */
export interface SeenBattery {
  deviceId: string;
  battery: BatteryRecord;
}

export type SummaryRoleState = Pick<
  LiveRoleState,
  | "deviceId"
  | "deviceIdShort"
  | "deviceName"
  | "requestedHz"
  | "rateHistory"
  | "deliveredHz"
  | "battery"
  | "batteryError"
  | "reconnect"
>;

export interface FinishTelemetry {
  /** The recorder's final counters; null when nothing was recorded on this page. */
  counters: { framesConfirmed: number; errors: number; framesDropped: number } | null;
  pending: number | null;
}

export interface HeelSlideSummaryInput {
  repsCounted: number;
  segments: readonly Pick<RepSegment, "startMs" | "endMs" | "peakValue">[];
  targetReps: number | null;
  proxyDefinition: string;
  thresholds: RepThresholds;
  maxGapMs: number;
  baselineWindow: BaselineWindow | null;
  restartedAfterReload: boolean;
  roles: Record<SensorRole, SummaryRoleState>;
  startSensors: Record<SensorRole, StartSensor>;
  firstSeenBattery: Partial<Record<SensorRole, SeenBattery>>;
  telemetry: FinishTelemetry;
}

/**
 * The battery at the start for the device bound at finish: device_info's reading when the session opened with
 * that same device, else the first reading this screen saw from it. A swapped device never inherits another
 * device's reading.
 */
export function pickStartBattery(
  currentDeviceId: string | null,
  atStart: StartSensor | undefined,
  firstSeen: SeenBattery | undefined,
): BatteryRecord | null {
  if (currentDeviceId === null) return null;
  if (atStart?.battery && atStart.deviceId === currentDeviceId) return atStart.battery;
  if (firstSeen && firstSeen.deviceId === currentDeviceId) return firstSeen.battery;
  return null;
}

function summarySensor(
  state: SummaryRoleState,
  atStart: StartSensor | undefined,
  firstSeen: SeenBattery | undefined,
): SummarySensorRecord {
  return {
    device_name: state.deviceName,
    device_id_short: state.deviceIdShort,
    requested_hz: state.requestedHz,
    rate_history: state.rateHistory.map((entry) => ({
      at_ms: entry.atMs,
      confirmed: entry.confirmed,
      readback_code: entry.readbackCode,
      failure: entry.failure,
    })),
    delivered_hz: finiteOrNull(state.deliveredHz),
    battery_start: pickStartBattery(state.deviceId, atStart, firstSeen),
    battery_end: state.deviceId === null ? null : batteryRecord(state.battery, state.batteryError),
    reconnects: state.reconnect.succeeded,
  };
}

export function buildHeelSlideSummary(input: HeelSlideSummaryInput): HeelSlideSummary {
  const { thresholds, baselineWindow, telemetry } = input;
  const sensors = {} as Record<SensorRole, SummarySensorRecord>;
  for (const role of SENSOR_ROLES) {
    sensors[role] = summarySensor(input.roles[role], input.startSensors[role], input.firstSeenBattery[role]);
  }
  const windowStart = finiteOrNull(baselineWindow?.startMs);
  const windowEnd = finiteOrNull(baselineWindow?.endMs);
  return {
    kind: HEEL_SLIDE_SUMMARY_KIND,
    reps_counted_on_device: input.repsCounted,
    target_reps: input.targetReps,
    rep_segments: input.segments.map((segment) => ({
      start_ms: segment.startMs,
      end_ms: segment.endMs,
      peak_rel_deg: Math.round(segment.peakValue * 10) / 10 || 0,
    })),
    proxy: { definition: input.proxyDefinition, calibrated: false, knee_flexion: false },
    thresholds: {
      enter_deg: thresholds.enterDeg,
      exit_deg: thresholds.exitDeg,
      min_rep_ms: thresholds.minRepMs,
      max_gap_ms: finiteOrNull(input.maxGapMs),
    },
    baseline_window_ms: windowStart !== null && windowEnd !== null ? { start: windowStart, end: windowEnd } : null,
    restarted_after_reload: input.restartedAfterReload,
    sensors,
    telemetry: {
      frames_confirmed: telemetry.counters ? telemetry.counters.framesConfirmed : null,
      pending_at_finish: telemetry.pending,
      errors: telemetry.counters ? telemetry.counters.errors : null,
      dropped: telemetry.counters ? telemetry.counters.framesDropped : null,
    },
  };
}

/**
 * Rows still stored on the device for the session when it finishes. A clean stop leaves nothing and the store is
 * not read. Otherwise the stored count is read, since the outbox may have sent some of them meanwhile; if the store
 * cannot be read the recorder's own count stands, and with no recorder the number is unknown.
 */
export async function pendingAtFinish(
  counters: { pending: number } | null,
  readStored: () => Promise<number>,
): Promise<number | null> {
  if (counters && counters.pending === 0) return 0;
  try {
    return await readStored();
  } catch {
    return counters ? counters.pending : null;
  }
}
