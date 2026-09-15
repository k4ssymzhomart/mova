import type { FrameRow } from "@/lib/telemetry/buffer";

import type { SensorRole } from "./roles";
import { LEVEL_SCORE, type SignalQualityReport } from "./signalQuality";
import type { ParsedWt901Frame } from "./wt901ble68";

export interface ToFrameRowOptions {
  recordedAt?: Date;
  /** Most recent cross-role evaluation, if available -- rolled up into `quality` and
   * embedded in full under `imu.signal_quality` so a row can be filtered/joined on either. */
  quality?: SignalQualityReport | null;
}

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
 * clock is out of scope here -- `quality.synchronizationSkewMs`, when given,
 * only reports the skew observed among whatever roles have reported so far.
 */
export function toFrameRow(
  role: SensorRole,
  frame: ParsedWt901Frame,
  seq: number,
  { recordedAt = new Date(), quality = null }: ToFrameRowOptions = {},
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
      signal_quality: quality,
    },
    quality: quality ? LEVEL_SCORE[quality.level] : null,
  };
}
