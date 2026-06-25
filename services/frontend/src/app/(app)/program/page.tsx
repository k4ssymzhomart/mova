import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarCheck, Dumbbell, Gauge, NotebookPen, Target } from "lucide-react";

import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My Program · Mova" };

// PostgREST returns a to-one embed as either an object or a single-element array.
type OneOrMany<T> = T | T[] | null;

interface ExerciseRef {
  slug: string;
  name: string;
  modality: string;
  description: string | null;
  target_joints: string[] | null;
  difficulty: string | null;
}
interface PrescriptionRow {
  id: string;
  difficulty: string | null;
  dose: Record<string, unknown> | null;
  frequency_per_week: number | null;
  status: string;
  clinician_note: string | null;
  exercise: OneOrMany<ExerciseRef>;
}
interface ProgramRow {
  id: string;
  title: string;
  status: string;
  start_date: string | null;
  notes: string | null;
  prescriptions: PrescriptionRow[] | null;
}
type SessionMetric = { quality_score: number | null; adherence: number | null };
interface WeekSession {
  id: string;
  status: string;
  started_at: string;
  session_metrics: OneOrMany<SessionMetric>;
}

function one<T>(v: OneOrMany<T>): T | null {
  return (Array.isArray(v) ? (v[0] ?? null) : v) ?? null;
}

const MODALITY_LABEL: Record<string, string> = {
  upper_limb_reaching: "Upper-limb reaching",
  hand_grasp: "Hand & grasp",
  head_neck: "Head & neck",
  gait_balance: "Gait & balance",
  sit_to_stand_lower_limb: "Sit-to-stand",
};

const SIDE: Record<string, string> = { l: "Left", r: "Right" };
function jointLabel(j: string): string {
  const [a, ...rest] = j.split("_");
  if ((a === "l" || a === "r") && rest.length) {
    return `${SIDE[a]} ${rest.join(" ")}`;
  }
  return j.replace(/_/g, " ");
}

