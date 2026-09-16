"use client";

// ScorePanel — patient-vocabulary score display only (spec §12.1). Never shows raw internal terms
// (ROM degrees, Signal Confidence as a number) on the primary surface; ROM hides behind "Подробнее".
// Frozen-state aware: when scoring is gated off, shows the specific problem instead of a stale number —
// the same honest-degradation convention SessionTelemetry.tsx already uses for its "simulated" flag.

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { describeSignalQuality, type SignalQualityReport } from "@/lib/ble/signalQuality";
import type { ExerciseConfig, SessionResult } from "@/lib/scoring/types";
import { cn } from "@/lib/utils";

import { Bar, Metric, Panel } from "./ui";

function correctnessCaption(score: number): string {
  if (score >= 90) return "Отлично";
  if (score >= 75) return "Хорошо";
  if (score >= 50) return "Неплохо";
  return "Продолжайте";
}

export default function ScorePanel({
  config,
  result,
  signal,
}: {
  config: ExerciseConfig;
  result: SessionResult;
  signal: SignalQualityReport | null;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const frozenNow = signal ? !signal.scoringPermitted : false;
  const validReps = result.reps.filter((r) => r.validForVolume).length;

  return (
    <Panel label="Результат">
      {frozenNow ? (
        <div className="rounded-lg bg-amber-500/10 px-4 py-3 text-[13px] text-amber-700">
          {(signal ? describeSignalQuality(signal) : ["Оценка приостановлена."]).map((m, i) => (
            <div key={i}>{m}</div>
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Повторы" value={`${validReps}/${result.prescribedReps}`} />
            <div>
              <Metric label="Техника" value={String(result.correctnessScore)} />
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">
                {correctnessCaption(result.correctnessScore)}
              </div>
            </div>
            <div>
              <Metric label="Цель движения" value={`${result.targetScore}%`} />
              <Bar value={result.targetScore / 100} tone="signal" />
            </div>
            <Metric label="Итог тренировки" value={String(result.executionEffectiveness)} />
          </div>

          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            className="mt-4 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-ink-faint transition-colors hover:text-ink"
          >
            Подробнее
            {showDetails ? <ChevronUp className="size-3.5" strokeWidth={2} /> : <ChevronDown className="size-3.5" strokeWidth={2} />}
          </button>

          {showDetails && (
            <div className="mt-3 space-y-1.5 rounded-lg bg-paper-soft px-4 py-3 text-[13px] text-ink-soft">
              <div>
                Сгибание колена (приблизительно): {result.romMeanDeg ?? "—"}°
                {config.targetValueDeg !== null ? ` / цель ${config.targetValueDeg}°` : " / цель не настроена"}
              </div>
              <div className={cn("font-mono text-[11px] uppercase tracking-[0.08em] text-ink-faint")}>
                Значение приблизительное, до калибровки датчиков в физических единицах
              </div>
              <div>Цель достигнута в {result.targetReachedCount} из {validReps} повторениях</div>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
