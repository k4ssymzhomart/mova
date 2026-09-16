// The one-cue rule — spec §9.1, priority ladder implemented exactly as specified. A pure function: no
// React, unit-testable the same way lib/ble/signalQuality.test.ts tests evaluateSignalQuality. Emits at
// most one cue per completed rep (spec: "После каждого rep система выбирает одно главное сообщение"),
// except the sensor/sync cue (priority 1) which can interrupt at any time but is debounced so a
// momentarily flickering signal-quality reading doesn't spam the patient (spec's own PAT-05A "must not
// flicker" requirement, plan's explicit debounce/hysteresis ask).
//
// Priority 2 ("rep not completed") fires for a rep the detector had to abandon (timed out without
// returning to baseline) rather than a live "still mid-rep" nag — that keeps this function stateless
// and rep-boundary-driven like every other level, and matches the spec's "Rep не завершен" phrasing.

import type { SignalQualityReport } from "@/lib/ble/signalQuality";
import { perRepTargetScore } from "./targetScore";
import type { CueCode, ExerciseConfig, LiveCue, RepResult } from "./types";

const SENSOR_CUE_DEBOUNCE_MS = 1500;
const SMOOTHNESS_FLOOR = 0.6;
/** Below this per-rep target score, the target is "far"; at/above it but under 100, "close". */
const TARGET_CLOSE_THRESHOLD = 85;

export interface CueContext {
  signal: SignalQualityReport;
  lastCompletedRep: RepResult | null;
  config: ExerciseConfig;
  nowMs: number;
}

function ladderForRep(config: ExerciseConfig, rep: RepResult): { priority: 2 | 3 | 4 | 5 | 6 | 7; code: CueCode } {
  if (!rep.completed) return { priority: 2, code: "rep_incomplete" };

  const targetScore = perRepTargetScore(config, rep);
  if (targetScore < TARGET_CLOSE_THRESHOLD) return { priority: 3, code: "target_far" };
  if (targetScore < 100) return { priority: 4, code: "target_close" };
  if (rep.tempoSec < config.tempoRangeSec[0]) return { priority: 5, code: "too_fast" };
  if (rep.smoothness01 < SMOOTHNESS_FLOOR) return { priority: 6, code: "low_smoothness" };
  return { priority: 7, code: "all_good" };
}

/** Selects the single active cue given the current signal report and the most recently completed rep.
 *  Pass back the previously-returned cue as `lastEmitted` each call — this decides whether to hold it,
 *  replace it, or clear it. */
export function selectCue(ctx: CueContext, lastEmitted: LiveCue | null): LiveCue | null {
  const { signal, lastCompletedRep, config, nowMs } = ctx;

  if (!signal.scoringPermitted) {
    const alreadyShowingSensorCue = lastEmitted?.code === "sensor_problem";
    const debounceElapsed = !lastEmitted || nowMs - lastEmitted.emittedAtMs >= SENSOR_CUE_DEBOUNCE_MS;
    if (alreadyShowingSensorCue && !debounceElapsed) return lastEmitted; // hold through the debounce window
    return { priority: 1, code: "sensor_problem", repIndex: lastCompletedRep?.index ?? -1, emittedAtMs: nowMs };
  }

  if (!lastCompletedRep) {
    // Signal is fine but no rep has closed yet — clear a stale sensor cue, otherwise show nothing.
    return lastEmitted?.code === "sensor_problem" ? null : lastEmitted;
  }

  const alreadyShownForThisRep = lastEmitted?.code !== "sensor_problem" && lastEmitted?.repIndex === lastCompletedRep.index;
  if (alreadyShownForThisRep) return lastEmitted;

  const { priority, code } = ladderForRep(config, lastCompletedRep);
  return { priority, code, repIndex: lastCompletedRep.index, emittedAtMs: nowMs };
}
