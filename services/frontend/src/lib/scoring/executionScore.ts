// Execution Effectiveness = 0.50 x Correctness + 0.20 x Volume + 0.30 x Target — spec §2, verbatim, the
// canonical session-level rollup. Verified against the docx's own Heel Slide worked example (§14:
// Correctness_session ~88.1, Volume 100, Target_session ~92.5 -> Execution ~91.8) — see
// executionScore.test.ts.
//
// OPEN DISCREPANCY, not resolved by this file: the docx's second worked example (§15, "reps done but
// target not reached") shows Correctness 90, Volume 100, Target ~25 giving "E_raw ~72.5" (which matches
// this exact formula), then a further "После target cap" row showing a LOWER final value of 64/100, with
// no formula given for that second step anywhere in the document (SessionResult's score_cap_reason field
// in §17 suggests one exists). This function implements only the canonical §2 formula (E_raw) — it does
// NOT apply whatever additional cap produced 64 in that example, because guessing an unspecified formula
// would be exactly the kind of invented number this whole project exists to avoid. Flag to product/clinical
// spec owner before this ships: does a low-Target-Score session need an additional cap beyond the
// weighted formula, and if so, what is it?

export function executionEffectiveness(correctnessScore: number, volumeScore: number, targetScore: number): number {
  return Math.round(0.5 * correctnessScore + 0.2 * volumeScore + 0.3 * targetScore);
}
