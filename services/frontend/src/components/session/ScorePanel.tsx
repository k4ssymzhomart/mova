"use client";

// ScorePanel — patient-vocabulary score display only (spec §12.1). Never shows raw internal terms
// (ROM degrees, Signal Confidence as a number) on the primary surface; ROM hides behind "Подробнее".
// Frozen-state aware: when scoring is gated off, shows the specific problem instead of a stale number —
// the same honest-degradation convention SessionTelemetry.tsx already uses for its "simulated" flag.
//
// The job this file gained with the abstention patch: a part of the score that was never measured has to
// LOOK different from a part that was measured and scored badly. A component with nothing behind it
// renders as "не измерено" on a dashed card, never as a number; and a score that WAS computed but from
// only some of its declared components never appears as a bare integer — the components that were left
// out are named directly under it, without the patient having to expand anything. The wording follows
// the disclosure PHOENIX's own tool already prints beside each dropped component,
// services/imu-tools/tools/check_execution_score.py:70 ("not scored -- left out, weight redistributed").
//
// What this panel deliberately does NOT do: it does not rank, grade or colour an abstention. An
// unmeasured component is shown in the neutral ink-faint/dashed treatment rather than in the emerald
// `signal` accent or in a warning colour, because it is neither good news nor bad news — it is an
// absence of news, and dressing it as either would be the same dishonesty in a different font.

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { describeSignalQuality, type SignalQualityReport } from "@/lib/ble/signalQuality";
import type { ExecutionComponentName, ExerciseConfig, SessionResult } from "@/lib/scoring/types";
import { useTranslation } from "@/locales/client";
import { cn } from "@/lib/utils";

import { Bar, Panel } from "./ui";

/** Shown where a number would go when there is no number. Typography, not copy — it is the same glyph
 *  in every locale, so it does not go through t(). */
const NO_VALUE = "—";

function correctnessCaptionKey(score: number): string {
  if (score >= 90) return "session.score.caption.excellent";
  if (score >= 75) return "session.score.caption.good";
  if (score >= 50) return "session.score.caption.fair";
  return "session.score.caption.keepGoing";
}

/** One metric tile. Mirrors ui.tsx's Metric, with two additions it does not have: a value may be
 *  absent, and the tile then carries a dashed border so an unmeasured component is distinguishable at a
 *  glance from one that scored zero. */
