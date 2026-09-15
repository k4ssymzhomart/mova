import { SENSOR_ROLE_LABEL, SENSOR_ROLE_ORDER, type SensorRole } from "./roles";

/**
 * Ported from Phoenix's `services/api/app/signal_quality.py` -- same
 * thresholds, same reason codes, same level logic. Runs client-side here
 * (not in a Python gateway) because mova has no live backend in this data
 * path; the gate needs to run in the browser against the same buffers the
 * BLE recorder fills.
 *
 * All thresholds below are the engineering defaults Phoenix derived from a
 * single 2026-09-05 live 3-sensor capture -- they need protocol-specific /
 * clinical validation before real use, same caveat as the source file.
 */
export type SignalQualityLevel = "HIGH" | "MEDIUM" | "LOW" | "INVALID";

export interface SignalQualityEvent {
  role: SensorRole;
  /** Client arrival time, ms since epoch (WT901BLE68 frames carry no device timestamp). */
  timestampMs: number;
  ax: number;
  ay: number;
  az: number;
  gx: number;
  gy: number;
  gz: number;
}

export interface SignalQualityReport {
  level: SignalQualityLevel;
  reasons: string[];
  calibrationDurationSeconds: number;
  synchronizationSkewMs: number | null;
  sampleRatesHz: Partial<Record<SensorRole, number>>;
  packetCounts: Record<SensorRole, number>;
  scoringPermitted: boolean;
}

export const MIN_CALIBRATION_SECONDS = 3.0;
/** Confirmed WT901BLE68 hardware streams at ~10-12 Hz per sensor on its 10 Hz firmware
 * setting (Phoenix's 2026-09-05 live capture) -- 8 Hz leaves margin below that for jitter. */
export const MIN_SAMPLE_RATE_HZ = 8.0;
/** Three independent BLE links aren't phase-locked; at ~10-12 Hz one sample period alone is
 * 80-100ms. Placeholder pending the sampling-rate issue's bench-validated figure. */
export const MAX_SYNC_SKEW_MS = 250.0;
export const MAX_GAP_SECONDS = 1.0;
export const CLIPPING_RAW_LIMIT = 32_700;
/** A live, stationary WT901BLE68 capture measured a resting gyro raw value of 700 on one
 * axis -- this leaves margin above that observed noise floor, not a clinical threshold. */
export const MAX_STATIC_GYROSCOPE_RAW = 2000;

/** Maps a level to a single 0..1 rollup for `session_frames.quality`; the full report lives in `imu`. */
export const LEVEL_SCORE: Record<SignalQualityLevel, number> = { HIGH: 1, MEDIUM: 0.6, LOW: 0.2, INVALID: 0 };

const AXES6 = ["ax", "ay", "az", "gx", "gy", "gz"] as const;
const AXES_GYRO = ["gx", "gy", "gz"] as const;

/**
 * Evaluate connection, calibration-window and transport quality across the
 * three sensor roles, conservatively. Mirrors `evaluate_signal_quality` in
 * Phoenix's `signal_quality.py` field-for-field.
 */
