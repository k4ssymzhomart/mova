/**
 * sync-content.mjs — Phase 8 credibility-surface ETL.
 *
 * Reads the canonical Phase 2 / Phase 3 artifacts at the repo root and emits
 * derived JSON into src/content/generated/. The credibility pages (/model,
 * /datasets, /benchmark, /research, /docs) import only these generated files,
 * so every metric they render provably descends from a real artifact — nothing
 * is hand-typed. Re-run with `npm run sync:content` (also runs on predev/prebuild).
 *
 * Single source of truth lives at the repo root:
 *   data_manifests/model_registry.json     -> model cards / metrics
 *   benchmark/leaderboard.json             -> leaderboard + ablations + generalization
 *   data_manifests/schemas/canonical.json  -> canonical IMU schema + per-dataset facts
 *   data_manifests/splits/subject_splits.json
 *   data_manifests/norm_stats/train_stats.json
 *   data_manifests/dataset_cards/*.md      -> dataset prose (role, facts, caveats)
 *   reports/*.json                         -> per-fold + per-placement held-out detail
 *   references.bib                         -> citations rendered on /research
 *   contracts/inference/v1/inference.schema.json -> /docs API contract
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../.."); // services/frontend/scripts -> repo root
const OUT_DIR = resolve(__dirname, "../src/content/generated");

mkdirSync(OUT_DIR, { recursive: true });

const readText = (rel) => readFileSync(join(REPO_ROOT, rel), "utf8");
const readJson = (rel) => JSON.parse(readText(rel));
const writeJson = (name, data) =>
  writeFileSync(join(OUT_DIR, name), JSON.stringify(data, null, 2) + "\n");

/* ------------------------------------------------------------------ */
/* 1. Verbatim copies of structured artifacts                          */
/* ------------------------------------------------------------------ */

const modelRegistry = readJson("data_manifests/model_registry.json");
const leaderboard = readJson("benchmark/leaderboard.json");
const canonical = readJson("data_manifests/schemas/canonical.json");
const subjectSplits = readJson("data_manifests/splits/subject_splits.json");
const normStats = readJson("data_manifests/norm_stats/train_stats.json");
const harEval = readJson("reports/har.json");
const movementQuality = readJson("reports/movement_quality.json");
const phase3 = readJson("reports/phase3_summary.json");
const inferenceSchema = readJson("contracts/inference/v1/inference.schema.json");

writeJson("model_registry.json", modelRegistry);
writeJson("leaderboard.json", leaderboard);
writeJson("canonical_schema.json", canonical);
writeJson("subject_splits.json", subjectSplits);
writeJson("norm_stats.json", normStats);
writeJson("har_eval.json", harEval);
writeJson("movement_quality.json", movementQuality);
writeJson("phase3_summary.json", phase3);
writeJson("inference_schema.json", inferenceSchema);

/* ------------------------------------------------------------------ */
/* 2. FoG per-fold table (the honest held-out detail)                  */
/* ------------------------------------------------------------------ */

const fogReport = readJson("reports/fog_loso_ssl.json");
const fogFolds = {
  _source: "reports/fog_loso_ssl.json",
  protocol: fogReport.protocol,
  loss: fogReport.loss,
  threshold_policy: fogReport.threshold_policy,
  baseline_auroc: fogReport.baseline_auroc,
  summary: fogReport.summary_tuned,
  folds: fogReport.folds.map((f) => ({
    test_subject: f.test_subject,
    val_subject: f.val_subject,
    n_test_windows: f.n_test_windows,
    n_test_freeze: f.n_test_freeze,
    freeze_prevalence: f.n_test_freeze / f.n_test_windows,
    auroc: f.tuned.auroc,
    auprc: f.tuned.auprc,
    sensitivity: f.tuned.sensitivity,
    specificity: f.tuned.specificity,
    threshold: f.tuned.threshold,
  })),
};
writeJson("fog_folds.json", fogFolds);

/* ------------------------------------------------------------------ */
/* 3. Dataset cards — parse role / facts / caveats from markdown       */
/* ------------------------------------------------------------------ */

function parseDatasetCard(md, id) {
  const nameMatch = md.match(/^#\s*Dataset card\s*[—-]\s*(.+)$/m);
  const name = nameMatch ? nameMatch[1].trim() : id;

  // **Role:** ... · **Task:** ... · **Modality:** ...
  const roleLine = (md.match(/^\*\*Role:\*\*.*$/m) || [""])[0];
  const grab = (key) => {
    const re = new RegExp(`\\*\\*${key}:\\*\\*\\s*([^·]+?)(?:\\s*·|$)`);
    const m = roleLine.match(re);
    return m ? m[1].trim() : "";
  };
  const role = grab("Role");
  const task = grab("Task");
  const modality = grab("Modality");

  // Key/value markdown table rows: | a | b |
  const facts = [];
  for (const line of md.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("|") || !t.endsWith("|")) continue;
    const cells = t.slice(1, -1).split("|").map((c) => c.trim());
    if (cells.length !== 2) continue;
    if (cells.every((c) => /^-*:?-*$/.test(c) || c === "")) continue; // separator / empty
    facts.push({ k: cells[0], v: cells[1] });
  }

  // Section bodies keyed by "## Heading"
  const sections = {};
  const parts = md.split(/^##\s+/m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf("\n");
    const heading = part.slice(0, nl).trim();
    sections[heading] = part.slice(nl + 1).trim();
  }
  const firstSentence = (s) =>
    s ? s.replace(/`[^`]*`\s*$/m, "").split(/(?<=\.)\s/)[0].trim() : "";

  const caveats = sections["Known limitations"]
    ? sections["Known limitations"].split(/`?format_verified/)[0].trim()
    : "";
  const evalAxis = firstSentence(sections["Splits / eval axis"]);

  const verifiedMatch = md.match(/format_verified_against_real_data:\s*(true|false)/);
  const verified = verifiedMatch ? verifiedMatch[1] === "true" : null;

  return { id, name, role, task, modality, facts, caveats, evalAxis, verified };
}

