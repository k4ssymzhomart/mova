"use client";

// The check-in form, ported from Phoenix's Questionnaire (apps/patient-app/src/components/Questionnaire.tsx): pain
// before and after and difficulty on 0–10 scales, how the knee feels (one choice, required), and new symptoms with
// an exclusive "none" plus a short note for "other". The answer rules live in ./answers.
//
// The scales are rows of eleven radio buttons with nothing selected, not sliders. A slider always holds a value, so
// an untouched one would be sent as an answer the patient never gave; and a native range input fires no change when
// the patient clicks the value it already shows, so a deliberate 0 could not be told apart from no answer. Every
// question must be answered before anything is sent.
//
// Answers go to submit_session_check_in in the language the form is shown in. The RPC validates every field again
// and is idempotent on the session, so sending again after a dropped response returns the row already stored. On
// an error the answers stay on screen with the reason and can be sent again. No safety triage happens here.

import { ArrowRight, CircleAlert, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useId, useRef, useState } from "react";

import { card, focusRing, primaryButton } from "@/components/app/recipes";
import { stepHref } from "@/components/flow/steps";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/locales/client";

import {
  checkInRpcArgs,
  firstMissing,
  INITIAL_ANSWERS,
  KNEE_OPTIONS,
  type KneeFeels,
  type MissingAnswers,
  missingAnswers,
  OTHER_NOTE_MAX,
  SCALE_MAX,
  SCALE_MIN,
  SCALE_VALUES,
  type SubmitError,
  submitErrorFor,
  SYMPTOM_OPTIONS,
  type Symptom,
  toggleSymptom,
} from "./answers";

const choiceInput = cn("size-6 shrink-0 cursor-pointer accent-signal-deep", focusRing);

const NOTHING_MISSING: MissingAnswers = {
  painBefore: false,
  painAfter: false,
  difficulty: false,
  kneeFeels: false,
  symptoms: false,
};

type Question = keyof MissingAnswers;

