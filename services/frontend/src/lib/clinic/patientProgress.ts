// What a patient has actually done, for the clinician: every finished session, what it recorded, what the patient
// answered afterwards, and whether the last week looks better or worse than the week before it.
//
// Everything here is read back from rows the sessions themselves wrote — sessions.summary (both kinds: the Heel
// Slide record and the generic exercise record), and session_check_ins. Nothing is derived that the data does not
// support: a session that stored no repetition count contributes to no trend, and a patient with fewer than two
// weeks of sessions gets no trend at all rather than a direction invented from one point.
//
// The clinician reads these rows under the same rule as everything else on this page: an active care-team link,
// the patient's clinic admin, or a platform admin.

import "server-only";

import { parseSessionSummary, type SessionFacts } from "@/lib/sessions/summary";
import { createClient } from "@/lib/supabase/server";

export interface ProgressSession {
  id: string;
  startedAt: string;
  endedAt: string | null;
  status: string;
  exerciseName: string | null;
  exerciseSlug: string | null;
  /** The Heel Slide record, parsed. Null for a session of another kind or one that stored nothing. */
  heelSlideFacts: SessionFacts | null;
  /** Repetitions counted and prescribed, from whichever record the session wrote. */
  reps: number | null;
  targetReps: number | null;
  /** The stored execution score, 0–100, or null when the session stored none. */
  execution: number | null;
  /** true when parts of the score abstained, so the number covers less than the whole. */
  partialScore: boolean;
  simulated: boolean;
  painBefore: number | null;
  painAfter: number | null;
  difficulty: number | null;
  kneeFeels: string | null;
  symptoms: string[];
}

export interface ProgressTrend {
  /** Sessions finished in the last seven days, and in the seven before that. */
  sessionsThisWeek: number;
  sessionsWeekBefore: number;
  /** Mean repetitions per session over each of those two weeks, or null when a week has no counted repetition. */
  repsThisWeek: number | null;
  repsWeekBefore: number | null;
  /** Mean pain after a session over each week, or null when nobody answered. */
  painThisWeek: number | null;
  painWeekBefore: number | null;
  /** Sessions in the last fourteen days whose check-in reported any new symptom. */
  symptomReports: number;
}

export type ProgressResult =
  | { status: "ok"; sessions: ProgressSession[]; trend: ProgressTrend | null }
  | { status: "error" };

const FINISHED = ["completed", "reviewed"];
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

interface SessionRow {
  id: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  summary: unknown;
  exercise: { name: string | null; slug: string | null } | { name: string | null; slug: string | null }[] | null;
}

interface CheckInRow {
  session_id: string;
  pain_before: number | null;
  pain_after: number | null;
  difficulty: number | null;
  knee_feels: string | null;
  symptoms: string[] | null;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** Repetitions, target and score out of either summary kind. The generic record is exercise_session.v1. */
function readSummary(raw: unknown): {
  reps: number | null;
  target: number | null;
  execution: number | null;
  partial: boolean;
  simulated: boolean;
} {
  if (!isObject(raw)) return { reps: null, target: null, execution: null, partial: false, simulated: false };
  const score = isObject(raw.score) ? raw.score : null;
  return {
    reps: num(raw.reps_counted) ?? num(raw.reps_counted_on_device),
    target: num(raw.target_reps),
    execution: score ? num(score.execution) : null,
    partial: score ? score.partial === true : false,
    simulated: raw.simulated === true,
  };
}

const mean = (values: number[]): number | null =>
  values.length === 0 ? null : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;

/**
 * The patient's finished sessions, newest first, with the answers they gave afterwards, and the two-week trend.
 *
 * `now` is a parameter so the trend can be tested; callers pass nothing and get the current time.
 */
export async function loadPatientProgress(patientId: string, limit = 60, now = Date.now()): Promise<ProgressResult> {
  const supabase = createClient();
  const sessions = await supabase
    .from("sessions")
    .select("id, started_at, ended_at, status, summary, exercise:exercises(name, slug)")
    .eq("patient_id", patientId)
    .in("status", FINISHED)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (sessions.error) return { status: "error" };

  const rows = (sessions.data ?? []) as unknown as SessionRow[];
  const checkIns = new Map<string, CheckInRow>();
  if (rows.length > 0) {
    const answers = await supabase
      .from("session_check_ins")
      .select("session_id, pain_before, pain_after, difficulty, knee_feels, symptoms")
      .in(
        "session_id",
        rows.map((row) => row.id),
      );
    // A failed read leaves the answer columns empty; it never turns into "the patient reported nothing".
    if (!answers.error) {
      for (const row of (answers.data ?? []) as CheckInRow[]) checkIns.set(row.session_id, row);
    }
  }

  const out: ProgressSession[] = rows.map((row) => {
    const exercise = Array.isArray(row.exercise) ? (row.exercise[0] ?? null) : row.exercise;
    const summary = readSummary(row.summary);
    const heelSlideFacts = parseSessionSummary(row.summary);
    const answer = checkIns.get(row.id);
    return {
      id: row.id,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      status: row.status,
      exerciseName: exercise?.name?.trim() || null,
      exerciseSlug: exercise?.slug?.trim() || null,
      heelSlideFacts,
      reps: summary.reps ?? heelSlideFacts?.repsCounted ?? null,
      targetReps: summary.target ?? heelSlideFacts?.targetReps ?? null,
      execution: summary.execution,
      partialScore: summary.partial,
      simulated: summary.simulated || heelSlideFacts?.simulated === true,
      painBefore: answer?.pain_before ?? null,
      painAfter: answer?.pain_after ?? null,
      difficulty: answer?.difficulty ?? null,
      kneeFeels: answer?.knee_feels?.trim() || null,
      symptoms: Array.isArray(answer?.symptoms) ? (answer?.symptoms ?? []) : [],
    };
  });

  const within = (session: ProgressSession, from: number, to: number) => {
    const at = Date.parse(session.startedAt);
    return Number.isFinite(at) && at >= from && at < to;
  };
  const thisWeek = out.filter((session) => within(session, now - WEEK_MS, now + 1));
  const weekBefore = out.filter((session) => within(session, now - 2 * WEEK_MS, now - WEEK_MS));
  const numbers = (list: ProgressSession[], pick: (s: ProgressSession) => number | null) =>
    list.map(pick).filter((value): value is number => value !== null);

  // Two weeks with nothing in them say nothing about a direction, so the trend is withheld rather than drawn at zero.
  const trend: ProgressTrend | null =
    thisWeek.length === 0 && weekBefore.length === 0
      ? null
      : {
          sessionsThisWeek: thisWeek.length,
          sessionsWeekBefore: weekBefore.length,
          repsThisWeek: mean(numbers(thisWeek, (s) => s.reps)),
          repsWeekBefore: mean(numbers(weekBefore, (s) => s.reps)),
          painThisWeek: mean(numbers(thisWeek, (s) => s.painAfter)),
          painWeekBefore: mean(numbers(weekBefore, (s) => s.painAfter)),
          symptomReports: [...thisWeek, ...weekBefore].filter((s) => s.symptoms.length > 0).length,
        };

  return { status: "ok", sessions: out, trend };
}