export default async function ProgramPage() {
  const supabase = createClient();

  // Idempotent safety net: make sure a self-serve patient row exists so the RLS-scoped
  // reads below resolve (mirrors the Today page).
  await supabase.rpc("provision_self_serve_patient");

  const [{ data: programData }, { data: weekData }] = await Promise.all([
    supabase
      .from("programs")
      .select(
        `id, title, status, start_date, notes,
         prescriptions:prescriptions(
           id, difficulty, dose, frequency_per_week, status, clinician_note,
           exercise:exercises(slug, name, modality, description, target_joints, difficulty)
         )`,
      )
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("sessions")
      .select("id, status, started_at, session_metrics(quality_score, adherence)")
      .gte("started_at", new Date(Date.now() - 7 * 864e5).toISOString())
      .order("started_at", { ascending: false }),
  ]);

  const program = (programData ?? null) as ProgramRow | null;
  const week = (weekData ?? []) as unknown as WeekSession[];

  const prescriptions = (program?.prescriptions ?? []).filter((p) => p.status === "active");
  const primary = prescriptions[0];
  const primaryEx = primary ? one(primary.exercise) : null;
  const moduleTitle = primaryEx
    ? MODALITY_LABEL[primaryEx.modality] ?? primaryEx.name
    : program?.title ?? "Free training";

  // Weekly adherence: completed sessions vs. the prescribed weekly dose.
  const completedThisWeek = week.filter((s) => s.status === "completed").length;
  const targetPerWeek = prescriptions.reduce(
    (max, p) => Math.max(max, p.frequency_per_week ?? 0),
    0,
  );
  const adherencePct =
    targetPerWeek > 0 ? Math.min(100, Math.round((completedThisWeek / targetPerWeek) * 100)) : null;
  const qualityVals = week
    .map((s) => one(s.session_metrics)?.quality_score)
    .filter((v): v is number => v != null);
  const avgQuality = qualityVals.length
    ? qualityVals.reduce((a, b) => a + b, 0) / qualityVals.length
    : null;

  return (
    <div className="space-y-8">
      <header>
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-signal">My Program</div>
        <h1 className="mt-2 font-serif text-4xl italic leading-none text-ink">
          Your prescribed plan.
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-soft">
          {program
            ? "The plan your care team set for you — today's focus, your weekly dose, and how you're tracking."
            : "You don't have a prescribed plan yet. You can still train freely while your care team sets one up."}
        </p>
      </header>

      {/* Active module — the day's focus + CTA */}
      <section className="relative overflow-hidden rounded-xl border border-line bg-card px-7 py-7 sm:px-9 sm:py-9">
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0">
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-signal">
              {program ? "Today's focus" : "Today"}
            </div>
            <h2 className="mt-2 font-serif text-4xl italic leading-tight text-ink sm:text-5xl">
              {moduleTitle}
            </h2>
            {primaryEx?.description && (
              <p className="mt-3 max-w-md text-sm leading-relaxed text-ink-soft">
                {primaryEx.description}
              </p>
            )}
            {primary?.frequency_per_week != null && (
              <div className="mt-4 inline-flex items-center gap-2 rounded-pill border border-line bg-paper-soft px-3 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-soft">
                <CalendarCheck className="size-3.5 text-signal" strokeWidth={2} />
                {primary.frequency_per_week}× per week
              </div>
            )}
          </div>
          <Link
            href="/app/session/new"
            prefetch={false}
            className="inline-flex shrink-0 items-center gap-2 rounded-pill bg-signal px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-signal-bright"
          >
            Start today&apos;s session
            <ArrowRight className="size-4" strokeWidth={2} />
          </Link>
        </div>
      </section>

      {/* Weekly adherence */}
      <section>
        <h2 className="mb-4 font-serif text-2xl italic text-ink">This week</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric icon={Gauge} label="Adherence" value={adherencePct != null ? `${adherencePct}%` : "—"} />
          <Metric icon={CalendarCheck} label="Sessions done" value={`${completedThisWeek}`} />
          <Metric
            icon={Target}
            label="Weekly dose"
            value={targetPerWeek > 0 ? `${targetPerWeek}×` : "—"}
          />
          <Metric
            icon={Gauge}
            label="Avg quality"
            value={avgQuality != null ? avgQuality.toFixed(2) : "—"}
          />
        </div>
      </section>

      {/* Prescribed exercises */}
      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-serif text-2xl italic text-ink">Prescribed exercises</h2>
          {prescriptions.length > 0 && (
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
              {prescriptions.length} active
            </span>
          )}
        </div>

        {prescriptions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line bg-paper-soft/50 px-6 py-10 text-center">
            <Dumbbell className="mx-auto size-6 text-ink-faint" strokeWidth={1.6} />
            <p className="mt-3 text-sm text-ink-soft">
              No exercises prescribed yet. Browse the{" "}
              <Link href="/exercises" className="text-signal-deep underline-offset-2 hover:underline">
                exercise library
              </Link>{" "}
              or start a free session to begin.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {prescriptions.map((p) => {
              const ex = one(p.exercise);
              if (!ex) return null;
              return (
                <article key={p.id} className="rounded-lg border border-line bg-card p-5">
                  <div className="flex items-center gap-2">
                    <span className="rounded-pill bg-signal/10 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-signal-deep">
                      {MODALITY_LABEL[ex.modality] ?? ex.modality}
                    </span>
                    {(p.difficulty ?? ex.difficulty) && (
                      <span className="rounded-pill bg-paper-soft px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint ring-1 ring-line">
                        {p.difficulty ?? ex.difficulty}
                      </span>
                    )}
                  </div>
                  <h3 className="mt-3 font-serif text-xl text-ink">{ex.name}</h3>
                  {ex.description && (
                    <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">{ex.description}</p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-ink-faint">
                    {p.frequency_per_week != null && <span>{p.frequency_per_week}× / week</span>}
                    {ex.target_joints && ex.target_joints.length > 0 && (
                      <span>{ex.target_joints.map(jointLabel).join(" · ")}</span>
                    )}
                  </div>
                  {p.clinician_note && (
                    <div className="mt-3 flex items-start gap-2 rounded-xl bg-paper-soft/70 px-3 py-2 text-[12px] text-ink-soft">
                      <NotebookPen className="mt-0.5 size-3.5 shrink-0 text-ink-faint" strokeWidth={1.8} />
                      <span>{p.clinician_note}</span>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {program?.notes && (
        <section className="rounded-lg border border-line bg-paper-soft/50 p-5">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-faint">
            <NotebookPen className="size-3.5" strokeWidth={1.8} />
            Care-team note
          </div>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">{program.notes}</p>
        </section>
      )}
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Gauge;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-card p-5">
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
        <Icon className="size-3.5" strokeWidth={1.8} />
        {label}
      </div>
      <div className="tnum mt-2 font-serif text-3xl text-ink">{value}</div>
    </div>
  );
}
