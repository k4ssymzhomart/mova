// Reading back what a finished session recorded.
//
// `sessions.summary` is written once, at the end of a session, by buildHeelSlideSummary in
// components/flow/heelSlideRecords.ts, and it is the fullest honest record the product keeps: how many repetitions
// were counted against the target, where each one started and ended, which sensors were worn and at what delivered
// rate, and how much of the telemetry reached the server. Until now no patient screen read any of it.
//
// This module turns that stored object into something a screen can render, and refuses to invent anything. Every
// field is optional in the parse: a session written by an older build, or one that stopped early, keeps whatever it
// has and reports null for the rest. A screen renders a null as «не записано», never as a zero.
//
// It deliberately exposes NO angle. `peak_rel_deg` in the stored segments is the relative device-orientation proxy
// (`wrap(shank.pitch − thigh.pitch)`, baseline-zeroed), it is not calibrated and it is not knee flexion, so it is
// parsed for completeness but the shape below offers no helper that would make it look like a measured angle.

import type { SensorRole } from "@/lib/sensors/types";

// The order sensors are read back in, worn top to bottom. It repeats SENSOR_ROLES from lib/sensors/types rather than
// importing it, because node:test loads this module directly and resolves no path alias; summary.test.ts asserts the
// two lists stay identical.
export const ROLE_ORDER: readonly SensorRole[] = ["thigh", "shank", "foot"];

export const HEEL_SLIDE_SUMMARY_KIND = "heel_slide_path.v1";

export interface SessionSensorFacts {
  role: SensorRole;
  deviceName: string | null;
  /** The rate the sensor actually delivered, in hertz, or null when it was never measured. */
  deliveredHz: number | null;
  requestedHz: number | null;
  /** true when the sensor confirmed the rate it was asked for; false when it refused; null when never answered. */
  rateConfirmed: boolean | null;
  reconnects: number | null;
  batteryStartVolts: number | null;
  batteryEndVolts: number | null;
}

export interface SessionTelemetryFacts {
  framesConfirmed: number | null;
  pendingAtFinish: number | null;
  errors: number | null;
  dropped: number | null;
}

export interface SessionFacts {
  kind: string;
  /** Repetitions the device counted during the session, and the number prescribed. */
  repsCounted: number | null;
  targetReps: number | null;
  /** Start and end of each counted repetition, in milliseconds from the start of the recording. */
  segments: { startMs: number; endMs: number }[];
  /** Total time inside counted repetitions, in seconds. Null when no segment survived the parse. */
  movingSeconds: number | null;
  sensors: SessionSensorFacts[];
  telemetry: SessionTelemetryFacts;
  /** true when the session was driven by the development simulator rather than by sensors. */
  simulated: boolean;
  /** true when the patient reloaded the page mid-session and the count was restarted. */
  restartedAfterReload: boolean;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const int = (value: unknown): number | null => {
  const n = num(value);
  return n === null ? null : Math.round(n);
};

const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

const bool = (value: unknown): boolean | null => (typeof value === "boolean" ? value : null);

function sensorFacts(role: SensorRole, raw: unknown): SessionSensorFacts {
  const record = isObject(raw) ? raw : {};
  const history = Array.isArray(record.rate_history) ? record.rate_history : [];
  const last = history.length > 0 ? history[history.length - 1] : null;
  const batteryStart = isObject(record.battery_start) ? record.battery_start : null;
  const batteryEnd = isObject(record.battery_end) ? record.battery_end : null;
  return {
    role,
    deviceName: str(record.device_name),
    deliveredHz: num(record.delivered_hz),
    requestedHz: num(record.requested_hz),
    rateConfirmed: isObject(last) ? bool(last.confirmed) : null,
    reconnects: int(record.reconnects),
    batteryStartVolts: batteryStart ? num(batteryStart.volts) : null,
    batteryEndVolts: batteryEnd ? num(batteryEnd.volts) : null,
  };
}

/**
 * The facts a finished session stored, or null when the column holds something this build does not recognise.
 *
 * A summary of an unknown kind returns null rather than a half-read record: a screen then says the session has no
 * stored details, which is true, instead of showing a few fields that happen to share a name.
 */
export function parseSessionSummary(raw: unknown): SessionFacts | null {
  if (!isObject(raw)) return null;
  const kind = str(raw.kind);
  if (kind !== HEEL_SLIDE_SUMMARY_KIND) return null;

  const segments: { startMs: number; endMs: number }[] = [];
  if (Array.isArray(raw.rep_segments)) {
    for (const entry of raw.rep_segments) {
      if (!isObject(entry)) continue;
      const startMs = num(entry.start_ms);
      const endMs = num(entry.end_ms);
      if (startMs === null || endMs === null || endMs <= startMs) continue;
      segments.push({ startMs, endMs });
    }
  }
  segments.sort((a, b) => a.startMs - b.startMs);

  const movingMs = segments.reduce((total, segment) => total + (segment.endMs - segment.startMs), 0);
  const sensorsRaw = isObject(raw.sensors) ? raw.sensors : {};
  const telemetryRaw = isObject(raw.telemetry) ? raw.telemetry : {};

  return {
    kind,
    repsCounted: int(raw.reps_counted_on_device),
    targetReps: int(raw.target_reps),
    segments,
    movingSeconds: segments.length > 0 ? Math.round(movingMs / 100) / 10 : null,
    sensors: ROLE_ORDER.filter((role) => isObject(sensorsRaw[role])).map((role) =>
      sensorFacts(role, sensorsRaw[role]),
    ),
    telemetry: {
      framesConfirmed: int(telemetryRaw.frames_confirmed),
      pendingAtFinish: int(telemetryRaw.pending_at_finish),
      errors: int(telemetryRaw.errors),
      dropped: int(telemetryRaw.dropped),
    },
    simulated: raw.simulated === true,
    restartedAfterReload: raw.restarted_after_reload === true,
  };
}

/**
 * Whether everything the session recorded reached the server: nothing waiting on the device, nothing dropped, no
 * errors. Null when the session stored no telemetry counters at all, which is not the same as a clean recording.
 */
export function recordingComplete(facts: SessionFacts): boolean | null {
  const { framesConfirmed, pendingAtFinish, errors, dropped } = facts.telemetry;
  if (framesConfirmed === null && pendingAtFinish === null && errors === null && dropped === null) return null;
  return (pendingAtFinish ?? 0) === 0 && (errors ?? 0) === 0 && (dropped ?? 0) === 0;
}

/** The sensors that delivered a rate, as whole hertz, for a one-line "three sensors at 50 Hz" reading. */
export function deliveredRates(facts: SessionFacts): number[] {
  return facts.sensors
    .map((sensor) => sensor.deliveredHz)
    .filter((hz): hz is number => hz !== null)
    .map((hz) => Math.round(hz));
}