export default function CheckInForm({ sessionId }: { sessionId: string }) {
  const { t, locale } = useTranslation();
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [painBefore, setPainBefore] = useState<number | null>(INITIAL_ANSWERS.painBefore);
  const [painAfter, setPainAfter] = useState<number | null>(INITIAL_ANSWERS.painAfter);
  const [difficulty, setDifficulty] = useState<number | null>(INITIAL_ANSWERS.difficulty);
  const [kneeFeels, setKneeFeels] = useState<KneeFeels | null>(INITIAL_ANSWERS.kneeFeels);
  const [symptoms, setSymptoms] = useState<Symptom[]>([...INITIAL_ANSWERS.symptoms]);
  const [otherNote, setOtherNote] = useState(INITIAL_ANSWERS.otherNote);

  // Which questions show their "answer this" line. Set on a submit attempt, cleared per question once answered.
  const [shownMissing, setShownMissing] = useState<MissingAnswers>(NOTHING_MISSING);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  // State lands after the click that set it; the ref is what stops a quick second click from sending again.
  const sending = useRef(false);

  const kneeName = useId();
  const kneeErrorId = useId();
  const symptomsErrorId = useId();
  const noteId = useId();
  const noteHintId = useId();
  // The first input of each question, so a submit with gaps can move focus to the first unanswered one.
  const firstInputs = useRef<Partial<Record<Question, HTMLInputElement | null>>>({});
  const firstInputRef = (question: Question) => (element: HTMLInputElement | null) => {
    firstInputs.current[question] = element;
  };

  function answered(question: Question) {
    setShownMissing((current) => (current[question] ? { ...current, [question]: false } : current));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;

    const answers = { painBefore, painAfter, difficulty, kneeFeels, symptoms, otherNote };
    const missing = missingAnswers(answers);
    setShownMissing(missing);
    const args = checkInRpcArgs(sessionId, answers, locale);
    if (!args) {
      // Focus lands in the first unanswered question, whose inputs are described by its error.
      const first = firstMissing(missing);
      if (first) firstInputs.current[first]?.focus();
      return;
    }

    sending.current = true;
    setBusy(true);
    setSubmitError(null);
    try {
      const { error } = await supabase.rpc("submit_session_check_in", args);
      if (error) {
        fail(submitErrorFor(error.code));
        return;
      }
    } catch {
      fail("failed");
      return;
    }
    // busy stays on while the summary loads, so the answers cannot be sent a second time on the way out.
    router.push(stepHref(sessionId, "summary"));
  }

  function fail(reason: SubmitError) {
    sending.current = false;
    setBusy(false);
    setSubmitError(reason);
  }

  const required = t("flow.checkIn.required");

  return (
    <form onSubmit={submit} noValidate className={cn(card, "max-w-3xl space-y-10 p-5 sm:p-8")}>
      <ScaleQuestion
        label={t("flow.checkIn.painBefore")}
        required={required}
        value={painBefore}
        onChange={(value) => {
          setPainBefore(value);
          answered("painBefore");
        }}
        minLabel={t("flow.checkIn.painMin")}
        maxLabel={t("flow.checkIn.painMax")}
        missing={shownMissing.painBefore}
        missingText={t("flow.checkIn.scaleRequired")}
        firstInputRef={firstInputRef("painBefore")}
      />
      <ScaleQuestion
        label={t("flow.checkIn.painAfter")}
        required={required}
        value={painAfter}
        onChange={(value) => {
          setPainAfter(value);
          answered("painAfter");
        }}
        minLabel={t("flow.checkIn.painMin")}
        maxLabel={t("flow.checkIn.painMax")}
        missing={shownMissing.painAfter}
        missingText={t("flow.checkIn.scaleRequired")}
        firstInputRef={firstInputRef("painAfter")}
      />
      <ScaleQuestion
        label={t("flow.checkIn.difficulty")}
        required={required}
        value={difficulty}
        onChange={(value) => {
          setDifficulty(value);
          answered("difficulty");
        }}
        minLabel={t("flow.checkIn.diffMin")}
        maxLabel={t("flow.checkIn.diffMax")}
        missing={shownMissing.difficulty}
        missingText={t("flow.checkIn.scaleRequired")}
        firstInputRef={firstInputRef("difficulty")}
      />

      <fieldset>
        <Legend required={required}>{t("flow.checkIn.knee")}</Legend>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {KNEE_OPTIONS.map((value, i) => (
            <Choice key={value} checked={kneeFeels === value}>
              <input
                ref={i === 0 ? firstInputRef("kneeFeels") : undefined}
                type="radio"
                name={kneeName}
                value={value}
                required
                checked={kneeFeels === value}
                onChange={() => {
                  setKneeFeels(value);
                  answered("kneeFeels");
                }}
                aria-describedby={shownMissing.kneeFeels ? kneeErrorId : undefined}
                className={choiceInput}
              />
              <span>{t(`flow.checkIn.kneeOpt.${value}`)}</span>
            </Choice>
          ))}
        </div>
        {shownMissing.kneeFeels && <Problem id={kneeErrorId}>{t("flow.checkIn.kneeRequired")}</Problem>}
      </fieldset>

      <fieldset>
        <Legend required={required}>{t("flow.checkIn.symptoms")}</Legend>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {SYMPTOM_OPTIONS.map((value, i) => (
            <Choice key={value} checked={symptoms.includes(value)}>
              <input
                ref={i === 0 ? firstInputRef("symptoms") : undefined}
                type="checkbox"
                value={value}
                checked={symptoms.includes(value)}
                onChange={() => {
                  setSymptoms((current) => toggleSymptom(current, value));
                  answered("symptoms");
                }}
                aria-describedby={shownMissing.symptoms ? symptomsErrorId : undefined}
                className={choiceInput}
              />
              <span>{t(`flow.checkIn.symptomOpt.${value}`)}</span>
            </Choice>
          ))}
        </div>
        {shownMissing.symptoms && <Problem id={symptomsErrorId}>{t("flow.checkIn.symptomsRequired")}</Problem>}

        {symptoms.includes("other") && (
          <div className="mt-5">
            <label htmlFor={noteId} className="block text-base font-medium text-ink">
              {t("flow.checkIn.otherLabel")}
            </label>
            <textarea
              id={noteId}
              value={otherNote}
              onChange={(e) => setOtherNote(e.target.value)}
              maxLength={OTHER_NOTE_MAX}
              rows={3}
              aria-describedby={noteHintId}
              className={cn(
                "mt-2 block min-h-24 w-full resize-y rounded-lg border border-ink-faint bg-card px-4 py-3 text-base leading-relaxed text-ink",
                focusRing,
              )}
            />
            <p className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm text-ink-soft">
              <span id={noteHintId}>{t("flow.checkIn.otherLimit", { max: OTHER_NOTE_MAX })}</span>
              <span className="tnum" aria-hidden="true">
                {t("flow.checkIn.otherCount", { n: otherNote.length, max: OTHER_NOTE_MAX })}
              </span>
            </p>
          </div>
        )}
      </fieldset>

      <div className="flex flex-col gap-4 border-t border-line pt-6 sm:flex-row sm:items-center sm:gap-5">
        <button type="submit" disabled={busy} className={primaryButton}>
          {busy && (
            <Loader2 className="size-5 animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden="true" />
          )}
          {busy ? t("flow.checkIn.submitting") : t("flow.checkIn.submit")}
          {!busy && <ArrowRight className="size-5" strokeWidth={2} aria-hidden="true" />}
        </button>
        {submitError && (
          <Problem role="alert" className="mt-0">
            {t(`flow.checkIn.error.${submitError}`)}
          </Problem>
        )}
      </div>
    </form>
  );
}

