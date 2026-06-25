"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import FogEventsFeed from "@/components/clinician/FogEventsFeed";
import PrescriptionEditor from "@/components/clinician/PrescriptionEditor";
import { RiskChip } from "@/components/clinician/RiskChip";
import { computeCaseMetrics } from "@/lib/clinic/metrics";
import type { ClinicPatient, Prescription } from "@/lib/clinic/types";
import { toFhirBundle } from "@/lib/fhir";
import { summarize } from "@/lib/insights/engine";
import type { SessionRecord } from "@/lib/insights/types";
import type { Condition, PatientProfile } from "@/lib/profile/types";
import { useTranslation } from "@/locales/client";

const HAR = (s: string | null) => (s ? s.replace(/_/g, " ") : "—");

export default function PatientDetail({ patient }: { patient: ClinicPatient }) {
  const { t } = useTranslation();
  const [rx, setRx] = useState<Prescription>(patient.prescription);

  const conditionLabel: Record<Condition, string> = {
    stroke: t("clinician.condition.stroke"),
    parkinsons: t("clinician.condition.parkinsons"),
    ortho: t("clinician.condition.ortho"),
  };
  const packLabel: Record<"reaching" | "gait", string> = {
    reaching: t("clinician.rx.reaching"),
    gait: t("clinician.rx.gait"),
  };

  const eff: ClinicPatient = useMemo(() => ({ ...patient, prescription: rx }), [patient, rx]);
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

  const trendNote = (pct: number | null, hint: string): string => {
    if (pct === null) return t("clinician.detail.moreSessionsNeeded");
    return `${pct > 0 ? "+" : ""}${pct}% · ${hint}`;
  };

  return (
    <main className="mx-auto max-w-shell px-5 py-8 sm:px-8">
      <Link href="/clinician" className="text-sm text-ink-soft transition-colors hover:text-ink">
        {t("clinician.detail.caseload")}
      </Link>

      <header className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl leading-none text-ink">{patient.demo.name}</h1>
          <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
            {patient.demo.age > 0 ? `${patient.demo.age} ${t("clinician.detail.yrs")} · ` : ""}
            {patient.demo.mrn} · {conditionLabel[patient.profile.condition]} · {t("clinician.detail.affected")} {patient.profile.affectedSide}
          </div>
        </div>
        <span className="rounded-pill border border-line bg-paper-soft px-3 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-soft">
          {packLabel[rx.pack]} · {rx.weeklyDoseSessions}/{t("clinician.card.wk")}
        </span>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* main column */}
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-4">
            <Tile label={t("clinician.detail.sessions")} value={String(s.totalSessions)} />
            <Tile label={t("clinician.detail.adherence")} value={`${m.adherencePct}%`} />
            <Tile label={t("clinician.detail.thisWeek")} value={`${m.weekSessions}/${rx.weeklyDoseSessions}`} />
            <Tile label={t("clinician.detail.streak")} value={`${s.streakDays}d`} />
          </div>

          {/* trends */}
          <div className="grid gap-4 sm:grid-cols-2">
            {reachData.length >= 2 && (
              <Card title={t("clinician.detail.reachTime")} note={trendNote(s.reachTrendPct, t("clinician.detail.lowerIsFaster"))}>
                <Spark data={reachData} invert />
              </Card>
            )}
            {rhythmData.length >= 2 && (
              <Card title={t("clinician.detail.onBeatStepping")} note={trendNote(s.rhythmTrendPct, t("clinician.detail.higherIsSteadier"))}>
                <Spark data={rhythmData} />
              </Card>
            )}
            {reachData.length < 2 && rhythmData.length < 2 && (
              <Card title={t("clinician.detail.performanceTrend")} note={t("clinician.detail.moreSessionsNeeded")}>
                <p className="mt-6 font-mono text-sm text-ink-faint">{t("clinician.detail.twoSessionsUnlock")}</p>
              </Card>
            )}
          </div>

          {/* freeze-risk */}
          {fogData.length > 0 && (
            <Card title={t("clinician.detail.freezeRisk")} note={t("clinician.detail.freezeRiskNote")}>
              <RiskDots data={fogData} />
            </Card>
          )}

          {/* session history */}
          <div className="overflow-hidden rounded-card border border-line bg-card shadow-soft">
            <div className="border-b border-line px-5 py-3 text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">
              {t("clinician.detail.recentSessions")}
            </div>
            {[...patient.sessions].reverse().slice(0, 8).map((x, i) => (
              <Row key={x.id} x={x} border={i > 0} t={t} />
            ))}
          </div>

          {/* FHIR care plan */}
          <CarePlanCard profile={fhirProfile} planTitle={carePlan.title} bundle={bundle} conditionLabel={conditionLabel} packLabel={packLabel} t={t} />
        </div>

        {/* aside */}
        <aside className="space-y-6">
          <section className="rounded-card border border-line bg-card shadow-soft">
            <header className="border-b border-line px-4 py-3 text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">
              {t("clinician.detail.alerts")}
            </header>
            <div className="space-y-3 p-4">
              {m.flags.map((f) => (
                <div key={f.id}>
                  <RiskChip severity={f.severity} label={t(`clinician.flags.${f.id}`)} />
                  <p className="mt-1.5 text-[12px] leading-relaxed text-ink-soft">{f.detail}</p>
                </div>
              ))}
            </div>
          </section>

          <PrescriptionEditor patientId={patient.profile.id} initial={rx} onChange={setRx} />

          <FogEventsFeed limit={8} patientId={patient.profile.id} />

          <Link
            href={`/clinician/patient/${patient.profile.id}/report`}
            className="flex items-center justify-center gap-2 rounded-card border border-line bg-paper-soft px-4 py-3 text-sm font-medium text-ink transition-colors hover:bg-paper"
          >
            {t("clinician.detail.generateReport")}
          </Link>
        </aside>
      </div>
    </main>
  );
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