function ScoreTile({
  label,
  value,
  caption,
  children,
}: {
  label: string;
  value: string | null;
  caption?: string | null;
  children?: React.ReactNode;
}) {
  const unmeasured = value === null;
  return (
    <div
      className={cn(
        "rounded-card border bg-card p-4",
        unmeasured ? "border-dashed border-line" : "border-line",
      )}
    >
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-ink-faint">{label}</div>
      <div
        className={cn(
          "mt-2 font-mono leading-none tabular-nums",
          unmeasured ? "text-lg text-ink-faint" : "text-3xl text-ink",
        )}
      >
        {value ?? NO_VALUE}
      </div>
      {caption && (
        <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">{caption}</div>
      )}
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
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
  const { t } = useTranslation();
  const [showDetails, setShowDetails] = useState(false);
  const frozenNow = signal ? !signal.scoringPermitted : false;
  const validReps = result.reps.filter((r) => r.validForVolume).length;

  const correctness = result.correctnessScore;
  const target = result.targetScore;
  const execution = result.execution;

  /** Correctness component keys are config keys (smoothness, controlledReturn, …). A key with no
   *  translation falls back to the raw key rather than to an invented label, so a config typo stays
   *  visible instead of being smoothed over. */
  const componentName = (key: string): string => {
    const path = `session.score.component.${key}`;
    const label = t(path);
    return label === path ? key : label;
  };

  const partName = (name: ExecutionComponentName): string =>
    name === "correctness"
      ? t("session.score.correctness")
      : name === "volume"
        ? t("session.score.volume")
        : t("session.score.target");

  const listComponents = (keys: string[]): string => keys.map(componentName).join(", ");
  const listParts = (names: ExecutionComponentName[]): string => names.map(partName).join(", ");

  const weightsUsed = (Object.entries(execution.componentsUsed) as Array<[ExecutionComponentName, number]>)
    .map(([name, weight]) =>
      t("session.score.weightPart", { name: partName(name), percent: Math.round(weight * 100) }),
    )
    .join(", ");

  // Every disclosure the patient must see WITHOUT opening "Подробнее". An empty list means the score in
  // front of them was computed from everything the exercise declared.
  const notices: string[] = [];
  if (execution.score === null) {
    notices.push(t("session.score.executionNotMeasured"));
  } else if (execution.abstained.length > 0) {
    notices.push(t("session.score.executionAbstained", { parts: listParts(execution.abstained) }));
    notices.push(t("session.score.weightsUsed", { parts: weightsUsed }));
  }
  if (correctness.score !== null && correctness.abstained.length > 0) {
    notices.push(t("session.score.correctnessAbstained", { components: listComponents(correctness.abstained) }));
  }

  return (
    <Panel label={t("session.score.title")}>
      {frozenNow ? (
        <div className="rounded-lg bg-amber-500/10 px-4 py-3 text-[13px] text-amber-700">
          {(signal ? describeSignalQuality(signal) : [t("session.score.frozenFallback")]).map((m, i) => (
            <div key={i}>{m}</div>
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ScoreTile label={t("session.score.reps")} value={`${validReps}/${result.prescribedReps}`} />
            <ScoreTile
              label={t("session.score.correctness")}
              value={correctness.score === null ? null : String(correctness.score)}
              caption={
                correctness.score === null
                  ? t("session.score.notMeasured")
                  : t(correctnessCaptionKey(correctness.score))
              }
            />
            <ScoreTile
              label={t("session.score.target")}
              value={target.score === null ? null : `${target.score}%`}
              caption={target.score === null ? t("session.score.notMeasured") : null}
            >
              {target.score !== null && <Bar value={target.score / 100} tone="signal" />}
            </ScoreTile>
            <ScoreTile
              label={t("session.score.execution")}
              value={execution.score === null ? null : String(execution.score)}
              caption={execution.score === null ? t("session.score.notMeasured") : null}
            />
          </div>

          {notices.length > 0 && (
            <div className="mt-3 rounded-card border border-dashed border-line bg-paper-soft px-4 py-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">
                {t("session.score.notMeasuredTitle")}
              </div>
              <ul className="mt-1.5 space-y-1 text-[13px] text-ink-soft">
                {notices.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            className="mt-4 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-ink-faint transition-colors hover:text-ink"
          >
            {t("session.score.details")}
            {showDetails ? <ChevronUp className="size-3.5" strokeWidth={2} /> : <ChevronDown className="size-3.5" strokeWidth={2} />}
          </button>

          {showDetails && (
            <div className="mt-3 space-y-1.5 rounded-lg bg-paper-soft px-4 py-3 text-[13px] text-ink-soft">
              <div>
                {config.targetValueDeg !== null
                  ? t("session.score.romWithTarget", {
                      value: result.romMeanDeg ?? NO_VALUE,
                      target: config.targetValueDeg,
                    })
                  : t("session.score.romNoTarget", { value: result.romMeanDeg ?? NO_VALUE })}
              </div>
              <div className={cn("font-mono text-[11px] uppercase tracking-[0.08em] text-ink-faint")}>
                {t("session.score.romCaveat")}
              </div>
              <div>{t("session.score.targetReached", { reached: result.targetReachedCount, valid: validReps })}</div>
              {correctness.measured.length > 0 && (
                <div>{t("session.score.measuredList", { components: listComponents(correctness.measured) })}</div>
              )}
              {correctness.abstained.length > 0 && (
                <div>{t("session.score.abstainedList", { components: listComponents(correctness.abstained) })}</div>
              )}
              <div>
                {t("session.score.volumeLine", {
                  value: result.volumeScore === null ? t("session.score.notMeasured") : String(result.volumeScore),
                })}
              </div>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