/**
 * A 0–10 answer as eleven radio buttons in one group, none selected until the patient picks one. Each option is a
 * 48px target showing its number next to the native radio, so the choice never shows by colour alone; the ends of
 * the scale are described in words. Two rows of six and five on a phone, one row from sm up.
 */
function ScaleQuestion({
  label,
  required,
  value,
  onChange,
  minLabel,
  maxLabel,
  missing,
  missingText,
  firstInputRef,
}: {
  label: string;
  required: string;
  value: number | null;
  onChange: (value: number) => void;
  minLabel: string;
  maxLabel: string;
  missing: boolean;
  missingText: string;
  firstInputRef: (element: HTMLInputElement | null) => void;
}) {
  const name = useId();
  const endsId = useId();
  const errorId = useId();
  const describedBy = missing ? `${endsId} ${errorId}` : endsId;

  return (
    <fieldset>
      <Legend required={required}>{label}</Legend>
      <div className="mt-3 grid grid-cols-6 gap-1.5 sm:grid-cols-11 sm:gap-2">
        {SCALE_VALUES.map((option, i) => {
          const checked = value === option;
          return (
            <label
              key={option}
              className={cn(
                "flex min-h-12 min-w-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-card border bg-card px-1 py-2 text-lg font-semibold text-ink transition-colors",
                checked ? "border-signal-deep bg-signal/5 ring-1 ring-inset ring-signal-deep" : "border-line hover:border-ink-faint",
              )}
            >
              <input
                ref={i === 0 ? firstInputRef : undefined}
                type="radio"
                name={name}
                value={option}
                required
                checked={checked}
                onChange={() => onChange(option)}
                aria-describedby={describedBy}
                className={cn("size-5 shrink-0 cursor-pointer accent-signal-deep", focusRing)}
              />
              <span className="tnum leading-none">{option}</span>
            </label>
          );
        })}
      </div>
      <p id={endsId} className="mt-2 flex justify-between gap-4 text-base text-ink-soft">
        <span>
          <span className="tnum font-semibold text-ink">{SCALE_MIN}</span> — {minLabel}
        </span>
        <span className="text-right">
          <span className="tnum font-semibold text-ink">{SCALE_MAX}</span> — {maxLabel}
        </span>
      </p>
      {missing && <Problem id={errorId}>{missingText}</Problem>}
    </fieldset>
  );
}

function Legend({ children, required }: { children: ReactNode; required: string }) {
  return (
    <legend className="text-lg font-semibold leading-snug text-ink">
      {children} <span className="text-base font-normal text-ink-soft">({required})</span>
    </legend>
  );
}

/** One answer row: the whole row is the target, and the checked state shows in the native control, not colour alone. */
function Choice({ checked, children }: { checked: boolean; children: ReactNode }) {
  return (
    <label
      className={cn(
        "flex min-h-14 cursor-pointer items-center gap-3 rounded-card border bg-card px-4 py-3 text-base font-medium text-ink transition-colors",
        checked ? "border-signal-deep bg-signal/5 ring-1 ring-inset ring-signal-deep" : "border-line hover:border-ink-faint",
      )}
    >
      {children}
    </label>
  );
}

/** A problem line: icon plus words, so colour is never the only signal. Text stays ink for contrast. */
function Problem({
  id,
  role,
  className,
  children,
}: {
  id?: string;
  role?: "alert";
  className?: string;
  children: ReactNode;
}) {
  return (
    <p id={id} role={role} className={cn("mt-3 flex items-start gap-2 text-base font-medium text-ink", className)}>
      <CircleAlert className="mt-0.5 size-5 shrink-0 text-red-700" strokeWidth={2} aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
