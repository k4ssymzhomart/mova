import type { Metadata } from "next";

import ReadingLayout from "@/components/reading/ReadingLayout";
import {
  Badge,
  Bar,
  Callout,
  DataTable,
  P,
  Section,
  StatCard,
} from "@/components/reading/ui";
import {
  baselineAuroc,
  f,
  harEval,
  int,
  leaderboard,
  movementQuality,
  pct,
  signed,
  titleCase,
} from "@/lib/evidence";

export const metadata: Metadata = {
  title: "Benchmark — Mova",
  description:
    "Mova's generalization leaderboard: cross-subject, cross-device and cross-position protocols, scored against an honest from-scratch baseline.",
};

const TOC = [
  { id: "protocol", label: "Generalization protocol" },
  { id: "leaderboard", label: "Leaderboard" },
  { id: "ablation", label: "SSL vs scratch" },
  { id: "placement", label: "Cross-position drop" },
  { id: "quality", label: "Movement quality (proxy)" },
];

type Entry = {
  model_id: string;
  task: string;
  protocol: string;
  warm_start: string;
  primary_metric: string;
  auroc_mean?: number;
  macro_f1_overall?: number;
  beats_baseline?: boolean;
  delta_vs_baseline?: number;
};

const entries = leaderboard.entries as unknown as Entry[];
const byPlacement = harEval.by_placement as Record<
  string,
  { n: number; macro_f1: number }
>;
const placements = Object.entries(byPlacement).sort(
  (a, b) => b[1].macro_f1 - a[1].macro_f1,
);
const gen = harEval.generalization;
const sslDelta = leaderboard.ablations.ssl_vs_scratch_fog_auroc_delta;

const AXES = [
  {
    axis: "Cross-subject",
    dataset: "Daphnet FoG · LOSO-CV",
    detail:
      "The headline clinical axis. Every reported FoG number leaves one subject entirely out of training, validation and SSL pretraining.",
  },
  {
    axis: "Cross-device",
    dataset: "HHAR · phones vs watches",
    detail:
      "Device heterogeneity — multiple phone and watch models. Train on a subset of device models, test on held-out hardware.",
  },
  {
    axis: "Cross-position",
    dataset: "REALDISP · ideal → self / mutual",
    detail:
      "Sensor displacement. Train on the ideal placement and test on self- and mutually-displaced sensors to prove placement invariance.",
  },
];

