import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { EXERCISE_CONFIGS } from "@/lib/scoring/exerciseConfigs";
import type { ExerciseSlug } from "@/lib/scoring/types";
import { roleFromBodySite, type SensorRole } from "@/lib/ble/roles";
import { createClient } from "@/lib/supabase/server";

import ExerciseStudio from "./ExerciseStudio";
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

function isKneeRehabSlug(slug: string | null | undefined): slug is ExerciseSlug {
  return !!slug && slug in EXERCISE_CONFIGS;
}

export default async function SessionDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const [{ data: session }, { data: auth }] = await Promise.all([
    supabase
      .from("sessions")
      .select("id, status, started_at, ended_at, session_metrics(*), exercise:exercises(slug, name, demo_video_url)")
      .eq("id", params.id)
      .maybeSingle(),
    supabase.auth.getUser(),
  ]);

  if (!session) notFound();

  const exercise = (Array.isArray(session.exercise) ? session.exercise[0] : session.exercise) as
    | { slug: string; name: string; demo_video_url: string | null }
    | null;

  // In-progress sessions get the full training studio. Knee-rehab exercises (the 8 in
  // lib/scoring/exerciseConfigs.ts) get the real BLE-driven ExerciseStudio; every other exercise pack
  // (reach/gait, for stroke/Parkinson's patients) keeps the existing camera + ONNX + telemetry flow.
  if (session.status !== "completed") {
    if (isKneeRehabSlug(exercise?.slug)) {
      const { data: patient } = await supabase.from("patients").select("id, affected_side").maybeSingle();
      const { data: pairedRows } = patient
        ? await supabase.from("patient_ble_devices").select("role, device_name").eq("patient_id", patient.id)
        : { data: null };
      const pairedDeviceNames: Partial<Record<SensorRole, string | null>> = {};
      for (const row of pairedRows ?? []) {
        const role = roleFromBodySite(row.role as string);
        if (role) pairedDeviceNames[role] = row.device_name as string | null;
      }
      const affectedSide = patient?.affected_side as string | null;
      const config = EXERCISE_CONFIGS[exercise.slug];

      return (
        <ExerciseStudio
          sessionId={session.id}
          exerciseSlug={exercise.slug}
          exerciseName={exercise.name}
          demoVideoUrl={exercise.demo_video_url}
          patientId={patient?.id ?? null}
          affectedSide={affectedSide === "left" || affectedSide === "right" ? affectedSide : null}
          pairedDeviceNames={pairedDeviceNames}
          prescribedRepsPerSet={config.prescribedRepsDefault}
          totalSets={3}
        />
      );
    }
    return <SessionStudio sessionId={session.id} userId={auth.user?.id ?? ""} />;
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
        <h1 className="mt-2 text-3xl text-ink">
          <span className="font-mono text-2xl">{session.id.slice(0, 8)}</span>
        </h1>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <Row k="Started" v={new Date(session.started_at).toLocaleString()} />
          {session.ended_at && <Row k="Ended" v={new Date(session.ended_at).toLocaleString()} />}
        </dl>
      </div>

      <div>
        <h2 className="mb-3 text-xl text-ink">Session metrics</h2>
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
      <div className="tnum mt-1.5 text-2xl text-ink">{value}</div>
    </div>
  );
}
