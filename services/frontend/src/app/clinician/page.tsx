import Link from "next/link";

import FogEventsFeed from "@/components/clinician/FogEventsFeed";
import { RiskChip } from "@/components/clinician/RiskChip";
import { caseloadSummary, computeCaseMetrics } from "@/lib/clinic/metrics";
import { fetchRoster } from "@/lib/clinic/realData";
import type { CaseMetrics, ClinicPatient, RiskSeverity } from "@/lib/clinic/types";
import type { Condition } from "@/lib/profile/types";
import { getTranslation } from "@/locales/server";

// Real caseload comes from a per-request, clinic-scoped RPC — always render dynamically.
export const dynamic = "force-dynamic";

const SEV_RANK: Record<RiskSeverity, number> = { high: 0, watch: 1, info: 2 };

function topSeverity(m: CaseMetrics): RiskSeverity {
  return m.flags.reduce<RiskSeverity>((acc, f) => (SEV_RANK[f.severity] < SEV_RANK[acc] ? f.severity : acc), "info");
}

export default async function ClinicOverview() {
  const { t } = getTranslation();
  const patients = await fetchRoster();

  const conditionLabel: Record<Condition, string> = {
    stroke: t("clinician.condition.stroke"),
    parkinsons: t("clinician.condition.parkinsons"),
    ortho: t("clinician.condition.ortho"),
  };

  const ago = (ts: number): string => {
    const d = Date.now() - ts;
    const h = Math.round(d / 3600e3);
    if (h < 1) return t("clinician.ago.justNow");
    if (h < 24) return t("clinician.ago.hours", { n: h });
    return t("clinician.ago.days", { n: Math.round(h / 24) });
  };

  const summary = caseloadSummary(patients);
  const rows = patients
    .map((p) => ({ p, m: computeCaseMetrics(p) }))
    .sort((a, b) => SEV_RANK[topSeverity(a.m)] - SEV_RANK[topSeverity(b.m)] || a.m.adherencePct - b.m.adherencePct);

  return (
    <main className="mx-auto max-w-shell px-5 py-10 sm:px-8">
      <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-ink-faint">{t("clinician.eyebrow")}</div>
      <h1 className="mt-2 text-5xl leading-[1.05] text-ink">{t("clinician.title")}</h1>

      {/* caseload rollup */}
      <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line md:grid-cols-4">
        <Stat label={t("clinician.stats.activePatients")} value={String(summary.total)} />
        <Stat label={t("clinician.stats.activeToday")} value={String(summary.activeToday)} />
        <Stat label={t("clinician.stats.highAlerts")} value={String(summary.highAlerts)} accent={summary.highAlerts > 0} />
        <Stat label={t("clinician.stats.avgAdherence")} value={`${summary.avgAdherence}%`} />
      </div>

      {rows.length === 0 ? (
        <div className="mt-6 rounded-card border border-line bg-card p-10 text-center shadow-soft">
          <h2 className="text-xl text-ink">{t("clinician.empty.title")}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-soft">{t("clinician.empty.body")}</p>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {rows.map(({ p, m }) => (
            <PatientCard key={p.profile.id} p={p} m={m} conditionLabel={conditionLabel} agoLabel={ago} t={t} />
          ))}
        </div>
      )}

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

function PatientCard({
  p,
  m,
  conditionLabel,
  agoLabel,
  t,
}: {
  p: ClinicPatient;
  m: CaseMetrics;
  conditionLabel: Record<Condition, string>;
  agoLabel: (ts: number) => string;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  return (
    <Link
      href={`/clinician/patient/${p.profile.id}`}
      className="group block rounded-card border border-line bg-card p-6 shadow-soft transition-all duration-300 ease-editorial hover:-translate-y-0.5 hover:shadow-card"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl text-ink">{p.demo.name}</h2>
          <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-faint">
            {p.demo.age > 0 ? `${p.demo.age} · ` : ""}
            {p.demo.mrn} · {agoLabel(m.lastActiveAt)}
          </div>
        </div>
        <span className="rounded-pill border border-line bg-paper-soft px-3 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-soft">
          {conditionLabel[p.profile.condition]}
        </span>
      </div>

      <div className="mt-5 flex items-center gap-4">
        <div className="flex-1">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-faint">{t("clinician.card.adherence")}</span>
            <span className="font-mono text-xs tabular-nums text-ink">
              {m.adherencePct}% · {m.weekSessions}/{p.prescription.weeklyDoseSessions} {t("clinician.card.wk")}
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
          <div className="text-2xl text-ink">{m.streakDays}d</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">{t("clinician.card.streak")}</div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {m.flags.map((f) => (
          <RiskChip key={f.id} severity={f.severity} label={t(`clinician.flags.${f.id}`)} />
        ))}
      </div>
    </Link>
  );
}
