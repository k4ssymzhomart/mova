import type { FrameRow } from "@/lib/telemetry/buffer";

import type { SensorRole } from "./roles";
import { LEVEL_SCORE, type SignalQualityReport } from "./signalQuality";
import type { ParsedWt901Frame } from "./wt901ble68";

export interface ToFrameRowOptions {
  /** When the frame reached the browser. The WT901BLE68 frame carries no device timestamp. */
  recordedAt?: Date;
  /** Most recent cross-role evaluation, if any -- rolled up into the numeric `quality` column on every row. */
  quality?: SignalQualityReport | null;
  /**
   * Embed the full report under `imu.signal_quality`. The recorder sets this only on the row taken at an
   * evaluation tick (at most once a second), so 150 rows/s do not each repeat the same report.
   */
  attachReport?: boolean;
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
  { recordedAt = new Date(), quality = null, attachReport = false }: ToFrameRowOptions = {},
): FrameRow {
  const imu: Record<string, unknown> = {
    role,
    ax: frame.accelerometerRaw[0],
    ay: frame.accelerometerRaw[1],
    az: frame.accelerometerRaw[2],
    gx: frame.gyroscopeRaw[0],
    gy: frame.gyroscopeRaw[1],
    gz: frame.gyroscopeRaw[2],
    euler_deg: frame.eulerDegrees,
    validation_status: "unverified_checksum",
  };
  if (attachReport && quality) imu.signal_quality = quality;
  return {
    recorded_at: recordedAt.toISOString(),
    seq,
    imu,
    quality: quality ? LEVEL_SCORE[quality.level] : null,
  };
}
