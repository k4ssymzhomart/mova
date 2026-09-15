// The check-in's answer set and the rules the form applies before sending it. Pure, so the form and its tests share
// it. The server repeats every check: submit_session_check_in in supabase/migrations/0034_heel_slide_path.sql.
//
// Ported from Phoenix's Questionnaire, with one change: the new-symptoms question must be answered. The RPC stores
// "none" as an empty list, so a question left blank would otherwise be recorded as "no new symptoms".

import type { Locale } from "@/locales";

export const KNEE_OPTIONS = ["better", "same", "slightly_worse", "much_worse"] as const;
export const SYMPTOM_OPTIONS = ["none", "swelling", "redness", "calf_pain", "other"] as const;
export const OTHER_NOTE_MAX = 280;
export const SCALE_MIN = 0;
export const SCALE_MAX = 10;

export type KneeFeels = (typeof KNEE_OPTIONS)[number];
export type Symptom = (typeof SYMPTOM_OPTIONS)[number];
export type ReportedSymptom = Exclude<Symptom, "none">;
export type SubmitError = "notCompleted" | "notAllowed" | "invalid" | "failed";

export interface CheckInAnswers {
  painBefore: number;
  painAfter: number;
  difficulty: number;
  kneeFeels: KneeFeels | null;
  symptoms: readonly Symptom[];
  otherNote: string;
}

/** Phoenix's starting values: no pain before or after, difficulty 3, nothing chosen yet. */
export const INITIAL_ANSWERS: Readonly<CheckInAnswers> = {
  painBefore: 0,
  painAfter: 0,
  difficulty: 3,
  kneeFeels: null,
  symptoms: [],
  otherNote: "",
};

/** Picking "none" clears every symptom; picking a symptom clears "none". */
export function toggleSymptom(current: readonly Symptom[], value: Symptom): Symptom[] {
  if (value === "none") return current.includes("none") ? [] : ["none"];
  const withoutNone = current.filter((s) => s !== "none");
  return withoutNone.includes(value) ? withoutNone.filter((s) => s !== value) : [...withoutNone, value];
}

export interface MissingAnswers {
  kneeFeels: boolean;
  symptoms: boolean;
}

export function missingAnswers(answers: CheckInAnswers): MissingAnswers {
  return { kneeFeels: answers.kneeFeels === null, symptoms: answers.symptoms.length === 0 };
}

export interface CheckInRpcArgs {
  p_session: string;
  p_pain_before: number;
  p_pain_after: number;
  p_difficulty: number;
  p_knee_feels: KneeFeels;
  p_symptoms: ReportedSymptom[];
  p_other_note: string | null;
  p_language: Locale;
}

/**
 * The submit_session_check_in arguments, or null while a required answer is missing. "none" is not sent (an empty
 * list means none), and the note goes only with "other", trimmed, with an empty note sent as null.
 */
export function checkInRpcArgs(sessionId: string, answers: CheckInAnswers, language: Locale): CheckInRpcArgs | null {
  const missing = missingAnswers(answers);
  if (answers.kneeFeels === null || missing.symptoms) return null;
  const reported = answers.symptoms.filter((s): s is ReportedSymptom => s !== "none");
  const note = reported.includes("other") ? answers.otherNote.trim() : "";
  return {
    p_session: sessionId,
    p_pain_before: answers.painBefore,
    p_pain_after: answers.painAfter,
    p_difficulty: answers.difficulty,
    p_knee_feels: answers.kneeFeels,
    p_symptoms: reported,
    p_other_note: note || null,
    p_language: language,
  };
}

/** The RPC's error codes in patient terms. Anything else (a dropped connection included) is "failed". */
export function submitErrorFor(code: string | undefined): SubmitError {
  if (code === "55000") return "notCompleted";
  if (code === "42501") return "notAllowed";
  if (code === "22023") return "invalid";
  return "failed";
}
