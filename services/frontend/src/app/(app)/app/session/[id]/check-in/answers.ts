// The check-in's answer set and the rules the form applies before sending it. Pure, so the form and its tests share
// it. The server repeats every check: submit_session_check_in in supabase/migrations/0034_heel_slide_path.sql.
//
// Ported from Phoenix's Questionnaire, with two changes, both so that nothing is stored that the patient did not
// say:
//  - The three 0–10 scales start unanswered and must be answered. Phoenix preset pain before and after to 0 and
//    difficulty to 3; the table has no "not answered" value, so an untouched preset would reach the clinician as
//    "no pain" and a difficulty the patient never picked.
//  - The new-symptoms question must be answered. The RPC stores "none" as an empty list, so a question left blank
//    would otherwise be recorded as "no new symptoms".

import type { Locale } from "@/locales";

export const KNEE_OPTIONS = ["better", "same", "slightly_worse", "much_worse"] as const;
export const SYMPTOM_OPTIONS = ["none", "swelling", "redness", "calf_pain", "other"] as const;
export const OTHER_NOTE_MAX = 280;
export const SCALE_MIN = 0;
export const SCALE_MAX = 10;
/** Every answer a scale accepts, in order. */
export const SCALE_VALUES: readonly number[] = Array.from({ length: SCALE_MAX - SCALE_MIN + 1 }, (_, i) => SCALE_MIN + i);

export type KneeFeels = (typeof KNEE_OPTIONS)[number];
export type Symptom = (typeof SYMPTOM_OPTIONS)[number];
export type ReportedSymptom = Exclude<Symptom, "none">;
export type SubmitError = "notCompleted" | "notAllowed" | "invalid" | "failed";
export type ScaleQuestion = "painBefore" | "painAfter" | "difficulty";
export const SCALE_QUESTIONS: readonly ScaleQuestion[] = ["painBefore", "painAfter", "difficulty"];

export interface CheckInAnswers {
  /** null until the patient picks a value. 0 is an answer. */
  painBefore: number | null;
  painAfter: number | null;
  difficulty: number | null;
  kneeFeels: KneeFeels | null;
  symptoms: readonly Symptom[];
  otherNote: string;
}

/** Nothing chosen: every question starts unanswered. */
export const INITIAL_ANSWERS: Readonly<CheckInAnswers> = {
  painBefore: null,
  painAfter: null,
  difficulty: null,
  kneeFeels: null,
  symptoms: [],
  otherNote: "",
};

/** A whole number on the 0–10 scale. */
export function isScaleAnswer(value: number | null): value is number {
  return value !== null && Number.isInteger(value) && value >= SCALE_MIN && value <= SCALE_MAX;
}

/** Picking "none" clears every symptom; picking a symptom clears "none". */
export function toggleSymptom(current: readonly Symptom[], value: Symptom): Symptom[] {
  if (value === "none") return current.includes("none") ? [] : ["none"];
  const withoutNone = current.filter((s) => s !== "none");
  return withoutNone.includes(value) ? withoutNone.filter((s) => s !== value) : [...withoutNone, value];
}

export interface MissingAnswers {
  painBefore: boolean;
  painAfter: boolean;
  difficulty: boolean;
  kneeFeels: boolean;
  symptoms: boolean;
}

export function missingAnswers(answers: CheckInAnswers): MissingAnswers {
  return {
    painBefore: !isScaleAnswer(answers.painBefore),
    painAfter: !isScaleAnswer(answers.painAfter),
    difficulty: !isScaleAnswer(answers.difficulty),
    kneeFeels: answers.kneeFeels === null,
    symptoms: answers.symptoms.length === 0,
  };
}

/** The first unanswered question in the order the form shows them, or null when everything is answered. */
export function firstMissing(missing: MissingAnswers): keyof MissingAnswers | null {
  const order: (keyof MissingAnswers)[] = [...SCALE_QUESTIONS, "kneeFeels", "symptoms"];
  return order.find((question) => missing[question]) ?? null;
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
 * The submit_session_check_in arguments, or null while any answer is missing. "none" is not sent (an empty list
 * means none), and the note goes only with "other", trimmed, with an empty note sent as null.
 */
export function checkInRpcArgs(sessionId: string, answers: CheckInAnswers, language: Locale): CheckInRpcArgs | null {
  const { painBefore, painAfter, difficulty, kneeFeels, symptoms } = answers;
  if (!isScaleAnswer(painBefore) || !isScaleAnswer(painAfter) || !isScaleAnswer(difficulty)) return null;
  if (kneeFeels === null || symptoms.length === 0) return null;
  const reported = symptoms.filter((s): s is ReportedSymptom => s !== "none");
  const note = reported.includes("other") ? answers.otherNote.trim() : "";
  return {
    p_session: sessionId,
    p_pain_before: painBefore,
    p_pain_after: painAfter,
    p_difficulty: difficulty,
    p_knee_feels: kneeFeels,
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
