// Per-exercise/per-set calibration baseline: "hold still 2-3s, zero the reference" (spec's calibration
// step for every one of the 8 exercises). Reuses lib/ble/signalQuality.ts's own stillness/duration
// thresholds (MAX_STATIC_GYROSCOPE_RAW, MIN_CALIBRATION_SECONDS) rather than inventing a second set —
// "still enough to calibrate" is the same question signalQuality.ts already answers for its own gate.
// Re-baseline every set, not just once per session, to bound the onboard Euler-angle drift flagged in
// docs/imu/ble-connectivity.md §9 (see jointAngle.ts's header for the fuller explanation).

import { MAX_STATIC_GYROSCOPE_RAW, MIN_CALIBRATION_SECONDS } from "@/lib/ble/signalQuality";
import type { SensorRole } from "@/lib/ble/roles";
import type { ParsedWt901Frame } from "@/lib/ble/wt901ble68";

export interface CalibrationBaseline {
  /** Mean eulerDegrees per role over the still window — the "zero" every later sample is measured
   *  against for that role, for the rest of this set. */
  perRole: Partial<Record<SensorRole, [number, number, number]>>;
  capturedAtMs: number;
  durationSec: number;
}

interface RoleSample {
  tMs: number;
  euler: [number, number, number];
  gyroRaw: [number, number, number];
}

export class CalibrationCapture {
  private samples: Partial<Record<SensorRole, RoleSample[]>> = {};
  private windowStartMs: number | null = null;

  /** Feed one frame for one role. Call reset() first if the patient moved and calibration must restart. */
  push(role: SensorRole, tMs: number, frame: ParsedWt901Frame): void {
    if (this.windowStartMs === null) this.windowStartMs = tMs;
    const moving = frame.gyroscopeRaw.some((v) => Math.abs(v) > MAX_STATIC_GYROSCOPE_RAW);
    if (moving) {
      this.reset();
      this.windowStartMs = tMs;
    }
    const list = this.samples[role] ?? [];
    list.push({ tMs, euler: frame.eulerDegrees, gyroRaw: frame.gyroscopeRaw });
    this.samples[role] = list;
  }

  reset(): void {
    this.samples = {};
    this.windowStartMs = null;
  }

  /** True once every required role has MIN_CALIBRATION_SECONDS of continuous still data. */
  isReady(nowMs: number, requiredRoles: SensorRole[]): boolean {
    if (this.windowStartMs === null) return false;
    if ((nowMs - this.windowStartMs) / 1000 < MIN_CALIBRATION_SECONDS) return false;
    return requiredRoles.every((role) => (this.samples[role]?.length ?? 0) > 0);
  }

  /** The mean-Euler baseline for each role with data, or null if the window isn't ready yet. */
  getBaseline(nowMs: number, requiredRoles: SensorRole[]): CalibrationBaseline | null {
    if (!this.isReady(nowMs, requiredRoles)) return null;
    const perRole: Partial<Record<SensorRole, [number, number, number]>> = {};
    for (const role of requiredRoles) {
      const list = this.samples[role];
      if (!list || list.length === 0) continue;
      const mean: [number, number, number] = [0, 0, 0];
      for (const s of list) {
        mean[0] += s.euler[0];
        mean[1] += s.euler[1];
        mean[2] += s.euler[2];
      }
      perRole[role] = [mean[0] / list.length, mean[1] / list.length, mean[2] / list.length];
    }
    return {
      perRole,
      capturedAtMs: nowMs,
      durationSec: (nowMs - (this.windowStartMs as number)) / 1000,
    };
  }
}
