import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, CalendarCheck, Flame, Play, Sparkles, Trophy } from "lucide-react";

import { levelProgress } from "@/lib/gamification/levels";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Today · Mova" };

type OneOrMany<T> = T | T[] | null;
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

interface ExerciseRef {
  name: string;
  modality: string;
  description: string | null;
}
interface PrescriptionRow {
  status: string;
  frequency_per_week: number | null;
  exercise: OneOrMany<ExerciseRef>;
}
interface ProgramRow {
  title: string;
  prescriptions: PrescriptionRow[] | null;
}
type Metric = { quality_score: number | null } | null;
interface SessionRow {
  id: string;
  status: string;
  started_at: string;
  session_metrics: OneOrMany<Metric>;
}

export default async function TodayPage() {
  const supabase = createClient();
  await supabase.rpc("provision_self_serve_patient");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null; // layout redirects unauth; guard the race so we never deref a null user

  const [{ data: profile }, { data: programData }, { data: sessionsData }, { data: xpRows }, { data: streakRow }] =
    await Promise.all([
      supabase.from("profiles").select("full_name, display_name").eq("id", user!.id).maybeSingle(),
      supabase
        .from("programs")
        .select(
          `title, prescriptions:prescriptions(status, frequency_per_week, exercise:exercises(name, modality, description))`,
        )
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("sessions")
        .select("id, status, started_at, session_metrics(quality_score)")
        .order("started_at", { ascending: false })
        .limit(5),
      supabase.from("xp_ledger").select("delta"),
      supabase.from("streaks").select("current_streak, longest_streak").maybeSingle(),
    ]);

  const name = profile?.display_name || profile?.full_name || user!.email?.split("@")[0] || "there";
  const program = (programData ?? null) as ProgramRow | null;
  const sessions = (sessionsData ?? []) as unknown as SessionRow[];
  const totalXp = (xpRows ?? []).reduce((s: number, r: { delta: number }) => s + r.delta, 0);
  const lp = levelProgress(totalXp);
  const streak = streakRow?.current_streak ?? 0;
  const completed = sessions.filter((s) => s.status === "completed").length;

  const activeRx = (program?.prescriptions ?? []).filter((p) => p.status === "active");
  const nextEx = activeRx[0] ? one(activeRx[0].exercise) : null;
  const nextTitle = nextEx ? MODALITY_LABEL[nextEx.modality] ?? nextEx.name : "Free training session";
  const nextDesc =
    nextEx?.description ??
    "Open a guided session — the camera tracks your movement and scores range, smoothness, and freeze-risk in real time.";

  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="space-y-8">
      <header>
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-signal">Today · {today}</div>
        <h1 className="mt-2 font-serif text-4xl leading-none text-ink sm:text-5xl">Welcome back, {name}.</h1>
      </header>

      {/* NEXT UP — the command center hero */}
      <section className="relative overflow-hidden rounded-xl border border-line bg-card px-7 py-8 sm:px-10 sm:py-10">
        <div className="relative">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] text-signal">
            <Sparkles className="size-3.5" strokeWidth={2} />
            Next up
          </div>
          <h2 className="mt-3 max-w-2xl font-serif text-4xl leading-tight text-ink sm:text-6xl">{nextTitle}</h2>
          <p className="mt-4 max-w-lg text-sm leading-relaxed text-ink-soft">{nextDesc}</p>

          <div className="mt-7 flex flex-wrap items-center gap-4">
            <Link
              href="/app/session/new"
              prefetch={false}
              className="inline-flex items-center gap-2 rounded-pill bg-signal px-7 py-3.5 text-sm font-medium text-white transition-colors hover:bg-signal-bright"
            >
              <Play className="size-4" strokeWidth={2} />
              Start session
            </Link>
            {activeRx[0]?.frequency_per_week != null && (
              <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
                <CalendarCheck className="size-3.5 text-signal" strokeWidth={2} />
                {activeRx[0].frequency_per_week}× per week
              </span>
            )}
          </div>
        </div>
      </section>

      {/* daily summary */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard icon={Trophy} label="Level" value={`${lp.level}`} sub={`${lp.totalXp.toLocaleString()} XP`} />
        <SummaryCard
          icon={Flame}
          label="Current streak"
          value={`${streak}`}
          sub={streak === 1 ? "day" : "days"}
          accent={streak > 0}
        />
        <SummaryCard icon={CalendarCheck} label="Completed" value={`${completed}`} sub="recent sessions" />
        <Link
          href="/achievements"
          className="group flex flex-col justify-between rounded-lg border border-line bg-card p-5 transition-colors hover:border-ink/20"
        >
          <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
            <Sparkles className="size-3.5" strokeWidth={1.8} />
            Next level
          </div>
          <div>
            <div className="tnum font-serif text-3xl text-ink">{lp.toNext.toLocaleString()}</div>
            <div className="flex items-center gap-1 font-mono text-[11px] text-ink-faint">
              XP to go{" "}
              <ArrowUpRight className="size-3 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
            </div>
          </div>
        </Link>
      </section>

      {/* recent activity */}
      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-serif text-2xl text-ink">Recent activity</h2>
          <Link
            href="/progress"
            className="font-mono text-[11px] uppercase tracking-[0.14em] text-signal-deep hover:underline"
          >
            All progress
          </Link>
        </div>
        {sessions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line bg-paper-soft/50 px-6 py-10 text-center text-sm text-ink-soft">
            No sessions yet — your first one starts above.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line bg-card">
            {sessions.map((s, i) => {
              const m = one(s.session_metrics);
              return (
                <Link
                  key={s.id}
                  href={`/app/session/${s.id}`}
                  className={`flex items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-paper-soft/50 ${
                    i ? "border-t border-line" : ""
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <StatusDot status={s.status} />
                    <div>
                      <div className="text-sm text-ink">{new Date(s.started_at).toLocaleDateString()}</div>
                      <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-faint">
                        {s.status.replace("_", " ")}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="tnum font-mono text-sm text-ink-soft">
                      {m?.quality_score != null ? `${(m.quality_score * 100).toFixed(0)}% quality` : "—"}
                    </span>
                    <ArrowRight className="size-4 text-ink-faint" strokeWidth={1.8} />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  sub,
  accent = false,
}: {
  icon: typeof Flame;
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-5 ${accent ? "border-signal/30 bg-signal/[0.05]" : "border-line bg-card"}`}>
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
        <Icon className={`size-3.5 ${accent ? "text-signal" : ""}`} strokeWidth={1.8} />
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="tnum font-serif text-3xl text-ink">{value}</span>
        <span className="text-sm text-ink-faint">{sub}</span>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const done = status === "completed";
  return (
    <span
      className={`grid size-9 shrink-0 place-items-center rounded-full ${
        done ? "bg-signal/10" : "bg-amber-50"
      }`}
    >
      <span className={`size-2 rounded-full ${done ? "bg-signal" : "bg-amber-500"}`} />
    </span>
  );
}
