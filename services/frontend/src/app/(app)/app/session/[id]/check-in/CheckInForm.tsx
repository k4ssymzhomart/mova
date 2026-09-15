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
// and is idempotent on the session: when the session already has a check-in it returns that row, unchanged and
// without an error. So a resend after a dropped response simply returns what was saved, and a check-in is never
// edited. Two guards keep that from passing silently:
//  - Back from the summary restores this page from the router cache without the server's redirect for an answered
//    check-in, and the form mounts empty. A fresh read on mount sends the patient on to the summary instead.
//  - If a submit still comes back with a stored row whose answers differ from the ones sent, the form is replaced by
//    a notice that the earlier answers were kept, listing them, with the way on to the summary.
// On an error the answers stay on screen with the reason and can be sent again. No safety triage happens here.

import { ArrowRight, CircleAlert, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, type RefObject, useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";

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
  parseStoredCheckIn,
  SCALE_MAX,
  SCALE_MIN,
  SCALE_VALUES,
  type StoredCheckIn,
  storedMatchesSent,
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
  const summaryHref = stepHref(sessionId, "summary");

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
  // The check-in stored earlier, when a submit found one with other answers. Replaces the form.
  const [kept, setKept] = useState<StoredCheckIn | null>(null);
  // State lands after the click that set it; the ref is what stops a quick second click from sending again.
  const sending = useRef(false);
  const keptContinue = useRef<HTMLButtonElement>(null);

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

  // A fresh read on every mount, Back included (see the header). A failed read changes nothing: the RPC still keeps
  // a stored check-in, and submit() says so.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data, error } = await supabase
          .from("session_check_ins")
          .select("id")
          .eq("session_id", sessionId)
          .maybeSingle();
        if (active && !error && data) router.replace(summaryHref);
      } catch {
        // Offline or blocked: stay on the form.
      }
    })();
    return () => {
      active = false;
    };
  }, [supabase, router, sessionId, summaryHref]);

  // The notice replaces the focused submit button; focus moves to its way on instead of falling to the page.
  useEffect(() => {
    if (kept) keptContinue.current?.focus();
  }, [kept]);

  function answered(question: Question) {
    setShownMissing((current) => (current[question] ? { ...current, [question]: false } : current));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;

    const answers = { painBefore, painAfter, difficulty, kneeFeels, symptoms, otherNote };
    const missing = missingAnswers(answers);
    const args = checkInRpcArgs(sessionId, answers, locale);
    if (!args) {
      // The error lines and the inputs' aria-describedby are committed before focus moves, so the unanswered
      // question's input is already described by its error when a screen reader announces it. Without flushSync,
      // React would apply the update only after this handler returns, after the focus.
      flushSync(() => setShownMissing(missing));
      const first = firstMissing(missing);
      if (first) firstInputs.current[first]?.focus();
      return;
    }
    setShownMissing(missing);

    sending.current = true;
    setBusy(true);
    setSubmitError(null);
    let stored: StoredCheckIn | null;
    try {
      const { data, error } = await supabase.rpc("submit_session_check_in", args);
      if (error) {
        fail(submitErrorFor(error.code));
        return;
      }
      stored = parseStoredCheckIn(data);
    } catch {
      fail("failed");
      return;
    }
    if (stored && !storedMatchesSent(args, stored)) {
      // An earlier check-in was kept. sending stays set: the form is gone and nothing is sent again.
      setBusy(false);
      setKept(stored);
      return;
    }
    // busy stays on while the summary loads, so the answers cannot be sent a second time on the way out.
    router.push(summaryHref);
  }

  function fail(reason: SubmitError) {
    sending.current = false;
    setBusy(false);
    setSubmitError(reason);
  }

  if (kept) {
    return <KeptAnswers stored={kept} continueRef={keptContinue} onContinue={() => router.replace(summaryHref)} />;
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
 * A 0–10 answer as eleven radio buttons in one group, none selected until the patient picks one. Each option shows
 * its number next to the native radio, so the choice never shows by colour alone; the ends of the scale are described
 * in words.
 *
 * Every option is at least 48 × 48 px. The columns follow the width the question actually has (a container query),
 * so the sidebar, the paddings and a desktop scrollbar are all accounted for: four columns in three rows below 328 px,
 * six in two rows from 328 px (6 × 48 + 5 × 8 gap), and one row of eleven from 588 px (11 × 48 + 10 × 6 gap). The
 * ranges do not overlap, so no rule depends on the order Tailwind emits them in. Worked widths (px of viewport,
 * question width, option width): 320 → 238 → 53.5; 360 → 278 → 63.5; 390 → 308 → 71; 412 → 330 → 48.3;
 * 768 → 638 → 52.5; 1024 with the 260 px sidebar → 602 → 49.3; 1280 → 702 → 58.4.
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
      <div className="mt-3 [container-type:inline-size]">
        <div className="grid grid-cols-4 gap-2 [@container(min-width:328px)_and_(max-width:587.98px)]:grid-cols-6 [@container(min-width:588px)]:grid-cols-11 [@container(min-width:588px)]:gap-1.5">
          {SCALE_VALUES.map((option, i) => {
            const checked = value === option;
            return (
              <label
                key={option}
                className={cn(
                  "flex min-h-12 min-w-12 cursor-pointer flex-col items-center justify-center gap-1 rounded-card border bg-card px-1 py-2 text-lg font-semibold text-ink transition-colors",
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

/** What is saved when a submit found an earlier check-in with other answers, and the way on. */
function KeptAnswers({
  stored,
  continueRef,
  onContinue,
}: {
  stored: StoredCheckIn;
  continueRef: RefObject<HTMLButtonElement>;
  onContinue: () => void;
}) {
  const { t } = useTranslation();
  const scale = (n: number) => t("flow.checkIn.kept.scale", { n });
  const symptoms = stored.symptoms.length
    ? stored.symptoms.map((symptom) => t(`flow.checkIn.symptomOpt.${symptom}`)).join(", ")
    : t("flow.checkIn.symptomOpt.none");

  return (
    <div className={cn(card, "max-w-3xl space-y-6 p-5 sm:p-8")}>
      <div role="alert" className="space-y-2">
        <p className="flex items-start gap-2 text-lg font-semibold leading-snug text-ink">
          <CircleAlert className="mt-1 size-5 shrink-0 text-red-700" strokeWidth={2} aria-hidden="true" />
          <span>{t("flow.checkIn.kept.title")}</span>
        </p>
        <p className="text-base leading-relaxed text-ink">{t("flow.checkIn.kept.body")}</p>
      </div>
      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        <KeptFact label={t("flow.checkIn.painBefore")} value={scale(stored.painBefore)} />
        <KeptFact label={t("flow.checkIn.painAfter")} value={scale(stored.painAfter)} />
        <KeptFact label={t("flow.checkIn.difficulty")} value={scale(stored.difficulty)} />
        <KeptFact label={t("flow.checkIn.knee")} value={t(`flow.checkIn.kneeOpt.${stored.kneeFeels}`)} />
        <KeptFact label={t("flow.checkIn.symptoms")} value={symptoms} />
        {stored.otherNote && (
          <KeptFact
            label={t("flow.checkIn.kept.note")}
            value={<span className="whitespace-pre-line [overflow-wrap:anywhere]">{stored.otherNote}</span>}
          />
        )}
      </dl>
      <div className="border-t border-line pt-6">
        <button ref={continueRef} type="button" onClick={onContinue} className={primaryButton}>
          {t("flow.checkIn.kept.continue")}
          <ArrowRight className="size-5" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function KeptFact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-base text-ink-soft">{label}</dt>
      <dd className="tnum mt-0.5 text-lg font-semibold text-ink">{value}</dd>
    </div>
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
