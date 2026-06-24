"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import PrescriptionEditor from "@/components/clinician/PrescriptionEditor";
import { RiskChip } from "@/components/clinician/RiskChip";
import { computeCaseMetrics } from "@/lib/clinic/metrics";
import { getPatient } from "@/lib/clinic/mockData";
import { loadPrescription } from "@/lib/clinic/store";
import type { ClinicPatient, Prescription } from "@/lib/clinic/types";
import { toFhirBundle } from "@/lib/fhir";
import { summarize } from "@/lib/insights/engine";
import type { SessionRecord } from "@/lib/insights/types";
import type { Condition, PatientProfile } from "@/lib/profile/types";

const CONDITION_LABEL: Record<Condition, string> = {
  stroke: "Stroke",
  parkinsons: "Parkinson's",
  ortho: "Ortho recovery",
};
const PACK_LABEL = { reaching: "Upper-limb reaching", gait: "Gait & balance" } as const;
const HAR = (s: string | null) => (s ? s.replace(/_/g, " ") : "—");

export default function PatientDetail({ id }: { id: string }) {
  const patient = getPatient(id);
  const [rx, setRx] = useState<Prescription | null>(patient ? patient.prescription : null);

  useEffect(() => {
    if (patient) setRx(loadPrescription(patient.profile.id) ?? patient.prescription);
  }, [patient]);

  const eff: ClinicPatient | null = useMemo(
    () => (patient && rx ? { ...patient, prescription: rx } : null),
    [patient, rx],
  );

  if (!patient || !eff || !rx) {
    return (
      <main className="mx-auto max-w-shell px-5 py-16 sm:px-8">
        <p className="text-ink-soft">Patient not found.</p>
        <Link href="/clinician" className="mt-4 inline-block text-sm text-signal-deep hover:underline">
          ← Back to caseload
        </Link>
      </main>
    );
  }

  const m = computeCaseMetrics(eff);
  const s = summarize(patient.sessions);
  const reachData = patient.sessions.filter((x) => x.exercise === "reaching").map((x) => x.reachMs.mean).filter((v) => v > 0);
  const rhythmData = patient.sessions.filter((x) => x.exercise === "gait" && x.gait).map((x) => Math.round(x.gait!.rhythmPct * 100));
  const fogData = patient.sessions.filter((x) => x.fogRiskMean != null).map((x) => ({ risk: x.fogRiskMean!, valid: x.fogValid }));

  // FHIR bundle reflecting the *current* prescription (pack may differ from the recommendation)
  const fhirProfile: PatientProfile = { ...patient.profile, recommendedPack: rx.pack };
  const bundle = toFhirBundle(fhirProfile);
  const carePlan = bundle.entry.find((e) => e.resource.resourceType === "CarePlan")!.resource as Extract<
    (typeof bundle.entry)[number]["resource"],
    { resourceType: "CarePlan" }
  >;

  return (
    <main className="mx-auto max-w-shell px-5 py-8 sm:px-8">
      <Link href="/clinician" className="text-sm text-ink-soft transition-colors hover:text-ink">
        ← Caseload
      </Link>

      <header className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-4xl italic leading-none text-ink">{patient.demo.name}</h1>
          <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
            {patient.demo.age} yrs · {patient.demo.mrn} · {CONDITION_LABEL[patient.profile.condition]} · affected {patient.profile.affectedSide}
          </div>
        </div>
        <span className="rounded-pill border border-line bg-paper-soft px-3 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-soft">
          {PACK_LABEL[rx.pack]} · {rx.weeklyDoseSessions}/wk
        </span>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* main column */}
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-4">
            <Tile label="Sessions" value={String(s.totalSessions)} />
            <Tile label="Adherence" value={`${m.adherencePct}%`} />
            <Tile label="This week" value={`${m.weekSessions}/${rx.weeklyDoseSessions}`} />
            <Tile label="Streak" value={`${s.streakDays}d`} />
          </div>

          {/* trends */}
          <div className="grid gap-4 sm:grid-cols-2">
            {reachData.length >= 2 && (
              <Card title="Reach time" note={trendNote(s.reachTrendPct, "lower is faster")}>
                <Spark data={reachData} invert />
              </Card>
            )}
            {rhythmData.length >= 2 && (
              <Card title="On-beat stepping" note={trendNote(s.rhythmTrendPct, "higher is steadier")}>
                <Spark data={rhythmData} />
              </Card>
            )}
            {reachData.length < 2 && rhythmData.length < 2 && (
              <Card title="Performance trend" note="more sessions needed">
                <p className="mt-6 font-mono text-sm text-ink-faint">Two+ sessions unlock the trend line.</p>
              </Card>
            )}
          </div>

          {/* freeze-risk */}
          {fogData.length > 0 && (
            <Card title="Freeze-risk · across sessions" note="lower is calmer · ● lower-limb valid · ○ preview">
              <RiskDots data={fogData} />
            </Card>
          )}

          {/* session history */}
          <div className="overflow-hidden rounded-card border border-line bg-card shadow-soft">
            <div className="border-b border-line px-5 py-3 text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">
              Recent sessions
            </div>
            {[...patient.sessions].reverse().slice(0, 8).map((x, i) => (
              <Row key={x.id} x={x} border={i > 0} />
            ))}
          </div>

          {/* FHIR care plan */}
          <CarePlanCard profile={fhirProfile} planTitle={carePlan.title} bundle={bundle} />
        </div>

        {/* aside */}
        <aside className="space-y-6">
          <section className="rounded-card border border-line bg-card shadow-soft">
            <header className="border-b border-line px-4 py-3 text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">
              Alerts
            </header>
            <div className="space-y-3 p-4">
              {m.flags.map((f) => (
                <div key={f.id}>
                  <RiskChip severity={f.severity} label={f.label} />
                  <p className="mt-1.5 text-[12px] leading-relaxed text-ink-soft">{f.detail}</p>
                </div>
              ))}
            </div>
          </section>

          <PrescriptionEditor patientId={patient.profile.id} initial={rx} onChange={setRx} />

          <Link
            href={`/clinician/patient/${patient.profile.id}/report`}
            className="flex items-center justify-center gap-2 rounded-card border border-line bg-paper-soft px-4 py-3 text-sm font-medium text-ink transition-colors hover:bg-paper"
          >
            Generate PDF report →
          </Link>
        </aside>
      </div>
    </main>
  );
}