export function evaluateSignalQuality(events: SignalQualityEvent[]): SignalQualityReport {
  const byRole = new Map<SensorRole, SignalQualityEvent[]>();
  for (const event of events) {
    if (!SENSOR_ROLE_ORDER.includes(event.role)) continue;
    const list = byRole.get(event.role);
    if (list) list.push(event);
    else byRole.set(event.role, [event]);
  }

  const packetCounts = Object.fromEntries(
    SENSOR_ROLE_ORDER.map((role) => [role, byRole.get(role)?.length ?? 0]),
  ) as Record<SensorRole, number>;

  const missingRoles = SENSOR_ROLE_ORDER.filter((role) => !byRole.has(role));
  if (missingRoles.length > 0) {
    return {
      level: "INVALID",
      reasons: [`missing_sensor_roles:${missingRoles.slice().sort().join(",")}`],
      calibrationDurationSeconds: 0,
      synchronizationSkewMs: null,
      sampleRatesHz: {},
      packetCounts,
      scoringPermitted: false,
    };
  }

  const timedByRole = new Map<SensorRole, SignalQualityEvent[]>();
  for (const [role, roleEvents] of byRole) {
    timedByRole.set(
      role,
      [...roleEvents].sort((a, b) => a.timestampMs - b.timestampMs),
    );
  }

  const allTimestamps = [...timedByRole.values()].flat().map((e) => e.timestampMs);
  const calibrationDurationSeconds = (Math.max(...allTimestamps) - Math.min(...allTimestamps)) / 1000;
  const latest = [...timedByRole.values()].map((roleEvents) => roleEvents[roleEvents.length - 1].timestampMs);
  const synchronizationSkewMs = Math.max(...latest) - Math.min(...latest);

  const sampleRatesHz: Partial<Record<SensorRole, number>> = {};
  let longGap = false;
  for (const [role, roleEvents] of timedByRole) {
    const intervals: number[] = [];
    for (let i = 1; i < roleEvents.length; i += 1) {
      intervals.push((roleEvents[i].timestampMs - roleEvents[i - 1].timestampMs) / 1000);
    }
    if (intervals.length > 0) {
      const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      sampleRatesHz[role] = 1 / meanInterval;
      longGap = longGap || Math.max(...intervals) > MAX_GAP_SECONDS;
    } else {
      sampleRatesHz[role] = 0;
    }
  }

  const clipped = [...byRole.values()]
    .flat()
    .some((event) => AXES6.some((axis) => Math.abs(event[axis]) >= CLIPPING_RAW_LIMIT));
  const movingDuringCalibration = [...byRole.values()]
    .flat()
    .some((event) => AXES_GYRO.some((axis) => Math.abs(event[axis]) > MAX_STATIC_GYROSCOPE_RAW));

  const reasons: string[] = [];
  if (calibrationDurationSeconds < MIN_CALIBRATION_SECONDS) reasons.push("static_calibration_window_too_short");
  if (movingDuringCalibration) reasons.push("static_calibration_motion_detected");
  if (clipped) reasons.push("sensor_clipping_detected");
  if (longGap) reasons.push("prolonged_packet_gap");
  if (Object.values(sampleRatesHz).some((rate) => (rate ?? 0) < MIN_SAMPLE_RATE_HZ)) {
    reasons.push("insufficient_sample_rate");
  }
  if (synchronizationSkewMs > MAX_SYNC_SKEW_MS) reasons.push("sensor_synchronization_out_of_range");

  let level: SignalQualityLevel;
  if (reasons.includes("sensor_clipping_detected") || reasons.includes("prolonged_packet_gap")) {
    level = "INVALID";
  } else if (
    reasons.includes("static_calibration_window_too_short") ||
    reasons.includes("static_calibration_motion_detected") ||
    reasons.includes("insufficient_sample_rate")
  ) {
    level = "LOW";
  } else if (reasons.includes("sensor_synchronization_out_of_range")) {
    level = "MEDIUM";
  } else {
    level = "HIGH";
  }

  return {
    level,
    reasons,
    calibrationDurationSeconds,
    synchronizationSkewMs,
    sampleRatesHz,
    packetCounts,
    scoringPermitted: level === "HIGH" || level === "MEDIUM",
  };
}

const REASON_MESSAGE: Record<string, string> = {
  static_calibration_window_too_short: "Hold still a moment longer while sensors calibrate.",
  static_calibration_motion_detected: "Motion detected during calibration -- hold still.",
  sensor_clipping_detected: "A sensor reading is out of range -- check the strap and try again.",
  prolonged_packet_gap: "Lost data from a sensor -- check its connection.",
  sensor_synchronization_out_of_range: "Sensors are slightly out of sync.",
};

/**
 * Turns a report's reason codes into specific, human-readable messages --
 * never a generic "correct/incorrect" (AC-05/IMU-06/07/08). Phoenix's own
 * `reasons` are role-agnostic strings; where the report's per-role data
 * (`sampleRatesHz`) already lets us name the culprit, this does, without
 * changing `evaluateSignalQuality`'s ported logic itself.
 */
export function describeSignalQuality(report: SignalQualityReport): string[] {
  return report.reasons.map((reason) => {
    if (reason.startsWith("missing_sensor_roles:")) {
      const roles = reason
        .slice("missing_sensor_roles:".length)
        .split(",")
        .filter(Boolean) as SensorRole[];
      return `Waiting for ${roles.map((r) => SENSOR_ROLE_LABEL[r] ?? r).join(", ")}.`;
    }
    if (reason === "insufficient_sample_rate") {
      const slow = SENSOR_ROLE_ORDER.filter((role) => (report.sampleRatesHz[role] ?? 0) < MIN_SAMPLE_RATE_HZ);
      const who = slow.length > 0 ? slow.map((r) => SENSOR_ROLE_LABEL[r]).join(", ") : "A sensor";
      return `${who} is sending data too slowly.`;
    }
    return REASON_MESSAGE[reason] ?? reason;
  });
}
