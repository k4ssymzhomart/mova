"use client";

// FogEventsFeed — clinician-facing read of REAL freezing-of-gait telemetry.
//
// Reads fog_events straight from Supabase via the cookie-based browser client; RLS (can_access_patient)
// scopes the result to the patients the signed-in viewer may see, so a clinician sees their roster's
// episodes and a self-serve user sees their own. These rows are produced live by the /app/session
// capture bridge (record_fog_events). Pass `patientId` to scope to one patient; omit it for a caseload
// feed of the most recent episodes.

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/lib/auth/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/locales/client";

interface FogEventRow {
  id: string;
  session_id: string;
  kind: string;
  started_at: string;
  ended_at: string | null;
  confidence: number | null;
  freeze_index: number | null;
  source: string | null;
}

export default function FogEventsFeed({
  limit = 12,
  patientId,
}: {
  limit?: number;
  patientId?: string;
}) {
  const { session, loading: authLoading, configured } = useAuth();
  const { t } = useTranslation();
  const [rows, setRows] = useState<FogEventRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!configured || !session) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    const supabase = createClient();
    let q = supabase
      .from("fog_events")
      .select("id, session_id, kind, started_at, ended_at, confidence, freeze_index, source")
      .order("started_at", { ascending: false })
      .limit(limit);
    if (patientId) q = q.eq("patient_id", patientId);
    const { data, error: qErr } = await q;
    if (qErr) setError(qErr.message);
    else setRows((data as FogEventRow[]) ?? []);
    setLoading(false);
  }, [configured, session, limit, patientId]);

  useEffect(() => {
    if (authLoading) return;
    void load();
  }, [authLoading, load]);

  // Light polling so freshly streamed episodes appear without a manual refresh.
  useEffect(() => {
    if (authLoading || !configured || !session) return;
    const id = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(id);
  }, [authLoading, configured, session, load]);

  return (
    <section className="overflow-hidden rounded-card border border-line bg-card shadow-soft">
      <header className="flex items-center justify-between border-b border-line px-5 py-3">
        <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">
          {t("clinician.fog.title")}
        </span>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || !session}
          className="inline-flex items-center gap-1.5 font-mono text-[11px] text-ink-faint transition-colors hover:text-ink disabled:opacity-40"
        >
          <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} strokeWidth={1.8} />
          {t("clinician.fog.refresh")}
        </button>
      </header>

      {!configured || (!session && !authLoading) ? (
        <Empty>{t("clinician.fog.signInToView")}</Empty>
      ) : error ? (
        <div className="px-5 py-4 font-mono text-xs text-destructive">{error}</div>
      ) : rows === null || authLoading ? (
        <Empty>{t("clinician.fog.loading")}</Empty>
      ) : rows.length === 0 ? (
        <Empty>{t("clinician.fog.empty")}</Empty>
      ) : (
        <div>
          <div className="hidden grid-cols-[1.4fr_0.8fr_0.8fr_0.8fr_1fr] gap-2 border-b border-line px-5 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint sm:grid">
            <span>{t("clinician.fog.onset")}</span>
            <span>{t("clinician.fog.duration")}</span>
            <span>{t("clinician.fog.confidence")}</span>
            <span>{t("clinician.fog.freezeIdx")}</span>
            <span>{t("clinician.fog.source")}</span>
          </div>
          {rows.map((r, i) => (
            <div
              key={r.id}
              className={`grid grid-cols-2 items-center gap-2 px-5 py-3 text-sm sm:grid-cols-[1.4fr_0.8fr_0.8fr_0.8fr_1fr] ${
                i > 0 ? "border-t border-line" : ""
              }`}
            >
              <span className="text-ink">{new Date(r.started_at).toLocaleString()}</span>
              <span className="font-mono tabular-nums text-ink-soft">{duration(r)}</span>
              <span className="font-mono tabular-nums text-ink-soft">{pct(r.confidence)}</span>
              <span className="font-mono tabular-nums text-ink-soft">{fixed(r.freeze_index)}</span>
              <span className="truncate font-mono text-[12px] text-ink-faint">{r.source ?? "—"}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-5 py-8 text-center text-[13px] text-ink-faint">{children}</div>;
}

function duration(r: FogEventRow): string {
  if (!r.ended_at) return "—";
  const ms = new Date(r.ended_at).getTime() - new Date(r.started_at).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  return `${(ms / 1000).toFixed(1)}s`;
}

function pct(v: number | null): string {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}

function fixed(v: number | null): string {
  return v == null ? "—" : Number(v).toFixed(2);
}