export default function BenchmarkPage() {
  return (
    <ReadingLayout
      eyebrow="Benchmark"
      meta={`baseline ${f(baselineAuroc)} · git ${leaderboard.git_sha}`}
      title={
        <>
          Generalisation,
          <br />
          scored honestly.
        </>
      }
      lede="The thesis spine is generalisation: across people, devices and sensor positions. The leaderboard reads from benchmark/leaderboard.json and is always measured against the honest from-scratch baseline — never a within-subject best case."
      toc={TOC}
      intro={
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            tone="signal"
            label="Best FoG AUROC"
            value={f(entries[0].auroc_mean as number)}
            caption={`vs ${f(baselineAuroc)} baseline · ${signed(entries[0].delta_vs_baseline as number, 3)}`}
          />
          <StatCard
            label="SSL ablation"
            value={signed(sslDelta, 3)}
            caption="AUROC, self-supervised minus from-scratch"
          />
          <StatCard
            label="Placement spread"
            value={f(gen.placement_drop_max_minus_min, 2)}
            caption="HAR macro-F1, best minus worst sensor site"
          />
        </div>
      }
    >
      {/* ---- Protocol ---- */}
      <Section id="protocol" title="The generalisation protocol" kicker="Three axes, one rule">
        <P>
          Each generalisation axis is carried by the dataset built to stress it.
          The rule is constant: the thing being tested — subject, device, or
          placement — is held out of training.
        </P>
        <div className="space-y-3">
          {AXES.map((a) => (
            <div
              key={a.axis}
              className="grid gap-2 rounded-card border border-line bg-card p-4 sm:grid-cols-[10rem_1fr] sm:gap-5"
            >
              <div>
                <div className="font-serif text-[1.15rem] text-ink">{a.axis}</div>
                <div className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.08em] text-signal">
                  {a.dataset}
                </div>
              </div>
              <p className="text-[13.5px] leading-relaxed text-ink-soft">
                {a.detail}
              </p>
            </div>
          ))}
        </div>
        <Callout title="The baseline we beat">
          {leaderboard.baseline.note} — AUROC {f(baselineAuroc)}, near chance. It is
          the number every entry below is measured against.
        </Callout>
      </Section>

      {/* ---- Leaderboard ---- */}
      <Section id="leaderboard" title="Leaderboard" kicker={`${entries.length} entries`}>
        <DataTable
          cols={[
            { key: "model", label: "Model", mono: true },
            { key: "task", label: "Task" },
            { key: "warm", label: "Warm start" },
            { key: "metric", label: "Primary", align: "right", mono: true },
            { key: "delta", label: "Δ baseline", align: "right", mono: true },
            { key: "beats", label: "Beats?", align: "right" },
          ]}
          rows={entries.map((e) => {
            const primary =
              e.primary_metric === "auroc"
                ? `AUROC ${f(e.auroc_mean as number)}`
                : `F1 ${f(e.macro_f1_overall as number)}`;
            return {
              model: e.model_id,
              task: titleCase(e.task),
              warm: e.warm_start === "ssl" ? "SSL" : "scratch",
              metric: primary,
              delta:
                e.delta_vs_baseline !== undefined
                  ? signed(e.delta_vs_baseline, 3)
                  : "—",
              beats:
                e.beats_baseline === undefined ? (
                  "—"
                ) : e.beats_baseline ? (
                  <Badge tone="signal">yes</Badge>
                ) : (
                  <Badge tone="warn">no</Badge>
                ),
            };
          })}
          caption="Primary metric per task. FoG protocols share LOSO-CV over 8 freeze-positive subjects. Source: benchmark/leaderboard.json"
        />
        <P>
          Both FoG variants clear the baseline; the SSL warm start leads. HAR is
          reported as macro-F1 over {harEval.n_classes} classes on a subject-disjoint
          split — a hard, honest multi-class number, not a binary headline.
        </P>
      </Section>

      {/* ---- Ablation ---- */}
      <Section id="ablation" title="SSL vs from-scratch" kicker="Does pretraining help?">
        <P>
          The cleanest controlled comparison in the suite: identical encoder and
          protocol, the only difference being the self-supervised warm start.
        </P>
        <DataTable
          cols={[
            { key: "v", label: "Variant" },
            { key: "auroc", label: "AUROC (LOSO)", align: "right", mono: true },
            { key: "delta", label: "Δ baseline", align: "right", mono: true },
          ]}
          rows={entries
            .filter((e) => e.task === "freezing_of_gait")
            .map((e) => ({
              v: e.warm_start === "ssl" ? "SSL pretrained" : "From scratch",
              auroc: f(e.auroc_mean as number),
              delta: signed(e.delta_vs_baseline as number, 3),
            }))}
          caption={`SSL − scratch = ${signed(sslDelta, 3)} AUROC. Source: benchmark/leaderboard.json (ablations)`}
        />
      </Section>

      {/* ---- Placement ---- */}
      <Section id="placement" title="Cross-position breakdown" kicker="Where placement bites">
        <P>
          HAR macro-F1 by sensor site. Subjects are disjoint, but placements were
          seen in training — so this is the honest cap on placement robustness, and
          the {f(gen.placement_drop_max_minus_min, 2)} spread between best and worst
          site is exactly why leave-placement-out is the next experiment.
        </P>
        <div className="space-y-2.5 rounded-card border border-line bg-card p-5">
          {placements.map(([p, v]) => (
            <Bar
              key={p}
              label={p}
              value={v.macro_f1}
              display={f(v.macro_f1, 2)}
              tone={
                v.macro_f1 === gen.placement_macro_f1_max ||
                v.macro_f1 === gen.placement_macro_f1_min
                  ? "signal"
                  : "muted"
              }
            />
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <StatCard
            label="Best site"
            value={f(gen.placement_macro_f1_max, 2)}
            caption="waist — phone-pocket placement, most data"
          />
          <StatCard
            label="Worst site"
            value={f(gen.placement_macro_f1_min, 2)}
            caption="r_calf — adversarial mutual displacement"
          />
        </div>
      </Section>

      {/* ---- Quality ---- */}
      <Section id="quality" title="Movement quality (research proxy)" kicker="Not on the board yet">
        <div className="flex flex-wrap gap-2">
          <Badge tone="warn">{titleCase(movementQuality.status)}</Badge>
          <Badge>target r ≥ {f(movementQuality.correlation_target, 1)}</Badge>
        </div>
        <P>{movementQuality.data_note}</P>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            tone="signal"
            label="Pearson r"
            value={f(movementQuality.pearson_r)}
            caption={`held-out ${movementQuality.test_subject} · ${int(movementQuality.n_test)} windows`}
          />
          <StatCard
            label="MAE"
            value={f(movementQuality.mae)}
            caption={movementQuality.target}
          />
          <StatCard
            label="Coverage"
            value={`${pct(movementQuality.pearson_r / movementQuality.correlation_target, 0)}`}
            caption={`of the r ≥ ${f(movementQuality.correlation_target, 1)} target`}
          />
        </div>
      </Section>
    </ReadingLayout>
  );
}
