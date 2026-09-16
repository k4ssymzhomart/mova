// The one seam between raw BLE frames and the rep detector. No physical-unit (g/deg-s) calibration
// exists yet for the WT901BLE68 (docs/imu/ble-connectivity.md §3/§9, deferred to a separate issue) — this
// uses each sensor's own onboard-fused eulerDegrees output instead (already real degrees, computed by
// the sensor firmware's own filter, not something mova invents — see wt901ble68.ts's parseWt901Frame).
// Relative to a calibration.ts baseline, NOT a clinically-validated absolute joint angle: the onboard
// filter has no magnetometer correction confirmed active and drifts over a multi-minute set, which is
// exactly why calibration.ts re-baselines every SET rather than once per session. If/when the deferred
// physical-unit-calibration issue lands with a better fusion approach, this is the only function that
// needs to change — nothing downstream (repDetector, targetScore, correctnessScore) depends on how the
// angle was derived, only that it's in degrees and grows with exercise progress.
//
// Simplifications flagged for future revisit, not silently assumed correct:
//  - Uses a fixed euler axis (index 1, "pitch" in the WT901BLE68's own convention) for every exercise,
//    rather than the calibration step's own "1 trial movement to verify signal direction" (spec's
//    calibration text) — that direction-check isn't implemented yet.
//  - Two-sensor (differential) exercises take the absolute difference between the two sensors' relative
//    rotations, which loses the sign (can't yet distinguish flexion from hyperextension past baseline).

import type { SensorRole } from "@/lib/ble/roles";
import type { ParsedWt901Frame } from "@/lib/ble/wt901ble68";
import type { CalibrationBaseline } from "./calibration";
import type { ExerciseConfig } from "./types";

const AXIS_INDEX = 1; // pitch — provisional, see header

/** Shortest signed difference a-b in degrees, wrapping through +/-180. */
function angleDelta(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

function relativeRotation(role: SensorRole, frame: ParsedWt901Frame, baseline: CalibrationBaseline): number | null {
  const base = baseline.perRole[role];
  if (!base) return null;
  return angleDelta(frame.eulerDegrees[AXIS_INDEX], base[AXIS_INDEX]);
}

/**
 * The joint-angle proxy driving rep detection and the live/provisional ROM display: a relative,
 * baseline-zeroed excursion in degrees, always >= 0 (direction is not yet distinguished — see header).
 * Returns null when a required sensor's current frame or calibration baseline is missing.
 */
export function computeJointAngle(
  config: ExerciseConfig,
  frames: Partial<Record<SensorRole, ParsedWt901Frame>>,
  baseline: CalibrationBaseline,
): number | null {
  const [roleA, roleB] = config.primarySensorRoles;
  const frameA = frames[roleA];
  if (!frameA) return null;
  const rotA = relativeRotation(roleA, frameA, baseline);
  if (rotA === null) return null;

  if (!roleB) return Math.abs(rotA);

  const frameB = frames[roleB];
  if (!frameB) return null;
  const rotB = relativeRotation(roleB, frameB, baseline);
  if (rotB === null) return null;

  return Math.abs(rotA - rotB);
}
