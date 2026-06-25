"use client";

// Outcome report — a print-friendly view summarising the FHIR CarePlan + adherence. "Generate PDF" is a
// real browser print (Save as PDF) rather than a fake download: the action bar is print:hidden so only
// the report sheet prints. Reads real patient data passed from the server page.

import Link from "next/link";

import { RiskChip } from "@/components/clinician/RiskChip";
import { computeCaseMetrics } from "@/lib/clinic/metrics";
import type { ClinicPatient } from "@/lib/clinic/types";
import { toFhirBundle } from "@/lib/fhir";
import { summarize } from "@/lib/insights/engine";
import type { Condition, PatientProfile } from "@/lib/profile/types";
import { useTranslation } from "@/locales/client";

export default function PatientReport({ patient }: { patient: ClinicPatient }) {
  const { t } = useTranslation();
  const rx = patient.prescription;

  const conditionLabel: Record<Condition, string> = {
    stroke: t("clinician.condition.stroke"),
    parkinsons: t("clinician.condition.parkinsons"),
    ortho: t("clinician.condition.ortho"),
  };
  const packLabel: Record<"reaching" | "gait", string> = {
    reaching: t("clinician.rx.reaching"),
    gait: t("clinician.rx.gait"),
  };

  const m = computeCaseMetrics({ ...patient, prescription: rx });
  const s = summarize(patient.sessions);
  const fhirProfile: PatientProfile = { ...patient.profile, recommendedPack: rx.pack };
  const bundle = toFhirBundle(fhirProfile);
  const obs = bundle.entry.filter((e) => e.resource.resourceType === "Observation");
  const generated = new Date();

  return (
    <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8 print:max-w-none print:px-0 print:py-0">
      {/* action bar — never printed */}
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link href={`/clinician/patient/${patient.profile.id}`} className="text-sm text-ink-soft transition-colors hover:text-ink">
          {t("clinician.report.backToPatient")}
        </Link>
        <button
          onClick={() => window.print()}
          className="rounded-pill bg-night px-5 py-2.5 text-sm font-medium text-paper-soft transition-colors hover:bg-ink"
        >
          {t("clinician.report.print")}
        </button>
      </div>

      {/* report sheet */}
      <article className="rounded-card border border-line bg-card p-8 shadow-soft print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <header className="flex items-start justify-between border-b border-line pb-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-signal" />
              <span className="text-2xl text-ink">Mova</span>
            </div>
            <h1 className="mt-2 text-3xl text-ink">{t("clinician.report.title")}</h1>
          </div>
          <div className="text-right font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
            <div>{generated.toLocaleDateString()}</div>
            <div className="mt-1">{patient.demo.mrn}</div>
          </div>
        </header>

        <Section title={t("clinician.report.patient")}>
          <Grid>
            <Field k={t("clinician.report.name")} v={patient.demo.name} />
            <Field k={t("clinician.report.age")} v={patient.demo.age > 0 ? `${patient.demo.age}` : "—"} />
            <Field k={t("clinician.report.condition")} v={conditionLabel[patient.profile.condition]} />
            <Field k={t("clinician.report.affectedSide")} v={patient.profile.affectedSide} />
          </Grid>
        </Section>

        <Section title={t("clinician.report.prescription")}>
          <Grid>
            <Field k={t("clinician.report.pack")} v={packLabel[rx.pack]} />
            <Field k={t("clinician.report.weeklyDose")} v={t("clinician.report.sessionsUnit", { n: rx.weeklyDoseSessions })} />
            <Field k={t("clinician.report.targetCadence")} v={rx.pack === "gait" ? t("clinician.rx.spm", { n: rx.targetCadenceSpm }) : t("clinician.report.na")} />
            <Field k={t("clinician.report.difficulty")} v={`${Math.round(rx.difficulty * 100)}%`} />
          </Grid>
          {rx.note && <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">{t("clinician.report.note")}: {rx.note}</p>}
        </Section>

        <Section title={t("clinician.report.adherenceOutcomes")}>
          <Grid>
            <Field k={t("clinician.report.adherenceWeek")} v={`${m.adherencePct}% · ${m.weekSessions}/${rx.weeklyDoseSessions}`} />
            <Field k={t("clinician.report.totalSessions")} v={`${s.totalSessions}`} />
            <Field k={t("clinician.report.currentStreak")} v={t("clinician.report.days", { n: s.streakDays })} />
            <Field k={t("clinician.report.reachTrend")} v={s.reachTrendPct == null ? "—" : `${s.reachTrendPct > 0 ? "+" : ""}${s.reachTrendPct}%`} />
            <Field k={t("clinician.report.onBeatTrend")} v={s.rhythmTrendPct == null ? "—" : `${s.rhythmTrendPct > 0 ? "+" : ""}${s.rhythmTrendPct}%`} />
            <Field k={t("clinician.report.bestCadence")} v={s.bestCadenceSpm ? t("clinician.rx.spm", { n: s.bestCadenceSpm }) : "—"} />
          </Grid>
        </Section>

        <Section title={t("clinician.report.baselineRom")}>
          {obs.length ? (
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-[0.12em] text-ink-faint">
                  <th className="py-2 font-medium">{t("clinician.report.measure")}</th>
                  <th className="py-2 font-medium">{t("clinician.report.side")}</th>
                  <th className="py-2 font-medium">{t("clinician.report.value")}</th>
                </tr>
              </thead>
              <tbody>
                {obs.map((e) => {
                  const o = e.resource as Extract<(typeof bundle.entry)[number]["resource"], { resourceType: "Observation" }>;
                  return (
                    <tr key={o.id} className="border-b border-line/60">
                      <td className="py-2 text-ink">{o.code.coding[0].display}</td>
                      <td className="py-2 text-ink-soft">{o.bodySite?.coding[0].display ?? "—"}</td>
                      <td className="py-2 font-mono tabular-nums text-ink">{o.valueQuantity.value}°</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="text-[13px] text-ink-soft">{t("clinician.report.noBaseline")}</p>
          )}
        </Section>

        <Section title={t("clinician.report.alerts")}>
          <div className="flex flex-wrap gap-2">
            {m.flags.map((f) => (
              <RiskChip key={f.id} severity={f.severity} label={t(`clinician.flags.${f.id}`)} />
            ))}
          </div>
        </Section>

        <footer className="mt-8 border-t border-line pt-4 text-[11px] leading-relaxed text-ink-faint">
          {t("clinician.report.disclaimer", { date: generated.toLocaleString() })}
        </footer>
      </article>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">{children}</dl>;
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-faint">{k}</dt>
      <dd className="mt-1 text-lg text-ink">{v}</dd>
    </div>
  );
}