function trendNote(pct: number | null, hint: string): string {
  if (pct === null) return "more sessions needed";
  return `${pct > 0 ? "+" : ""}${pct}% · ${hint}`;
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card p-5">
      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-ink-faint">{label}</div>
      <div className="mt-1.5 font-mono text-2xl tabular-nums text-ink">{value}</div>
    </div>
  );
}

function Card({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-card p-5 shadow-soft">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">{title}</span>
        <span className="font-mono text-[11px] text-ink-faint">{note}</span>
      </div>
      {children}
    </div>
  );
}

function Row({ x, border }: { x: SessionRecord; border: boolean }) {
  return (
    <div className={`grid grid-cols-2 items-center gap-2 px-5 py-3 text-sm sm:grid-cols-5 ${border ? "border-t border-line" : ""}`}>
      <span className="text-ink">{new Date(x.startedAt).toLocaleDateString()}</span>
      <span className="font-mono tabular-nums text-ink-soft">
        {x.exercise === "gait" ? `${x.gait?.steps ?? 0} steps` : `${x.reaches} reaches`}
      </span>
      <span className="font-mono tabular-nums text-ink-soft">
        {x.exercise === "gait" ? (x.gait?.cadenceSpm ? `${x.gait.cadenceSpm} spm` : "—") : x.reachMs.mean ? `${x.reachMs.mean} ms` : "—"}
      </span>
      <span className="font-mono tabular-nums text-ink-soft">
        {x.fogRiskMean != null ? `${Math.round(x.fogRiskMean * 100)}% FoG` : "—"}
      </span>
      <span className="truncate text-ink-faint">{HAR(x.harTop)}</span>
    </div>
  );
}

function CarePlanCard({
  profile,
  planTitle,
  bundle,
}: {
  profile: PatientProfile;
  planTitle: string;
  bundle: ReturnType<typeof toFhirBundle>;
}) {
  const [open, setOpen] = useState(false);
  const obs = bundle.entry.filter((e) => e.resource.resourceType === "Observation");
  return (
    <div className="rounded-card border border-line bg-card p-5 shadow-soft">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">Care plan · FHIR</span>
        <button onClick={() => setOpen((v) => !v)} className="font-mono text-[11px] text-ink-faint hover:text-ink">
          {open ? "hide bundle" : "view bundle"}
        </button>
      </div>
      <div className="mt-3 font-serif text-xl italic text-ink">{planTitle}</div>
      <p className="mt-1 text-[13px] text-ink-soft">
        Addresses {CONDITION_LABEL[profile.condition]} · prescribes {PACK_LABEL[profile.recommendedPack]} ·{" "}
        {obs.length} baseline ROM observation{obs.length === 1 ? "" : "s"}.
      </p>
      {open && (
        <pre className="mt-3 max-h-72 overflow-auto rounded-card border border-line bg-night px-4 py-3 font-mono text-[11px] leading-relaxed text-paper-soft">
          {JSON.stringify(bundle, null, 2)}
        </pre>
      )}
    </div>
  );
}

// --- charts ------------------------------------------------------------------------------------------

function Spark({ data, invert = false }: { data: number[]; invert?: boolean }) {
  const w = 360;
  const h = 96;
  const pad = 8;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - 2 * pad);
    const up = invert ? 1 - (v - min) / span : (v - min) / span;
    return [x, pad + (1 - up) * (h - 2 * pad)] as const;
  });
  const line = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${pad},${h - pad} ${line} ${(w - pad).toFixed(1)},${(h - pad).toFixed(1)}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-3 h-24 w-full" preserveAspectRatio="none">
      <polygon points={area} fill="#16a35b" opacity="0.08" />
      <polyline points={line} fill="none" stroke="#16a35b" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function RiskDots({ data }: { data: { risk: number; valid: boolean }[] }) {
  const w = 720;
  const h = 96;
  const pad = 10;
  const x = (i: number) => pad + (i / Math.max(1, data.length - 1)) * (w - 2 * pad);
  const y = (r: number) => pad + (1 - Math.max(0, Math.min(1, r))) * (h - 2 * pad);
  const line = data.map((d, i) => `${x(i).toFixed(1)},${y(d.risk).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-3 h-24 w-full" preserveAspectRatio="none">
      <line x1={pad} y1={y(0.5)} x2={w - pad} y2={y(0.5)} stroke="rgba(18,19,17,0.18)" strokeWidth="1" strokeDasharray="4 5" />
      <polyline points={line} fill="none" stroke="#16a35b" strokeWidth="2" strokeLinecap="round" opacity="0.55" />
      {data.map((d, i) =>
        d.valid ? (
          <circle key={i} cx={x(i)} cy={y(d.risk)} r="3.5" fill="#16a35b" />
        ) : (
          <circle key={i} cx={x(i)} cy={y(d.risk)} r="3.5" fill="#ffffff" stroke="#8A8B82" strokeWidth="1.5" />
        ),
      )}
    </svg>
  );
}
