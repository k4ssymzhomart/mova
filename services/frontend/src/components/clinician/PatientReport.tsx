"use client";

// Outcome report — a print-friendly view summarising the FHIR CarePlan + adherence. "Generate PDF" is a
// real browser print (Save as PDF) rather than a fake download: the action bar is print:hidden so only
// the report sheet prints. When a server-side PDF service lands, this same layout becomes its template.

import Link from "next/link";
import { useEffect, useState } from "react";

import { RiskChip } from "@/components/clinician/RiskChip";
import { computeCaseMetrics } from "@/lib/clinic/metrics";
import { getPatient } from "@/lib/clinic/mockData";
import { loadPrescription } from "@/lib/clinic/store";
import type { ClinicPatient, Prescription } from "@/lib/clinic/types";
import { toFhirBundle } from "@/lib/fhir";
import { summarize } from "@/lib/insights/engine";
import type { Condition, PatientProfile } from "@/lib/profile/types";

const CONDITION_LABEL: Record<Condition, string> = {
  stroke: "Stroke",
  parkinsons: "Parkinson's disease",
  ortho: "Orthopaedic recovery",
};
const PACK_LABEL = { reaching: "Upper-limb reaching", gait: "Gait & balance" } as const;

export default function PatientReport({ id }: { id: string }) {
  const patient = getPatient(id);
  const [rx, setRx] = useState<Prescription | null>(patient ? patient.prescription : null);
  useEffect(() => {
    if (patient) setRx(loadPrescription(patient.profile.id) ?? patient.prescription);
  }, [patient]);

  if (!patient || !rx) {
    return (
      <main className="mx-auto max-w-2xl px-5 py-16">
        <p className="text-ink-soft">Patient not found.</p>
        <Link href="/clinician" className="mt-4 inline-block text-sm text-signal-deep hover:underline">
          ← Back to caseload
        </Link>
      </main>
    );
  }

  const eff: ClinicPatient = { ...patient, prescription: rx };
  const m = computeCaseMetrics(eff);
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
          ← Back to patient
        </Link>
        <button
          onClick={() => window.print()}
          className="rounded-pill bg-night px-5 py-2.5 text-sm font-medium text-paper-soft transition-colors hover:bg-ink"
        >
          Print / Save as PDF
        </button>
      </div>

      {/* report sheet */}
      <article className="rounded-card border border-line bg-card p-8 shadow-soft print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <header className="flex items-start justify-between border-b border-line pb-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-signal" />
              <span className="font-serif text-2xl italic text-ink">Mova</span>
            </div>
            <h1 className="mt-2 font-serif text-3xl italic text-ink">Rehabilitation outcome report</h1>
          </div>
          <div className="text-right font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
            <div>{generated.toLocaleDateString()}</div>
            <div className="mt-1">{patient.demo.mrn}</div>
          </div>
        </header>

        <Section title="Patient">
          <Grid>
            <Field k="Name" v={patient.demo.name} />
            <Field k="Age" v={`${patient.demo.age}`} />
            <Field k="Condition" v={CONDITION_LABEL[patient.profile.condition]} />
            <Field k="Affected side" v={patient.profile.affectedSide} />
          </Grid>
        </Section>

        <Section title="Prescription (CarePlan)">
          <Grid>
            <Field k="Exercise pack" v={PACK_LABEL[rx.pack]} />
            <Field k="Weekly dose" v={`${rx.weeklyDoseSessions} sessions`} />
            <Field k="Target cadence" v={rx.pack === "gait" ? `${rx.targetCadenceSpm} spm` : "n/a"} />
            <Field k="Difficulty" v={`${Math.round(rx.difficulty * 100)}%`} />
          </Grid>
          {rx.note && <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">Note: {rx.note}</p>}
        </Section>

        <Section title="Adherence & outcomes">
          <Grid>
            <Field k="Adherence (this week)" v={`${m.adherencePct}% · ${m.weekSessions}/${rx.weeklyDoseSessions}`} />
            <Field k="Total sessions" v={`${s.totalSessions}`} />
            <Field k="Current streak" v={`${s.streakDays} days`} />
            <Field k="Reach-time trend" v={s.reachTrendPct == null ? "—" : `${s.reachTrendPct > 0 ? "+" : ""}${s.reachTrendPct}%`} />
            <Field k="On-beat trend" v={s.rhythmTrendPct == null ? "—" : `${s.rhythmTrendPct > 0 ? "+" : ""}${s.rhythmTrendPct}%`} />
            <Field k="Best cadence" v={s.bestCadenceSpm ? `${s.bestCadenceSpm} spm` : "—"} />
          </Grid>
        </Section>

        <Section title="Baseline ROM (CV-guided)">
          {obs.length ? (
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-[0.12em] text-ink-faint">
                  <th className="py-2 font-medium">Measure</th>
                  <th className="py-2 font-medium">Side</th>
                  <th className="py-2 font-medium">Value</th>
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
            <p className="text-[13px] text-ink-soft">No baseline captured. Difficulty runs at a neutral default.</p>
          )}
        </Section>

        <Section title="Clinical alerts">
          <div className="flex flex-wrap gap-2">
            {m.flags.map((f) => (
              <RiskChip key={f.id} severity={f.severity} label={f.label} />
            ))}
          </div>
        </Section>

        <footer className="mt-8 border-t border-line pt-4 text-[11px] leading-relaxed text-ink-faint">
          Decision support, not diagnosis. Freeze-risk figures derive from an on-device research model and are not a
          clinical determination. Generated by Mova from mock / non-PHI demo data on {generated.toLocaleString()}.
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
      <dd className="mt-1 font-serif text-lg italic text-ink">{v}</dd>
    </div>
  );
}
