// Shared by the two Progress routes (the history and one session) and the flow's summary step: the session read,
// status as icon + word, duration, and the card that says exercise scores are not available yet. The summary step
// takes SessionStatus and formatDuration from here, so a session's status and length read the same everywhere.
// Server-only: it reads the auth and locale cookies.
//
// Every read filters to the signed-in patient's own patients.id rather than relying on RLS, which is being
// reworked (#20). session_metrics is never selected: its columns (quality, ROM, adherence, FoG risk…) came from
// the retired webcam pipeline and say nothing true about a knee after TKA.

import {
  CalendarClock,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CircleX,
  ClipboardCheck,
  Hourglass,
  type LucideIcon,
} from "lucide-react";

import { bodyText, card, cardTitle } from "@/components/app/recipes";
import { parseSessionSummary, type SessionFacts } from "@/lib/sessions/summary";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { getTranslation } from "@/locales/server";

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** How many of the newest sessions /progress lists. The summary counts cover the whole history. */
export const HISTORY_LIMIT = 50;

// Finished sessions: `reviewed` is a completed session a clinician has since looked at.
const FINISHED_STATUSES = ["completed", "reviewed"];

const SESSION_COLUMNS = "id, status, started_at, ended_at, summary, exercise:exercises(name)";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PostgREST returns a to-one embed as an object, or as a single-element array depending on the client.
type OneOrMany<T> = T | T[] | null;

interface SessionRow {
  id: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  /** What the session itself recorded, written once when it finished. Unrecognised shapes parse to null. */
  summary: unknown;
  exercise: OneOrMany<{ name: string | null }>;
}

export interface SessionEntry {
  id: string;
  /** public.session_status: scheduled | in_progress | completed | aborted | reviewed. */
  status: string;
  startedAt: string;
  endedAt: string | null;
  /** exercises.name as stored in the catalogue; null when the session has no exercise. */
  exerciseName: string | null;
  /** What the session recorded: repetitions, sensors, telemetry. Null for a session that stored nothing. */
  facts: SessionFacts | null;
}

function toEntry(row: SessionRow): SessionEntry {
  const exercise = Array.isArray(row.exercise) ? (row.exercise[0] ?? null) : row.exercise;
  return {
    id: row.id,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    exerciseName: exercise?.name?.trim() || null,
    facts: parseSessionSummary(row.summary),
  };
}

type Supabase = ReturnType<typeof createClient>;

/** The signed-in user's patients.id: null when signed out or when no patient record exists yet. */
async function resolvePatientId(
  supabase: Supabase,
): Promise<{ ok: true; patientId: string | null } | { ok: false }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: true, patientId: null };

  const { data, error } = await supabase.from("patients").select("id").eq("profile_id", user.id).maybeSingle();
  if (error) return { ok: false };
  return { ok: true, patientId: (data?.id as string | undefined) ?? null };
}

export type HistoryResult =
  | {
      status: "ok";
      sessions: SessionEntry[];
      total: number;
      finished: number;
      /** The newest completed or reviewed session in the whole history; null when there is none. */
      lastFinished: SessionEntry | null;
    }
  | { status: "error" };

/** The patient's newest sessions plus whole-history counts. A failed read is an error, never "no sessions". */
export async function readSessionHistory(): Promise<HistoryResult> {
  const supabase = createClient();
  const patient = await resolvePatientId(supabase);
  if (!patient.ok) return { status: "error" };
  // No patient record means no sessions: sessions.patient_id is not null.
  if (!patient.patientId) return { status: "ok", sessions: [], total: 0, finished: 0, lastFinished: null };
  const patientId = patient.patientId;

  const [list, total, finished] = await Promise.all([
    supabase
      .from("sessions")
      .select(SESSION_COLUMNS)
      .eq("patient_id", patientId)
      .order("started_at", { ascending: false })
      .limit(HISTORY_LIMIT),
    supabase.from("sessions").select("id", { count: "exact", head: true }).eq("patient_id", patientId),
    // The count covers every finished session and the one row is the newest of them. It is not picked out of the
    // list above: the old app opened an exercise-less in_progress session on every visit, so the listed page can
    // be all unfinished rows while an older finished session exists.
    supabase
      .from("sessions")
      .select(SESSION_COLUMNS, { count: "exact" })
      .eq("patient_id", patientId)
      .in("status", FINISHED_STATUSES)
      .order("started_at", { ascending: false })
      .limit(1),
  ]);

  if (list.error || total.error || finished.error || total.count === null || finished.count === null) {
    return { status: "error" };
  }

  const newestFinished = ((finished.data ?? []) as unknown as SessionRow[])[0];
  return {
    status: "ok",
    sessions: ((list.data ?? []) as unknown as SessionRow[]).map(toEntry),
    total: total.count,
    finished: finished.count,
    lastFinished: newestFinished ? toEntry(newestFinished) : null,
  };
}

/** One patient's own answers after a session (0034). Absent when they closed the check-in without answering. */
export interface CheckInEntry {
  sessionId: string;
  painBefore: number | null;
  painAfter: number | null;
  difficulty: number | null;
  /** better | same | slightly_worse | much_worse */
  kneeFeels: string | null;
  /** swelling | redness | calf_pain | other; an empty list means the patient answered "none". */
  symptoms: string[];
}

