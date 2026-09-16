// Volume Score = min(valid_reps / prescribed_reps, 1.0) x 100 — spec §2, verbatim. Capped at 100:
// extra reps beyond prescription never earn more (spec §7, "Никаких бонусов за reps сверх назначения").

import type { RepResult } from "./types";

export function volumeScore(reps: RepResult[], prescribedReps: number): number {
  if (prescribedReps <= 0) return 0;
  const validReps = reps.filter((r) => r.validForVolume).length;
  return Math.round(Math.min(validReps / prescribedReps, 1) * 100);
}
