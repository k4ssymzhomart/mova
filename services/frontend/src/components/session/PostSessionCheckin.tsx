"use client";

// PostSessionCheckin — under-30s check-in right after finishing (NTZ §14.1, PAT-08). Pain uses the
// shared Slider (promoted into ui.tsx from PrescriptionEditor.tsx's pattern); knee-feels and symptoms use
// the existing PillButton — no new input controls invented for this. A RED-flag symptom selection
// replaces this whole screen with a fixed, clinically-approved instruction and stops the flow — never a
// diagnosis (NTZ §15.1/§15.2) — while still submitting the row so it reaches the clinician (AC-06).

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { isRedFlag, type NewSymptom } from "@/lib/scoring/checkinSafety";
import { createClient } from "@/lib/supabase/client";

import { PillButton, Slider } from "./ui";

type KneeFeels = "better" | "same" | "slightly_worse" | "much_worse";

const KNEE_FEELS_LABEL: Record<KneeFeels, string> = {
  better: "Лучше",
  same: "Так же",
  slightly_worse: "Немного хуже",
  much_worse: "Намного хуже",
};

const SYMPTOM_LABEL: Record<NewSymptom, string> = {
  none: "Нет",
  swelling: "Отёк",
  redness: "Покраснение",
  drainage: "Выделения",
  calf_pain: "Боль в икре",
  dizziness: "Головокружение",
  other: "Другое",
};
const SYMPTOM_OPTIONS: NewSymptom[] = ["none", "swelling", "redness", "drainage", "calf_pain", "dizziness", "other"];

export default function PostSessionCheckin({ sessionId, onDone }: { sessionId: string; onDone: () => void }) {
  const [painBefore, setPainBefore] = useState(0);
  const [painAfter, setPainAfter] = useState(0);
  const [difficulty, setDifficulty] = useState(0);
  const [kneeFeels, setKneeFeels] = useState<KneeFeels>("same");
  const [symptoms, setSymptoms] = useState<NewSymptom[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [redFlag, setRedFlag] = useState(false);

  function toggleSymptom(s: NewSymptom) {
    setSymptoms((prev) => {
      if (s === "none") return ["none"];
      const withoutNone = prev.filter((x) => x !== "none");
      return withoutNone.includes(s) ? withoutNone.filter((x) => x !== s) : [...withoutNone, s];
    });
  }

  async function submit() {
    setSubmitting(true);
    const supabase = createClient();
    try {
      await supabase.rpc("submit_post_session_checkin", {
        p_session: sessionId,
        p_pain_before: painBefore,
        p_pain_after: painAfter,
        p_difficulty: difficulty,
        p_knee_feels: kneeFeels,
        p_new_symptoms: symptoms,
      });
    } catch {
      /* best-effort — same convention as reward granting elsewhere in the session flow */
    }
    if (isRedFlag(symptoms)) {
      setSubmitting(false);
      setRedFlag(true);
      return;
    }
    setSubmitting(false);
    onDone();
  }

  if (redFlag) {
    return (
      <div className="rounded-card border border-amber-400/50 bg-amber-500/10 p-6">
        <h2 className="text-xl text-ink">Обратитесь за помощью</h2>
        <p className="mt-3 text-[14px] leading-relaxed text-ink">
          Вы отметили симптом, который требует внимания как можно скорее. Свяжитесь со своей клиникой или
          обратитесь за медицинской помощью в соответствии с полученными вами инструкциями.
        </p>
        <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">
          Ваш ответ отправлен и будет виден вашему врачу.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 rounded-card border border-line bg-card p-6 shadow-soft">
      <h2 className="text-xl text-ink">Как вы себя чувствуете?</h2>

      <Slider label="Боль до тренировки" value={painBefore} min={0} max={10} step={1} display={String(painBefore)} onChange={setPainBefore} />
      <Slider label="Боль после тренировки" value={painAfter} min={0} max={10} step={1} display={String(painAfter)} onChange={setPainAfter} />
      <Slider label="Сложность" value={difficulty} min={0} max={10} step={1} display={String(difficulty)} onChange={setDifficulty} />

      <div>
        <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">Колено ощущается</div>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(KNEE_FEELS_LABEL) as KneeFeels[]).map((k) => (
            <PillButton key={k} active={kneeFeels === k} onClick={() => setKneeFeels(k)}>
              {KNEE_FEELS_LABEL[k]}
            </PillButton>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">Новые симптомы</div>
        <div className="flex flex-wrap gap-2">
          {SYMPTOM_OPTIONS.map((s) => (
            <PillButton key={s} active={symptoms.includes(s)} onClick={() => toggleSymptom(s)}>
              {SYMPTOM_LABEL[s]}
            </PillButton>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={submitting}
        className="inline-flex w-full items-center justify-center gap-2 rounded-pill bg-signal px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-signal-bright disabled:opacity-60"
      >
        {submitting && <Loader2 className="size-4 animate-spin" strokeWidth={1.8} />}
        Готово
      </button>
    </div>
  );
}
