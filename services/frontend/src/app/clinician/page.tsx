"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import FogEventsFeed from "@/components/clinician/FogEventsFeed";
import { RiskChip } from "@/components/clinician/RiskChip";
import { caseloadSummary, computeCaseMetrics } from "@/lib/clinic/metrics";
import { getRoster } from "@/lib/clinic/mockData";
import { loadPrescription } from "@/lib/clinic/store";
import type { CaseMetrics, ClinicPatient, RiskSeverity } from "@/lib/clinic/types";
import type { Condition } from "@/lib/profile/types";

const CONDITION_LABEL: Record<Condition, string> = {
  stroke: "Stroke",
  parkinsons: "Parkinson's",
  ortho: "Ortho recovery",
};

const SEV_RANK: Record<RiskSeverity, number> = { high: 0, watch: 1, info: 2 };

function topSeverity(m: CaseMetrics): RiskSeverity {
  return m.flags.reduce<RiskSeverity>((acc, f) => (SEV_RANK[f.severity] < SEV_RANK[acc] ? f.severity : acc), "info");
}

function ago(ts: number): string {
  const d = Date.now() - ts;
  const h = Math.round(d / 3600e3);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function ClinicOverview() {
  const [patients, setPatients] = useState<ClinicPatient[]>(getRoster());

  // merge any persisted prescription overrides once mounted (avoids SSR/CSR mismatch)
  useEffect(() => {
    setPatients(getRoster().map((p) => ({ ...p, prescription: loadPrescription(p.profile.id) ?? p.prescription })));
  }, []);

  const summary = caseloadSummary(patients);
  const rows = useMemo(
    () =>
      patients
        .map((p) => ({ p, m: computeCaseMetrics(p) }))
        .sort((a, b) => SEV_RANK[topSeverity(a.m)] - SEV_RANK[topSeverity(b.m)] || a.m.adherencePct - b.m.adherencePct),
    [patients],
  );

  return (
    <main className="mx-auto max-w-shell px-5 py-10 sm:px-8">
      <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-ink-faint">Clinician · caseload</div>
      <h1 className="mt-2 font-serif text-5xl italic leading-[1.05] text-ink">Your patients, at a glance.</h1>

      {/* caseload rollup */}
      <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line md:grid-cols-4">
        <Stat label="Active patients" value={String(summary.total)} />
        <Stat label="Active today" value={String(summary.activeToday)} />
        <Stat label="High alerts" value={String(summary.highAlerts)} accent={summary.highAlerts > 0} />
        <Stat label="Avg adherence" value={`${summary.avgAdherence}%`} />
      </div>

      {/* roster */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {rows.map(({ p, m }) => (
          <PatientCard key={p.profile.id} p={p} m={m} />
        ))}
      </div>

      {/* live freezing-of-gait telemetry streamed from real sessions (RLS-scoped) */}
      <div className="mt-10">
        <FogEventsFeed limit={12} />
      </div>
    </main>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-card p-6">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-ink-faint">{label}</div>
      <div className={`mt-2 font-mono text-3xl tabular-nums ${accent ? "text-signal-deep" : "text-ink"}`}>{value}</div>
    </div>
  );
}

function PatientCard({ p, m }: { p: ClinicPatient; m: CaseMetrics }) {
  return (
    <Link
      href={`/clinician/patient/${p.profile.id}`}
      className="group block rounded-card border border-line bg-card p-6 shadow-soft transition-all duration-300 ease-editorial hover:-translate-y-0.5 hover:shadow-card"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-serif text-2xl italic text-ink">{p.demo.name}</h2>
          <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-faint">
            {p.demo.age} · {p.demo.mrn} · {ago(m.lastActiveAt)}
          </div>
        </div>
        <span className="rounded-pill border border-line bg-paper-soft px-3 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-soft">
          {CONDITION_LABEL[p.profile.condition]}
        </span>
      </div>

      <div className="mt-5 flex items-center gap-4">
        <div className="flex-1">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-faint">Adherence</span>
            <span className="font-mono text-xs tabular-nums text-ink">
              {m.adherencePct}% · {m.weekSessions}/{p.prescription.weeklyDoseSessions} wk
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-pill bg-paper-soft">
            <div
              className={`h-full rounded-pill ${m.adherencePct >= 60 ? "bg-signal" : "bg-ink/40"}`}
              style={{ width: `${m.adherencePct}%` }}
            />
          </div>
        </div>
        <div className="text-right">
          <div className="font-serif text-2xl italic text-ink">{m.streakDays}d</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">streak</div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {m.flags.map((f) => (
          <RiskChip key={f.id} severity={f.severity} label={f.label} />
        ))}
      </div>
    </Link>
  );
}
