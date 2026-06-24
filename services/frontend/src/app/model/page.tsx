import type { Metadata } from "next";

import ReadingLayout from "@/components/reading/ReadingLayout";
import {
  Badge,
  Bar,
  Callout,
  DataTable,
  KeyVal,
  P,
  Section,
  StatCard,
} from "@/components/reading/ui";
import {
  baselineAuroc,
  f,
  fogFolds,
  fogMetrics,
  fogModel,
  fogProvenance,
  harEval,
  harMacroF1,
  harModel,
  int,
  leaderboard,
  meta,
  movementQuality,
  pct,
  pm,
  shortDate,
  signed,
  titleCase,
} from "@/lib/evidence";

export const metadata: Metadata = {
  title: "Model card — Mova",
  description:
    "Architecture, training recipe and honest held-out metrics for Mova's SSL-pretrained IMU encoder and its freezing-of-gait and activity-recognition heads.",
};

const TOC = [
  { id: "registry", label: "Model registry" },
  { id: "fog", label: "Freezing-of-gait detector" },
  { id: "folds", label: "Per-subject (LOSO) detail" },
  { id: "har", label: "Activity recognition" },
  { id: "quality", label: "Movement quality (proxy)" },
  { id: "provenance", label: "Provenance & limitations" },
];

const fogDelta = leaderboard.entries.find(
  (e) => e.model_id === "mova-fog-ssl-loso",
)?.delta_vs_baseline as number;
const sslDelta = leaderboard.ablations.ssl_vs_scratch_fog_auroc_delta;
const scratchAuroc = leaderboard.entries.find(
  (e) => e.model_id === "mova-fog-scratch-loso",
)?.auroc_mean as number;

