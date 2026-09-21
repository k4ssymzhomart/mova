// Volume Score = min(valid_reps / prescribed_reps, 1.0) x 100 — spec §2, verbatim. Capped at 100:
// extra reps beyond prescription never earn more (spec §7, "Никаких бонусов за reps сверх назначения").
//
// With no prescription there is no fraction to compute, so this abstains instead of returning 0. A zero
// would tell the patient they completed none of their work when in fact nobody had said how much work
// there was. PHOENIX draws the same line: execution_score.py:250-251 returns
// {"score": None, "reason": "no_prescribed_reps"}.

import type { RepResult } from "./types";

export function volumeScore(reps: RepResult[], prescribedReps: number): number | null {
  if (prescribedReps <= 0) return null;
  const validReps = reps.filter((r) => r.validForVolume).length;
  return Math.round(Math.min(validReps / prescribedReps, 1) * 100);
}
