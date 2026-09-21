// Rep-detection state machine — turns a stream of relative joint-angle samples (already baseline-zeroed
// by jointAngle.ts/calibration.ts) into RepResults. IDLE -> RISING -> (HOLDING, hold-type exercises only)
// -> RETURNING -> IDLE, emitting one RepResult per completed cycle. A rep that never returns within
// tempoRangeSec[1] x abandonMultiplier is closed as incomplete (not counted, feedback "return to start" —
// spec §16 edge case). A rep spent mostly under low signal confidence is excluded from Volume without
// being scored as a failed attempt (spec §7.1, §16: "Повторение, потерянное из-за BLE/sensor failure, не
// должно считаться ошибкой пациента").

import { smoothness01 } from "./kinematics";
import type { ExerciseConfig, RepResult } from "./types";

export type RepPhase = "IDLE" | "RISING" | "HOLDING" | "RETURNING";

export interface RepFsmSnapshot {
  phase: RepPhase;
  repIndex: number;
  elapsedSec: number;
  currentExcursionDeg: number;
  peakExcursionDeg: number;
}

interface Sample {
  tMs: number;
  angleDeg: number;
  signalOk: boolean;
}

const DEFAULT_NOISE_BAND_DEG = 3;
const DEFAULT_ABANDON_MULTIPLIER = 3;
const HOLD_ENGAGE_WINDOW_MS = 300;
/** Used only for the abandon timeout of an exercise with no calibrated tempoRangeSec; it is the
 *  widest max among the exercises that do have one, so it abandons no sooner than any of them. */
const DEFAULT_ABANDON_TEMPO_MAX_SEC = 8;

export interface RepDetectorOptions {
  config: ExerciseConfig;
  /** Short Arc Quad only: the absolute calibration reading (theta_start) — used to populate
   *  RepResult.startAngleDeg/finalAngleDeg. Harmless no-op for every other exercise. */
  calibrationBaselineAbsoluteDeg?: number;
  noiseBandDeg?: number;
  abandonMultiplier?: number;
}

export class RepDetector {
  private readonly config: ExerciseConfig;
  private readonly noiseBandDeg: number;
  private readonly abandonMs: number;
  private readonly calibrationBaselineAbsoluteDeg: number | undefined;

  private phase: RepPhase = "IDLE";
  private repIndex = 0;
  private buffer: Sample[] = [];
  private repStartMs = 0;
  private peakDeg = 0;
  private returnStartMs: number | null = null;
  private holdStartMs: number | null = null;
  private holdEngagedSinceMs: number | null = null;
  private accumulatedHoldSec = 0;
  private lowSignalSamples = 0;
  private totalSamples = 0;

  constructor(options: RepDetectorOptions) {
    this.config = options.config;
    this.noiseBandDeg = options.noiseBandDeg ?? DEFAULT_NOISE_BAND_DEG;
    // The abandon timeout is mechanical — when to stop waiting for a rep to come back — not a
    // scored target, so an exercise with no calibrated tempo still needs one. Fall back to the
    // widest calibrated max in the catalog rather than leaving a rep open forever.
    const tempoMaxSec = options.config.tempoRangeSec?.[1] ?? DEFAULT_ABANDON_TEMPO_MAX_SEC;
    this.abandonMs = (options.abandonMultiplier ?? DEFAULT_ABANDON_MULTIPLIER) * tempoMaxSec * 1000;
    this.calibrationBaselineAbsoluteDeg = options.calibrationBaselineAbsoluteDeg;
  }

  getSnapshot(nowMs: number): RepFsmSnapshot {
    return {
      phase: this.phase,
      repIndex: this.repIndex,
      elapsedSec: this.phase === "IDLE" ? 0 : (nowMs - this.repStartMs) / 1000,
      currentExcursionDeg: this.buffer.length ? this.buffer[this.buffer.length - 1].angleDeg : 0,
      peakExcursionDeg: this.peakDeg,
    };
  }