/**
 * The check-ins for the sessions on screen, keyed by session. Read straight from session_check_ins, which the
 * patient's own policy admits (0034). A failed read returns an empty map: the table then shows «—» in those
 * columns rather than claiming the patient reported nothing.
 */
export async function readCheckIns(sessionIds: string[]): Promise<Map<string, CheckInEntry>> {
  const map = new Map<string, CheckInEntry>();
  if (sessionIds.length === 0) return map;
  const supabase = createClient();
  const { data, error } = await supabase
    .from("session_check_ins")
    .select("session_id, pain_before, pain_after, difficulty, knee_feels, symptoms")
    .in("session_id", sessionIds);
  if (error || !data) return map;
  for (const row of data as unknown as {
    session_id: string;
    pain_before: number | null;
    pain_after: number | null;
    difficulty: number | null;
    knee_feels: string | null;
    symptoms: string[] | null;
  }[]) {
    map.set(row.session_id, {
      sessionId: row.session_id,
      painBefore: row.pain_before,
      painAfter: row.pain_after,
      difficulty: row.difficulty,
      kneeFeels: row.knee_feels?.trim() || null,
      symptoms: Array.isArray(row.symptoms) ? row.symptoms : [],
    });
  }
  return map;
}

export type SessionResult = { status: "ok"; session: SessionEntry } | { status: "not-found" } | { status: "error" };

/** One session, only if it belongs to the signed-in patient. Someone else's session reads as not found. */
export async function readSession(sessionId: string): Promise<SessionResult> {
  // Not a uuid: it cannot be a session, and Postgres would reject the comparison as an error.
  if (!UUID_RE.test(sessionId)) return { status: "not-found" };

  const supabase = createClient();
  const patient = await resolvePatientId(supabase);
  if (!patient.ok) return { status: "error" };
  if (!patient.patientId) return { status: "not-found" };

  const { data, error } = await supabase
    .from("sessions")
    .select(SESSION_COLUMNS)
    .eq("id", sessionId)
    .eq("patient_id", patient.patientId)
    .maybeSingle();

  if (error) return { status: "error" };
  if (!data) return { status: "not-found" };
  return { status: "ok", session: toEntry(data as unknown as SessionRow) };
}

const STATUS: Record<string, { icon: LucideIcon; labelKey: string; iconClass: string }> = {
  scheduled: { icon: CalendarClock, labelKey: "progress.status.scheduled", iconClass: "text-ink-soft" },
  // Nothing closes an abandoned session yet, so in_progress also covers sessions that were never finished.
  // The word is "not finished", which is true either way.
  in_progress: { icon: CircleDashed, labelKey: "progress.status.inProgress", iconClass: "text-ink-soft" },
  completed: { icon: CircleCheck, labelKey: "progress.status.completed", iconClass: "text-signal-deep" },
  aborted: { icon: CircleX, labelKey: "progress.status.aborted", iconClass: "text-ink-soft" },
  reviewed: { icon: ClipboardCheck, labelKey: "progress.status.reviewed", iconClass: "text-signal-deep" },
};

const UNKNOWN_STATUS = { icon: CircleHelp, labelKey: "progress.status.unknown", iconClass: "text-ink-soft" };

/** Session status as an icon and a word. The icon colour only repeats what the word says. */
export function SessionStatus({ status }: { status: string }) {
  const { t } = getTranslation();
  const meta = STATUS[status] ?? UNKNOWN_STATUS;
  const Icon = meta.icon;
  return (
    <span className="inline-flex items-center gap-2 text-base font-medium text-ink">
      <Icon className={cn("size-5 shrink-0", meta.iconClass)} strokeWidth={2} aria-hidden="true" />
      {t(meta.labelKey)}
    </span>
  );
}

/** Wall-clock length of a session from its own timestamps, or null when no end time was recorded. */
export function formatDuration(startedAt: string, endedAt: string | null, t: Translate): string | null {
  if (!endedAt) return null;
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 60_000) return t("progress.duration.underMinute");

  const minutes = Math.round(ms / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return t("progress.duration.minutes", { n: m });
  if (m === 0) return t("progress.duration.hours", { h });
  return t("progress.duration.hoursMinutes", { h, m });
}

/**
 * Where the patient's exercise scores will go. There is no IMU scoring engine yet, so the card says so plainly
 * and shows no numbers, bars or charts. One per page (its heading id is fixed).
 */
export function ScoresNotAvailableCard() {
  const { t } = getTranslation();
  // TODO(#23): show «Техника», «Повторы», «Цель движения» and «Итог» once the scoring engine writes them.
  return (
    <section aria-labelledby="progress-scores-title" className={cn(card, "p-5 sm:p-6")}>
      <div className="flex items-start gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-paper-soft text-ink-soft ring-1 ring-line">
          <Hourglass className="size-5" strokeWidth={1.9} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 id="progress-scores-title" className={cardTitle}>
            {t("progress.scores.title")}
          </h2>
          <p className="mt-2 text-base font-medium text-ink">{t("progress.scores.unavailable")}</p>
          <p className={cn("mt-1", bodyText)}>{t("progress.scores.body")}</p>
        </div>
      </div>
    </section>
  );
}
