"use client";

// SetsRestPanel — sets/reps/rest structure + pause with a persisted reason (NTZ PAT-06 requires a stop
// reason; Gen-3 ExerciseLive collected these into chips and then discarded them — this is the fix:
// ExerciseStudio actually keeps whatever reason is picked here and sends it up in the session summary).
// Presentational: ExerciseStudio owns the set/rest/pause state machine and passes it down.

import { Pause, Play } from "lucide-react";

import { Bar, Panel, PillButton } from "./ui";

export const PAUSE_REASONS = ["Боль", "Усталость", "Неудобно", "Проблема с датчиком", "Другое"] as const;
export type PauseReason = (typeof PAUSE_REASONS)[number];

export type SetPhase = "training" | "resting";

export default function SetsRestPanel({
  currentSet,
  totalSets,
  repsThisSet,
  prescribedRepsPerSet,
  phase,
  restRemainingSec,
  paused,
  pauseReason,
  onPauseToggle,
  onPauseReason,
}: {
  currentSet: number;
  totalSets: number;
  repsThisSet: number;
  prescribedRepsPerSet: number;
  phase: SetPhase;
  restRemainingSec: number;
  paused: boolean;
  pauseReason: PauseReason | null;
  onPauseToggle: () => void;
  onPauseReason: (reason: PauseReason) => void;
}) {
  return (
    <Panel
      label={`Подход ${currentSet} из ${totalSets}`}
      right={
        <button
          type="button"
          onClick={onPauseToggle}
          aria-label={paused ? "Продолжить" : "Пауза"}
          className="grid size-8 place-items-center rounded-full text-ink-faint transition-colors hover:bg-paper-soft hover:text-ink"
        >
          {paused ? <Play className="size-4" strokeWidth={1.9} /> : <Pause className="size-4" strokeWidth={1.9} />}
        </button>
      }
    >
      {paused ? (
        <div>
          <p className="text-sm text-ink-soft">Почему вы приостановили тренировку?</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {PAUSE_REASONS.map((reason) => (
              <PillButton key={reason} active={pauseReason === reason} onClick={() => onPauseReason(reason)}>
                {reason}
              </PillButton>
            ))}
          </div>
        </div>
      ) : phase === "resting" ? (
        <div className="text-center">
          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-faint">Отдых</div>
          <div className="tnum mt-1 text-4xl text-ink">{restRemainingSec}с</div>
        </div>
      ) : (
        <div>
          <div className="flex items-baseline justify-between font-mono text-[11px] uppercase tracking-[0.16em] text-ink-faint">
            <span>Повторы в подходе</span>
            <span className="tnum text-ink">{repsThisSet}/{prescribedRepsPerSet}</span>
          </div>
          <div className="mt-2">
            <Bar value={prescribedRepsPerSet > 0 ? repsThisSet / prescribedRepsPerSet : 0} tone="signal" />
          </div>
        </div>
      )}
    </Panel>
  );
}
