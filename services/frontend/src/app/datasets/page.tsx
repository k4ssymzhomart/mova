import type { Metadata } from "next";

import ReadingLayout from "@/components/reading/ReadingLayout";
import {
  Badge,
  Callout,
  DataTable,
  KeyVal,
  P,
  RichText,
  Section,
  StatCard,
} from "@/components/reading/ui";
import {
  canonical,
  datasetCards,
  int,
  meta,
  splits,
  titleCase,
} from "@/lib/evidence";

export const metadata: Metadata = {
  title: "Datasets — Mova",
  description:
    "The canonical IMU schema and corpus statistics behind Mova: one intermediate representation, eight datasets, 672k subject-disjoint windows.",
};

const TOC = [
  { id: "corpus", label: "The corpus" },
  { id: "schema", label: "Canonical schema" },
  { id: "datasets", label: "Datasets" },
  { id: "vocab", label: "Vocabularies" },
  { id: "splits", label: "Splits & leakage" },
];

const can = canonical.canonical;
const cards = datasetCards.cards;
const datasetMeta = canonical.datasets as Record<
  string,
  { task?: string; native_sampling_rate_hz?: unknown; modality_emitted?: string }
>;

export default function DatasetsPage() {
  return (
    <ReadingLayout
      eyebrow="Data platform"
      meta={`schema v${canonical.schema_version} · ${meta.n_datasets} datasets`}
      title={
        <>
          One schema.
          <br />
          Eight datasets.
        </>
      }
      lede="Every dataset adapter emits the same canonical IMU record — normalised units, body-placement ontology, and a 50 Hz windowing grid — so cross-device and cross-position generalisation is a property of the data, not an afterthought. These pages read directly from data_manifests/."
      toc={TOC}
      intro={
        <div className="grid gap-4 sm:grid-cols-4">
          <StatCard
            tone="signal"
            label="Canonical windows"
            value={`${Math.round(meta.corpus_windows / 1000)}k`}
            caption={`${int(meta.corpus_windows)} subject-disjoint, 50 Hz windows`}
          />
          <StatCard
            label="Sampling rate"
            value={`${can.sampling_rate_hz} Hz`}
            caption={`${can.window.seconds}s windows · ${can.window.target_samples} samples · ${can.window.overlap * 100}% overlap`}
          />
          <StatCard
            label="Datasets"
            value={`${meta.n_datasets}`}
            caption="IMU, virtual-IMU and pose sources on one schema"
          />
          <StatCard
            label="Training samples"
            value={`${(meta.norm_stats_samples / 1e6).toFixed(1)}M`}
            caption="6-channel rows behind the normalisation stats"
          />
        </div>
      }
    >
      {/* ---- Corpus ---- */}
      <Section id="corpus" title="The corpus" kicker="Mixed modalities, one grid">
        <P>{canonical.description}</P>
        <Callout title="On the 672k figure">
          The headline {int(meta.corpus_windows)}-window count is the documented
          output of the Phase 2 pipeline ({meta.corpus_windows_source.split("—")[1]?.trim()}).
          The per-report counts on this site — HAR {int(meta.har_train_windows)} train /{" "}
          {int(meta.har_test_windows)} test, and the per-subject FoG windows — are the
          machine-verifiable slices we recompute from the evaluation artifacts.
        </Callout>
      </Section>

      {/* ---- Schema ---- */}
      <Section id="schema" title="The canonical schema" kicker={`${canonical.name} · v${canonical.schema_version}`}>
        <P>
          Adapters normalise units, placement labels, time and metadata into a
          single record. Resampling to {can.sampling_rate_hz} Hz and acc/gyro
          time-alignment happen later in preprocess — adapters keep native
          timestamps.
        </P>
        <div>
          <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
            Units
          </h3>
          <KeyVal
            items={Object.entries(can.units).map(([k, v]) => ({
              k: titleCase(k),
              v: <span className="text-[13.5px]">{v as string}</span>,
            }))}
          />
        </div>
        <div>
          <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
            Record schema — {canonical.record_schema.columns.length} columns
          </h3>
          <DataTable
            cols={[
              { key: "name", label: "Column", mono: true },
              { key: "dtype", label: "Type", mono: true },
              { key: "unit", label: "Unit", mono: true },
              { key: "null", label: "Null", align: "right", mono: true },
              { key: "desc", label: "Description" },
            ]}
            rows={canonical.record_schema.columns.map((c) => {
              const col = c as {
                name: string;
                dtype: string;
                unit?: string;
                nullable: boolean;
                description?: string;
                enum?: string[];
              };
              return {
                name: col.name,
                dtype: col.dtype,
                unit: col.unit ?? "—",
                null: col.nullable ? "yes" : "no",
                desc: col.description ?? (col.enum ? `enum: ${col.enum.join(", ")}` : "—"),
              };
            })}
            caption="Source: data_manifests/schemas/canonical.json · partitioned by dataset / subject / session / modality"
          />
        </div>
      </Section>

      {/* ---- Datasets ---- */}
      <Section id="datasets" title="The datasets" kicker={`${cards.length} cards`}>
        <P>
          Each card is parsed straight from its dataset manifest. Clinical FoG
          (Daphnet), cross-device HAR (HHAR), cross-position HAR (REALDISP), large
          free-living SSL fuel (CAPTURE-24), and the pose / virtual-IMU sources for
          joint angles and movement quality.
        </P>
        <div className="space-y-5">
          {cards.map((d) => {
            const dm = datasetMeta[d.id] ?? {};
            const rate = dm.native_sampling_rate_hz;
            return (
              <div
                key={d.id}
                className="rounded-card border border-line bg-card p-5 sm:p-6"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-[1.4rem] leading-tight text-ink">
                      {d.name}
                    </h3>
                    <p className="mt-1 text-[13.5px] text-ink-soft">{d.role}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {d.task && <Badge tone="signal">{d.task}</Badge>}
                    {d.verified ? (
                      <Badge>verified</Badge>
                    ) : (
                      <Badge tone="warn">unverified</Badge>
                    )}
                  </div>
                </div>

                <dl className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
                  {d.facts.map((fact, i) => (
                    <div
                      key={i}
                      className="flex gap-3 border-t border-line pt-2 text-[13px]"
                    >
                      <dt className="w-28 shrink-0 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-faint">
                        {fact.k}
                      </dt>
                      <dd className="min-w-0 text-ink">
                        <RichText text={fact.v} />
                      </dd>
                    </div>
                  ))}
                  {typeof rate === "number" && (
                    <div className="flex gap-3 border-t border-line pt-2 text-[13px]">
                      <dt className="w-28 shrink-0 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-faint">
                        Modality out
                      </dt>
                      <dd className="min-w-0 text-ink">
                        {dm.modality_emitted ?? "—"}
                      </dd>
                    </div>
                  )}
                </dl>

                {d.caveats && (
                  <p className="mt-4 border-t border-line pt-3 text-[13px] leading-relaxed text-ink-soft">
                    <span className="font-medium text-ink">Caveat — </span>
                    <RichText text={d.caveats} />
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {/* ---- Vocab ---- */}
      <Section id="vocab" title="Controlled vocabularies" kicker="Shared ontology">
        <div>
          <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
            Body placements — {canonical.placement_vocabulary.length}
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {canonical.placement_vocabulary.map((p) => (
              <span
                key={p}
                className="rounded-pill border border-line bg-paper-soft px-2.5 py-1 font-mono text-[11px] text-ink-soft"
              >
                {p}
              </span>
            ))}
          </div>
        </div>
        <div>
          <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
            Canonical activities — {canonical.activity_canonical.length}
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {canonical.activity_canonical.map((a) => (
              <span
                key={a}
                className="rounded-pill border border-signal/25 bg-signal/[0.06] px-2.5 py-1 font-mono text-[11px] text-signal-deep"
              >
                {a}
              </span>
            ))}
          </div>
        </div>
      </Section>

      {/* ---- Splits ---- */}
      <Section id="splits" title="Splits & leakage control" kicker={splits.policy}>
        <P>
          Splits are subject-disjoint per dataset (seed {splits.seed}, ratios{" "}
          {splits.ratios.join(" / ")}). Clinical tasks additionally run LOSO-CV so a
          single subject is never an evaluation. The test subject never appears in
          train, val, or SSL pretraining.
        </P>
        <DataTable
          cols={[
            { key: "ds", label: "Dataset" },
            { key: "train", label: "Train", align: "right", mono: true },
            { key: "val", label: "Val", align: "right", mono: true },
            { key: "test", label: "Test", align: "right", mono: true },
          ]}
          rows={Object.entries(splits.splits).map(([ds, s]) => {
            const sp = s as { train: string[]; val: string[]; test: string[] };
            return {
              ds: ds,
              train: `${sp.train.length}`,
              val: `${sp.val.length}`,
              test: `${sp.test.length}`,
            };
          })}
          caption="Subject counts per split. Source: data_manifests/splits/subject_splits.json"
        />
      </Section>
    </ReadingLayout>
  );
}