  /** Feed one sample. Returns a RepResult exactly when a rep closes (completed or abandoned). */
  push(tMs: number, angleDeg: number, signalOk: boolean): RepResult | null {
    const sample: Sample = { tMs, angleDeg, signalOk };

    if (this.phase === "IDLE") {
      if (Math.abs(angleDeg) <= this.noiseBandDeg) return null; // still at baseline, nothing to do
      this.beginRep(sample);
      return null;
    }

    // Timeout guard applies in every non-IDLE phase.
    if (tMs - this.repStartMs > this.abandonMs) {
      return this.closeRep(tMs, false);
    }

    this.buffer.push(sample);
    this.totalSamples += 1;
    if (!signalOk) this.lowSignalSamples += 1;
    if (angleDeg > this.peakDeg) this.peakDeg = angleDeg;

    if (this.phase === "RISING") {
      if (this.config.targetType === "hold") {
        // Isometric exercises: sustained near-peak engagement (not a rise-then-fall) starts the hold.
        if (angleDeg >= this.config.minValidExcursionDeg || angleDeg >= this.noiseBandDeg * 2) {
          if (this.holdEngagedSinceMs === null) this.holdEngagedSinceMs = tMs;
          if (tMs - this.holdEngagedSinceMs >= HOLD_ENGAGE_WINDOW_MS) {
            this.phase = "HOLDING";
            this.holdStartMs = this.holdEngagedSinceMs;
          }
        } else {
          this.holdEngagedSinceMs = null;
        }
        return null;
      }
      if (angleDeg < this.peakDeg - this.noiseBandDeg) {
        this.phase = "RETURNING";
        this.returnStartMs = tMs;
      }
      return null;
    }

    if (this.phase === "HOLDING") {
      if (this.holdStartMs !== null) this.accumulatedHoldSec = (tMs - this.holdStartMs) / 1000;
      const target = this.config.holdTargetSec ?? 0;
      const droppedOut = angleDeg < this.peakDeg - this.noiseBandDeg * 2;
      if (droppedOut || (target > 0 && this.accumulatedHoldSec >= target)) {
        this.phase = "RETURNING";
        this.returnStartMs = tMs;
      }
      return null;
    }

    // RETURNING
    if (Math.abs(angleDeg) <= this.noiseBandDeg) {
      return this.closeRep(tMs, true);
    }
    return null;
  }

  private beginRep(first: Sample): void {
    this.phase = "RISING";
    this.repStartMs = first.tMs;
    this.buffer = [first];
    this.peakDeg = first.angleDeg;
    this.returnStartMs = null;
    this.holdStartMs = null;
    this.holdEngagedSinceMs = null;
    this.accumulatedHoldSec = 0;
    this.lowSignalSamples = first.signalOk ? 0 : 1;
    this.totalSamples = 1;
  }

  private closeRep(nowMs: number, completed: boolean): RepResult {
    const index = this.repIndex;
    this.repIndex += 1;

    const tempoSec = Math.max(0, (nowMs - this.repStartMs) / 1000);
    const returnDurationSec = this.returnStartMs !== null ? Math.max(0, (nowMs - this.returnStartMs) / 1000) : undefined;
    const lowSignalRatio = this.totalSamples > 0 ? this.lowSignalSamples / this.totalSamples : 0;
    const lossReason: RepResult["lossReason"] = lowSignalRatio > 0.5 ? "sensor" : null;
    const clearsExcursion = this.peakDeg >= this.config.minValidExcursionDeg;
    const validForVolume = completed && clearsExcursion && lossReason === null;

    const result: RepResult = {
      index,
      startedAtMs: this.repStartMs,
      endedAtMs: nowMs,
      peakExcursionDeg: Math.round(this.peakDeg * 10) / 10,
      completed,
      validForVolume,
      tempoSec: Math.round(tempoSec * 100) / 100,
      smoothness01: smoothness01(this.buffer.map((s) => ({ tMs: s.tMs, angleDeg: s.angleDeg }))),
      holdSec: Math.round(this.accumulatedHoldSec * 100) / 100,
      returnDurationSec: returnDurationSec !== undefined ? Math.round(returnDurationSec * 100) / 100 : undefined,
      lossReason,
    };

    if (this.config.slug === "short_arc_quad" && this.calibrationBaselineAbsoluteDeg !== undefined) {
      result.startAngleDeg = this.calibrationBaselineAbsoluteDeg;
      result.finalAngleDeg = this.calibrationBaselineAbsoluteDeg - this.peakDeg;
    }

    this.phase = "IDLE";
    this.buffer = [];
    return result;
  }
}