const cardsDir = "data_manifests/dataset_cards";
const datasetCards = readdirSync(join(REPO_ROOT, cardsDir))
  .filter((f) => f.endsWith(".md"))
  .sort()
  .map((f) => parseDatasetCard(readText(`${cardsDir}/${f}`), f.replace(/\.md$/, "")));
writeJson("dataset_cards.json", { _source: cardsDir, cards: datasetCards });

/* ------------------------------------------------------------------ */
/* 4. references.bib -> structured citations                           */
/* ------------------------------------------------------------------ */

function parseBib(text) {
  const entries = [];
  const re = /@(\w+)\s*\{\s*([^,]+),([\s\S]*?)\n\}/g;
  let m;
  while ((m = re.exec(text))) {
    const [, type, key, body] = m;
    const fields = {};
    // Value may be a brace group (with one level of nested LaTeX-accent braces),
    // a quoted string, or a bare token.
    const fre =
      /(\w+)\s*=\s*(\{(?:[^{}]|\{[^{}]*\})*\}|"[^"]*"|[^,\n]+)\s*,?/g;
    let fm;
    while ((fm = fre.exec(body))) {
      let val = fm[2].trim().replace(/,$/, "");
      val = val.replace(/^[{"]|[}"]$/g, "");
      // ASCII-ize LaTeX accents: \"{u} / \"o -> u / o, then drop stray braces.
      val = val.replace(/\\[`'"^~=.]?\{?(\w)\}?/g, "$1").replace(/[{}\\]/g, "").trim();
      fields[fm[1].toLowerCase()] = val.replace(/\s+/g, " ");
    }
    entries.push({ key: key.trim(), type: type.toLowerCase(), fields });
  }
  return entries;
}

// Outbound links we are confident about (project / DOI pages). Where a key has
// no certain canonical URL we fall back to a Google Scholar title search — the
// same honest pattern used by research-data.ts (we never host PDFs).
const CITATION_LINKS = {
  AMASS_HDM05: {
    url: "https://resources.mpi-inf.mpg.de/HDM05/",
    linkLabel: "HDM05 database",
  },
  "DIP:SIGGRAPHAsia:2018": {
    url: "https://dip.is.tue.mpg.de/",
    doi: "10.1145/3272127.3275108",
    arxiv: "1810.04703",
    linkLabel: "Project page",
  },
};
const scholar = (q) =>
  `https://scholar.google.com/scholar?q=${encodeURIComponent(q)}`;

const citations = parseBib(readText("references.bib")).map((e) => {
  const f = e.fields;
  const venue = f.journal || f.institution || f.booktitle || f.publisher || "";
  const enrich = CITATION_LINKS[e.key] || {};
  return {
    key: e.key,
    type: e.type,
    title: f.title || e.key,
    authors: f.author || "",
    year: f.year || "",
    venue,
    number: f.number || "",
    url: enrich.url || scholar(f.title || e.key),
    linkLabel: enrich.linkLabel || "Find paper",
    doi: enrich.doi || "",
    arxiv: enrich.arxiv || "",
  };
});
writeJson("references.json", {
  _source: "references.bib",
  note: "Citations are rendered with title + authors/venue/year + an outbound link. PDFs are never hosted (operating rule).",
  citations,
});

/* ------------------------------------------------------------------ */
/* 5. Derived corpus meta                                              */
/* ------------------------------------------------------------------ */

const meta = {
  _note: "GENERATED by scripts/sync-content.mjs — do not edit by hand.",
  generated_utc: new Date().toISOString(),
  git_sha: modelRegistry.models?.[0]?.git_sha || "",
  registry_updated_utc: modelRegistry.updated_utc,
  // Headline corpus size as documented by the Phase 2 data platform.
  corpus_windows: 672221,
  corpus_windows_source:
    "docs/MOVA_MASTER_DOCUMENT.md — 50 Hz pipeline -> 672,221 subject-disjoint windows",
  // Machine-verifiable per-report counts (the ones we can recompute from artifacts).
  har_train_windows: harEval.n_train_windows,
  har_test_windows: harEval.n_test_windows,
  norm_stats_samples: normStats.count_samples,
  canonical_rate_hz: canonical.canonical.sampling_rate_hz,
  window_seconds: canonical.canonical.window.seconds,
  n_datasets: Object.keys(canonical.datasets).length,
};
writeJson("meta.json", meta);

console.log(
  `sync-content: wrote ${readdirSync(OUT_DIR).length} files to src/content/generated ` +
    `(${datasetCards.length} dataset cards, ${citations.length} citations, ${fogFolds.folds.length} FoG folds).`,
);