function Row({ x, border, t }: { x: SessionRecord; border: boolean; t: (k: string) => string }) {
  return (
    <div className={`grid grid-cols-2 items-center gap-2 px-5 py-3 text-sm sm:grid-cols-5 ${border ? "border-t border-line" : ""}`}>
      <span className="text-ink">{new Date(x.startedAt).toLocaleDateString()}</span>
      <span className="font-mono tabular-nums text-ink-soft">
        {x.exercise === "gait" ? `${x.gait?.steps ?? 0} ${t("clinician.detail.steps")}` : `${x.reaches} ${t("clinician.detail.reaches")}`}
      </span>
      <span className="font-mono tabular-nums text-ink-soft">
        {x.exercise === "gait"
          ? x.gait?.cadenceSpm
            ? `${x.gait.cadenceSpm} ${t("clinician.detail.spm")}`
            : "—"
          : x.reachMs.mean
            ? `${x.reachMs.mean} ${t("clinician.detail.ms")}`
            : "—"}
      </span>
      <span className="font-mono tabular-nums text-ink-soft">
        {x.fogRiskMean != null ? `${Math.round(x.fogRiskMean * 100)}% ${t("clinician.detail.fog")}` : "—"}
      </span>
      <span className="truncate text-ink-faint">{HAR(x.harTop)}</span>
    </div>
  );
}

function CarePlanCard({
  profile,
  planTitle,
  bundle,
  conditionLabel,
  packLabel,
  t,
}: {
  profile: PatientProfile;
  planTitle: string;
  bundle: ReturnType<typeof toFhirBundle>;
  conditionLabel: Record<Condition, string>;
  packLabel: Record<"reaching" | "gait", string>;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const [open, setOpen] = useState(false);
  const obs = bundle.entry.filter((e) => e.resource.resourceType === "Observation");
  return (
    <div className="rounded-card border border-line bg-card p-5 shadow-soft">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">{t("clinician.detail.carePlan")}</span>
        <button onClick={() => setOpen((v) => !v)} className="font-mono text-[11px] text-ink-faint hover:text-ink">
          {open ? t("clinician.detail.hideBundle") : t("clinician.detail.viewBundle")}
        </button>
      </div>
      <div className="mt-3 text-xl text-ink">{planTitle}</div>
      <p className="mt-1 text-[13px] text-ink-soft">
        {t("clinician.detail.addresses", {
          condition: conditionLabel[profile.condition],
          pack: packLabel[profile.recommendedPack],
          n: obs.length,
        })}
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