export default function ModelPage() {
  return (
    <ReadingLayout
      eyebrow="Model card"
      meta={`${meta.n_datasets} datasets · git ${meta.git_sha} · ${shortDate(meta.registry_updated_utc)}`}
      title={
        <>
          One encoder,
          <br />
          clinical heads on top.
        </>
      }
      lede="Mova pretrains a single LIMU-BERT IMU encoder with self-supervision, then fine-tunes tiny task heads. Every number below is read straight from data_manifests/model_registry.json and the held-out evaluation reports — not a slide."
      toc={TOC}
      intro={
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            tone="signal"
            label="FoG AUROC (LOSO)"
            value={f(fogMetrics.auroc.mean)}
            caption={`±${f(fogMetrics.auroc.std)} across ${fogMetrics.auroc.n} subjects · baseline ${f(baselineAuroc)}`}
          />
          <StatCard
            label="Δ vs baseline"
            value={signed(fogDelta, 3)}
            caption="subject-independent AUROC lift over the honest from-scratch baseline"
          />
          <StatCard
            label="Encoder"
            value={`${fogModel.encoder.hidden}d`}
            caption={`LIMU-BERT transformer · ${fogModel.encoder.n_layers} layers · 6-channel IMU`}
          />
        </div>
      }
    >
      {/* ---- Registry ---- */}
      <Section id="registry" title="What's in the registry" kicker="Two cards, one encoder">
        <P>
          The model registry is the source of truth for everything shipped from
          Phase 3. Two task heads share the self-supervised encoder; each carries
          its own protocol, leakage controls and honest metrics.
        </P>
        <DataTable
          cols={[
            { key: "id", label: "Model ID", mono: true },
            { key: "task", label: "Task" },
            { key: "data", label: "Training data" },
            { key: "protocol", label: "Protocol" },
            { key: "headline", label: "Headline", align: "right", mono: true },
          ]}
          rows={[
            {
              id: fogModel.model_id,
              task: "Freezing of gait",
              data: fogModel.training_data.datasets.join(", "),
              protocol: fogModel.training_data.protocol,
              headline: `AUROC ${f(fogMetrics.auroc.mean)}`,
            },
            {
              id: harModel.model_id,
              task: "Activity recognition",
              data: harModel.training_data.datasets.join(", "),
              protocol: harModel.training_data.protocol,
              headline: `F1 ${f(harMacroF1)}`,
            },
          ]}
          caption="Source: data_manifests/model_registry.json"
        />
      </Section>

      {/* ---- FoG ---- */}
      <Section id="fog" title="Freezing-of-gait detector" kicker={fogModel.model_id}>
        <P>{fogModel.description}</P>

        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
              Architecture
            </h3>
            <KeyVal
              items={[
                { k: "Encoder", v: "LIMU-BERT transformer" },
                { k: "Hidden", v: `${fogModel.encoder.hidden}` },
                { k: "Layers", v: `${fogModel.encoder.n_layers}` },
                { k: "Input", v: "6-channel IMU (acc xyz + gyro xyz)" },
                { k: "SSL pretrain", v: fogModel.training_data.ssl_pretraining },
              ]}
            />
          </div>
          <div>
            <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
              Training recipe
            </h3>
            <KeyVal
              items={[
                { k: "Protocol", v: fogModel.training_data.protocol },
                { k: "Loss", v: <code className="font-mono text-[12px]">{fogFolds.loss}</code> },
                { k: "Threshold", v: fogFolds.threshold_policy },
                { k: "Leakage control", v: fogModel.training_data.leakage_control },
                { k: "Baseline", v: `AUROC ${f(baselineAuroc)} (from-scratch, single-subject)` },
              ]}
            />
          </div>
        </div>

        <div>
          <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
            Held-out metrics (LOSO mean ± std, n={fogMetrics.auroc.n})
          </h3>
          <DataTable
            cols={[
              { key: "metric", label: "Metric" },
              { key: "value", label: "Tuned operating point", align: "right", mono: true },
            ]}
            rows={[
              { metric: "AUROC", value: pm(fogMetrics.auroc.mean, fogMetrics.auroc.std) },
              { metric: "AUPRC", value: pm(fogMetrics.auprc.mean, fogMetrics.auprc.std) },
              { metric: "Sensitivity", value: pm(fogMetrics.sensitivity.mean, fogMetrics.sensitivity.std) },
              { metric: "Specificity", value: pm(fogMetrics.specificity.mean, fogMetrics.specificity.std) },
              { metric: "Balanced accuracy", value: pm(fogFolds.summary.balanced_accuracy.mean, fogFolds.summary.balanced_accuracy.std) },
              { metric: "Macro F1", value: pm(fogFolds.summary.macro_f1.mean, fogFolds.summary.macro_f1.std) },
            ]}
            caption="Source: reports/fog_loso_ssl.json · operating point tuned on the val subject at specificity ≥ 0.85"
          />
        </div>

        <Callout tone="signal" title={`SSL earns its keep: ${signed(sslDelta, 3)} AUROC`}>
          Self-supervised pretraining lifts subject-independent AUROC by{" "}
          {f(sslDelta, 3)} over an identical from-scratch encoder (
          {f(fogMetrics.auroc.mean)} vs {f(scratchAuroc)}). Modest, but measured
          honestly — and the whole point of the thesis is that this gap grows with
          unlabeled data.
        </Callout>
      </Section>

      {/* ---- Folds ---- */}
      <Section id="folds" title="Per-subject (LOSO) detail" kicker="Where the variance lives">
        <P>
          Leave-one-subject-out means the test subject was never in train, val, or
          SSL pretraining. Per-subject variance is high — a few subjects dominate
          the error — which is exactly why we report the spread, not a single fold.
        </P>
        <DataTable
          cols={[
            { key: "s", label: "Test subj", mono: true },
            { key: "n", label: "Windows", align: "right", mono: true },
            { key: "fz", label: "Freeze %", align: "right", mono: true },
            { key: "auroc", label: "AUROC", align: "right", mono: true },
            { key: "sens", label: "Sens", align: "right", mono: true },
            { key: "spec", label: "Spec", align: "right", mono: true },
          ]}
          rows={fogFolds.folds.map((fold) => ({
            s: fold.test_subject,
            n: int(fold.n_test_windows),
            fz: pct(fold.freeze_prevalence, 1),
            auroc: f(fold.auroc),
            sens: f(fold.sensitivity, 2),
            spec: f(fold.specificity, 2),
          }))}
          caption="Each row is one held-out Daphnet subject at its tuned threshold. Source: reports/fog_loso_ssl.json"
        />
      </Section>

      {/* ---- HAR ---- */}
      <Section id="har" title="Activity recognition" kicker={harModel.model_id}>
        <P>{harModel.description}</P>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Macro F1 (overall)"
            value={f(harMacroF1)}
            caption={`${harEval.n_classes} classes · subject-disjoint test`}
          />
          <StatCard
            label="Train / test windows"
            value={`${Math.round(harEval.n_train_windows / 1000)}k`}
            caption={`${int(harEval.n_train_windows)} train · ${int(harEval.n_test_windows)} test`}
          />
          <StatCard
            label="SSL pretraining"
            value="HHAR + REALDISP"
            caption="masked + contrastive; no test windows seen"
          />
        </div>
        <div>
          <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
            By source dataset
          </h3>
          <DataTable
            cols={[
              { key: "ds", label: "Dataset" },
              { key: "n", label: "Test windows", align: "right", mono: true },
              { key: "f1", label: "Macro F1", align: "right", mono: true },
            ]}
            rows={Object.entries(harEval.by_dataset).map(([ds, v]) => ({
              ds: ds.toUpperCase(),
              n: int(v.n),
              f1: f(v.macro_f1),
            }))}
            caption="Source: reports/har.json"
          />
        </div>
      </Section>

      {/* ---- Quality ---- */}
      <Section id="quality" title="Movement quality" kicker="Research proxy — not yet clinical">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="warn">{titleCase(movementQuality.status)}</Badge>
          <Badge>target r ≥ {f(movementQuality.correlation_target, 1)}</Badge>
        </div>
        <P>{movementQuality.data_note}</P>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            tone="signal"
            label="Pearson r"
            value={f(movementQuality.pearson_r)}
            caption={`vs ${movementQuality.target}`}
          />
          <StatCard
            label="MAE"
            value={f(movementQuality.mae)}
            caption={`held-out subject ${movementQuality.test_subject}`}
          />
          <StatCard
            label="Windows"
            value={int(movementQuality.n_windows)}
            caption={`${movementQuality.n_subjects} subjects · placement ${movementQuality.placement}`}
          />
        </div>
        <Callout title="Honest status">
          Smoothness regression on AMASS virtual-IMU correlates at r ={" "}
          {f(movementQuality.pearson_r)} with the pose-derived target — promising, but
          the real clinician-scored evaluation (KIMORE / UI-PRMD) is pending data
          access. We do not claim a clinical movement-quality score yet.
        </Callout>
      </Section>

      {/* ---- Provenance ---- */}
      <Section id="provenance" title="Provenance & honest limitations" kicker="Read this before you trust it">
        <Callout tone="signal" title="Intended use">
          {fogProvenance.intended_use}
        </Callout>
        <div>
          <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
            Known limitations & failure modes
          </h3>
          <ul className="space-y-2">
            {fogProvenance.limitations.map((l, i) => (
              <li
                key={i}
                className="flex gap-3 text-[14px] leading-relaxed text-ink-soft"
              >
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-signal" />
                {l}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
            Artifacts
          </h3>
          <KeyVal
            items={[
              { k: "Checkpoint", v: <code className="font-mono text-[12px]">{fogModel.artifacts.checkpoint}</code> },
              { k: "ONNX", v: <code className="font-mono text-[12px]">{fogModel.artifacts.onnx}</code> },
              { k: "Eval JSON", v: <code className="font-mono text-[12px]">{fogModel.artifacts.eval_json}</code> },
              { k: "Commit", v: <code className="font-mono text-[12px]">{fogModel.git_sha}</code> },
              { k: "Created", v: shortDate(fogModel.created_utc) },
            ]}
          />
        </div>
      </Section>
    </ReadingLayout>
  );
}
