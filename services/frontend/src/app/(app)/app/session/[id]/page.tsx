import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { createClient } from "@/lib/supabase/server";

import SessionStudio from "./SessionStudio";

type Metrics = {
  reps: number | null;
  rom_max: number | null;
  rom_mean: number | null;
  smoothness: number | null;
  symmetry: number | null;
  quality_score: number | null;
  adherence: number | null;
  fog_risk: number | null;
} | null;

export default async function SessionDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: session } = await supabase
    .from("sessions")
    .select("id, status, started_at, ended_at, session_metrics(*)")
    .eq("id", params.id)
    .maybeSingle();

  if (!session) notFound();

  // In-progress sessions get the full training studio (camera + ONNX + telemetry + rewards).
  if (session.status !== "completed") {
    return <SessionStudio sessionId={session.id} />;
  }

  // PostgREST may return a to-one embed as an object or a single-element array.
  const rawMetrics = session.session_metrics as unknown;
  const m = (Array.isArray(rawMetrics) ? (rawMetrics[0] ?? null) : (rawMetrics ?? null)) as Metrics;

  return (
    <div className="mx-auto max-w-shell space-y-8">
      <a href="/app" className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
        <ChevronLeft className="size-4" strokeWidth={1.6} />
        All sessions
      </a>

      <div>
        <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-signal">Completed session</div>
        <h1 className="mt-2 font-serif text-3xl text-ink">
          <span className="font-mono text-2xl">{session.id.slice(0, 8)}</span>
        </h1>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <Row k="Started" v={new Date(session.started_at).toLocaleString()} />
          {session.ended_at && <Row k="Ended" v={new Date(session.ended_at).toLocaleString()} />}
        </dl>
      </div>

      <div>
        <h2 className="mb-3 font-serif text-xl text-ink">Session metrics</h2>
        {m ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Quality" value={fmt(m.quality_score)} />
            <Metric label="Reps" value={m.reps != null ? `${m.reps}` : "—"} />
            <Metric label="ROM max" value={fmt(m.rom_max, "°")} />
            <Metric label="ROM mean" value={fmt(m.rom_mean, "°")} />
            <Metric label="Smoothness" value={fmt(m.smoothness)} />
            <Metric label="Symmetry" value={fmt(m.symmetry)} />
            <Metric label="Adherence" value={fmt(m.adherence)} />
            <Metric label="FoG risk" value={fmt(m.fog_risk)} />
          </div>
        ) : (
          <p className="text-sm text-ink-faint">No metrics recorded.</p>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <a
          href="/app/session/new"
          className="rounded-pill bg-signal px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-signal-bright"
        >
          Train again →
        </a>
        <a
          href="/progress"
          className="rounded-pill border border-line px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-paper-soft"
        >
          View progress
        </a>
      </div>
    </div>
  );
}

function fmt(v: number | null, suffix = "") {
  return v != null ? `${Number(v).toFixed(2)}${suffix}` : "—";
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between border-b border-line py-1.5">
      <dt className="text-ink-faint">{k}</dt>
      <dd className="text-ink">{v}</dd>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-line bg-card p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">{label}</div>
      <div className="tnum mt-1.5 font-serif text-2xl text-ink">{value}</div>
    </div>
  );
}
