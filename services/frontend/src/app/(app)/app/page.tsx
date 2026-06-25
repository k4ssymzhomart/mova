import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, CalendarCheck, Flame, Play, Sparkles, Trophy } from "lucide-react";

import { levelProgress } from "@/lib/gamification/levels";
import { createClient } from "@/lib/supabase/server";
import { getTranslation } from "@/locales/server";

export const metadata: Metadata = { title: "Today · Mova" };

type OneOrMany<T> = T | T[] | null;
function one<T>(v: OneOrMany<T>): T | null {
  return (Array.isArray(v) ? (v[0] ?? null) : v) ?? null;
}

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
  const { t } = getTranslation();
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
  const nextTitle = nextEx ? t(`modality.${nextEx.modality}`) ?? nextEx.name : t("today.freeSession");
  const nextDesc = nextEx?.description ?? t("today.nextDesc");

  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="space-y-8">
      <header>
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-signal">{t("today.eyebrow")} · {today}</div>
        <h1 className="mt-2 text-4xl leading-none text-ink sm:text-5xl">{t("today.welcome", { name })}</h1>
      </header>

      {/* NEXT UP — the command center hero */}
      <section className="relative overflow-hidden rounded-xl border border-line bg-card px-7 py-8 sm:px-10 sm:py-10">
        <div className="relative">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] text-signal">
            <Sparkles className="size-3.5" strokeWidth={2} />
            {t("today.nextUp")}
          </div>
          <h2 className="mt-3 max-w-2xl text-4xl leading-tight text-ink sm:text-6xl">{nextTitle}</h2>
          <p className="mt-4 max-w-lg text-sm leading-relaxed text-ink-soft">{nextDesc}</p>

          <div className="mt-7 flex flex-wrap items-center gap-4">
            <Link
              href="/app/session/new"
              prefetch={false}
              className="inline-flex items-center gap-2 rounded-pill bg-signal px-7 py-3.5 text-sm font-medium text-white transition-colors hover:bg-signal-bright"
            >
              <Play className="size-4" strokeWidth={2} />
              {t("today.startSession")}
            </Link>
            {activeRx[0]?.frequency_per_week != null && (
              <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
                <CalendarCheck className="size-3.5 text-signal" strokeWidth={2} />
                {t("common.perWeek", { n: activeRx[0].frequency_per_week })}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* daily summary */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard icon={Trophy} label={t("today.levelLabel")} value={`${lp.level}`} sub={`${lp.totalXp.toLocaleString()} XP`} />
        <SummaryCard
          icon={Flame}
          label={t("today.currentStreak")}
          value={`${streak}`}
          sub={streak === 1 ? t("today.day") : t("today.days")}
          accent={streak > 0}
        />
        <SummaryCard icon={CalendarCheck} label={t("today.completed")} value={`${completed}`} sub={t("today.recentSessionsSub")} />
        <Link
          href="/achievements"
          className="group flex flex-col justify-between rounded-lg border border-line bg-card p-5 transition-colors hover:border-ink/20"
        >
          <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
            <Sparkles className="size-3.5" strokeWidth={1.8} />
            {t("today.nextLevel")}
          </div>
          <div>
            <div className="tnum text-3xl text-ink">{lp.toNext.toLocaleString()}</div>
            <div className="flex items-center gap-1 font-mono text-[11px] text-ink-faint">
              {t("today.xpToGo")}{" "}
              <ArrowUpRight className="size-3 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
            </div>
          </div>
        </Link>
      </section>

      {/* recent activity */}
      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-2xl text-ink">{t("today.recentActivity")}</h2>
          <Link
            href="/progress"
            className="font-mono text-[11px] uppercase tracking-[0.14em] text-signal-deep hover:underline"
          >
            {t("today.allProgress")}
          </Link>
        </div>
        {sessions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line bg-paper-soft/50 px-6 py-10 text-center text-sm text-ink-soft">
            {t("today.noSessions")}
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
                      {m?.quality_score != null ? `${(m.quality_score * 100).toFixed(0)}% ${t("today.quality")}` : "—"}
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
        <span className="tnum text-3xl text-ink">{value}</span>
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
