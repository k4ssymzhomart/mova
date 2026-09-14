import type { FrameRow } from "@/lib/telemetry/buffer";

import type { SensorRole } from "./roles";
import type { ParsedWt901Frame } from "./wt901ble68";

/**
 * Wraps one raw BLE sample as a `session_frames` row, tagged by role.
 *
 * Deliberately does no unit conversion: WT901BLE68's raw accel/gyro LSB
 * counts need a confirmed per-sensor scale factor to become physical units
 * (g / deg-per-s), and Phoenix's own packet model leaves that scale as
 * `float | None` rather than hardcode one -- calibration maths is a separate
 * issue here too, so raw counts pass through untouched.
 *
 * Also does no cross-role alignment: each role's frames arrive on their own
 * schedule from independent BLE links, and resampling them onto one shared
 * clock is the sibling signal-quality/sync work's job, not this ingestion
 * path's.
 */
export function toFrameRow(
  role: SensorRole,
  frame: ParsedWt901Frame,
  seq: number,
  recordedAt: Date = new Date(),
): FrameRow {
  return {
    recorded_at: recordedAt.toISOString(),
    seq,
    imu: {
      role,
      ax: frame.accelerometerRaw[0],
      ay: frame.accelerometerRaw[1],
      az: frame.accelerometerRaw[2],
      gx: frame.gyroscopeRaw[0],
      gy: frame.gyroscopeRaw[1],
      gz: frame.gyroscopeRaw[2],
      euler_deg: frame.eulerDegrees,
      validation_status: "unverified_checksum",
    },
  };
}
