// Execution Effectiveness = 0.50 x Correctness + 0.20 x Volume + 0.30 x Target — spec §2, verbatim, the
// canonical session-level rollup. Verified against the docx's own Heel Slide worked example (§14:
// Correctness_session ~88.1, Volume 100, Target_session ~92.5 -> Execution ~91.8) — see
// executionScore.test.ts.
//
// A component that could not be measured at all is DROPPED and the remaining weights are renormalised
// over what was used, and the weights that were actually applied come back in `componentsUsed`. This is
// a port of PHOENIX's assess_execution (services/imu-tools/src/mova_imu/analysis/execution_score.py:
// 304-323), not a new scheme: that function filters out the None components, divides by used_weight, and
// reports components_used for exactly this reason. Its companion tool prints the disclosure wording
// beside every dropped component — "(not scored -- left out, weight redistributed)",
// services/imu-tools/tools/check_execution_score.py:70 — which is the vocabulary the patient-facing
// panel follows.
//
// DELIBERATE LIMITATION, state it rather than hide it: the redistribution here is at the COMPONENT level
// only. A Correctness computed from half of its declared technique weight still enters this rollup at
// the full 0.50. That is PHOENIX's behaviour too. What has changed is that the caller can now see it,
// through the ComponentScore's `weightUsed`. Whether Correctness's rollup weight should itself be scaled
// by `weightUsed` is a real clinical question and a bigger behaviour change; it is left open on purpose
// instead of being decided quietly inside this function.
//
// OPEN DISCREPANCY, not resolved by this file: the docx's second worked example (§15, "reps done but
// target not reached") shows Correctness 90, Volume 100, Target ~25 giving "E_raw ~72.5" (which matches
// this exact formula), then a further "После target cap" row showing a LOWER final value of 64/100, with
// no formula given for that second step anywhere in the document (SessionResult's score_cap_reason field
// in §17 suggests one exists). This function implements only the canonical §2 formula (E_raw) — it does
// NOT apply whatever additional cap produced 64 in that example, because guessing an unspecified formula
// would be exactly the kind of invented number this whole project exists to avoid. Nothing in
// ExecutionResult should be read as evidence that the cap was applied: `componentsUsed` reports the
// three rollup weights and nothing else, and there is still no score_cap_reason field anywhere.
// Flag to product/clinical spec owner before this ships: does a low-Target-Score session need an
// additional cap beyond the weighted formula, and if so, what is it?

import type { ComponentScore, ExecutionComponentName, ExecutionResult } from "./types";

/** The spec §2 rollup weights. Exported so a caller can explain the arithmetic it is showing. */
export const CORRECTNESS_WEIGHT = 0.5;
export const VOLUME_WEIGHT = 0.2;
export const TARGET_WEIGHT = 0.3;

export function executionEffectiveness(
  correctness: ComponentScore,
  volume: number | null,
  target: ComponentScore,
): ExecutionResult {
  const entries: Array<[ExecutionComponentName, number | null, number]> = [
    ["correctness", correctness.score, CORRECTNESS_WEIGHT],
    ["volume", volume, VOLUME_WEIGHT],
    ["target", target.score, TARGET_WEIGHT],
  ];

  const used = entries.filter((e): e is [ExecutionComponentName, number, number] => e[1] !== null);
  const abstained = entries.filter((e) => e[1] === null).map((e) => e[0]);
  const usedWeight = used.reduce((sum, [, , weight]) => sum + weight, 0);
  // Nothing at all was measured. There is no number to report, and neither 0 nor 100 would be one.
  if (usedWeight <= 0) return { score: null, componentsUsed: {}, abstained };

  const raw = used.reduce((sum, [, score, weight]) => sum + score * weight, 0) / usedWeight;
  const componentsUsed: ExecutionResult["componentsUsed"] = {};
  for (const [name, , weight] of used) {
    componentsUsed[name] = Math.round((weight / usedWeight) * 1000) / 1000;
  }
  return { score: Math.round(raw), componentsUsed, abstained };
}
