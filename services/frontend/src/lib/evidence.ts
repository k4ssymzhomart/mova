/**
 * evidence.ts — the single import surface for everything the credibility pages
 * render. Every value here descends from a generated artifact under
 * src/content/generated/ (produced by scripts/sync-content.mjs from the repo-root
 * Phase 2 / Phase 3 outputs). No metric on /model · /datasets · /benchmark is
 * hand-typed — change the artifact, re-run `npm run sync:content`, and it flows.
 */

import canonical from "@/content/generated/canonical_schema.json";
import datasetCards from "@/content/generated/dataset_cards.json";
import fogFolds from "@/content/generated/fog_folds.json";
import harEval from "@/content/generated/har_eval.json";
import inferenceSchema from "@/content/generated/inference_schema.json";
import leaderboard from "@/content/generated/leaderboard.json";
import meta from "@/content/generated/meta.json";
import movementQuality from "@/content/generated/movement_quality.json";
import normStats from "@/content/generated/norm_stats.json";
import phase3 from "@/content/generated/phase3_summary.json";
import references from "@/content/generated/references.json";
import registry from "@/content/generated/model_registry.json";
import splits from "@/content/generated/subject_splits.json";

export {
  canonical,
  datasetCards,
  fogFolds,
  harEval,
  inferenceSchema,
  leaderboard,
  meta,
  movementQuality,
  normStats,
  phase3,
  references,
  registry,
  splits,
};

/* ---- formatting helpers (tabular, honest precision) ---- */

export const f = (x: number, dp = 3): string => x.toFixed(dp);
export const pct = (x: number, dp = 1): string => `${(x * 100).toFixed(dp)}%`;
export const pm = (mean: number, std: number, dp = 3): string =>
  `${mean.toFixed(dp)} ± ${std.toFixed(dp)}`;
export const pmPct = (mean: number, std: number, dp = 1): string =>
  `${(mean * 100).toFixed(dp)} ± ${(std * 100).toFixed(dp)}%`;
export const int = (n: number): string => n.toLocaleString("en-US");
export const signed = (x: number, dp = 3): string =>
  `${x >= 0 ? "+" : ""}${x.toFixed(dp)}`;
export const shortDate = (iso?: string): string => (iso ? iso.slice(0, 10) : "");

export const titleCase = (s: string): string =>
  s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/* ---- typed convenience views ---- */

export type RegistryModel = (typeof registry.models)[number];

export const fogModel = registry.models.find(
  (m) => m.task === "freezing_of_gait",
) as RegistryModel;
export const harModel = registry.models.find(
  (m) => m.task === "human_activity_recognition",
) as RegistryModel;

// The two registry entries carry different metric shapes, so the JSON-inferred
// union widens member access. These typed views pin the shapes we render.
type Stat = { mean: number; std: number; n: number };
export const fogMetrics = fogModel.metrics as Record<
  "auroc" | "auprc" | "sensitivity" | "specificity",
  Stat
>;
export const fogProvenance = fogModel.provenance as {
  intended_use: string;
  limitations: string[];
};
export const harMacroF1 = (
  harModel.metrics as { macro_f1_overall: number }
).macro_f1_overall;

export const baselineAuroc = leaderboard.baseline.fog_auroc;
