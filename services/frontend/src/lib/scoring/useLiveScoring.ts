"use client";

// The React seam wiring the rep detector, cue selector, and session formulas together for the exercise
// screen. Feed it one joint-angle sample (from jointAngle.ts) plus the current SignalQualityReport per
// tick; it owns the RepDetector instance, accumulates RepResults, and recomputes the live SessionResult
// and active LiveCue.

import { useCallback, useRef, useState } from "react";

import type { SignalQualityReport } from "@/lib/ble/signalQuality";
import { sessionCorrectnessScore } from "./correctnessScore";
import { selectCue } from "./cuePriority";
import { executionEffectiveness } from "./executionScore";
import { RepDetector } from "./repDetector";
import { sessionTargetScore, targetReachedCount } from "./targetScore";
import type { ExerciseConfig, LiveCue, RepResult, SessionResult } from "./types";
import { volumeScore } from "./volumeScore";

export interface UseLiveScoringResult {
  reps: RepResult[];
  liveCue: LiveCue | null;
  scoringFrozen: boolean;
  frozenReasons: string[];
  result: SessionResult;
  /** Feed one live sample. angleDeg is null when a required sensor's frame/baseline isn't available yet
   *  (computeJointAngle returned null) — the tick still updates cue/freeze state from `signal` alone. */
  pushSample: (nowMs: number, angleDeg: number | null, signal: SignalQualityReport) => void;
  reset: () => void;
}

function buildResult(config: ExerciseConfig, reps: RepResult[], prescribedReps: number, everFrozen: boolean, frozenReasons: string[]): SessionResult {
  const vol = volumeScore(reps, prescribedReps);
  const tgt = sessionTargetScore(config, reps);
  const cor = sessionCorrectnessScore(config, reps);
  const peaks = reps.filter((r) => r.validForVolume).map((r) => r.peakExcursionDeg);
  return {
    exerciseSlug: config.slug,
    reps,
    prescribedReps,
    volumeScore: vol,
    targetScore: tgt,
    correctnessScore: cor,
    executionEffectiveness: executionEffectiveness(cor, vol, tgt),
    romMaxDeg: peaks.length ? Math.max(...peaks) : null,
    romMeanDeg: peaks.length ? Math.round((peaks.reduce((a, b) => a + b, 0) / peaks.length) * 10) / 10 : null,
    targetReachedCount: targetReachedCount(config, reps),
    frozen: everFrozen,
    frozenReasons,
  };
}

export function useLiveScoring(
  config: ExerciseConfig,
  prescribedReps: number,
  calibrationBaselineAbsoluteDeg?: number,
): UseLiveScoringResult {
  const detectorRef = useRef<RepDetector | null>(null);
  if (detectorRef.current === null) {
    detectorRef.current = new RepDetector({ config, calibrationBaselineAbsoluteDeg });
  }
  const lastRepRef = useRef<RepResult | null>(null);
  const everFrozenRef = useRef(false);
  const frozenReasonsRef = useRef<Set<string>>(new Set());
  const cueRef = useRef<LiveCue | null>(null);

  const [reps, setReps] = useState<RepResult[]>([]);
  const [liveCue, setLiveCue] = useState<LiveCue | null>(null);
  const [frozenReasons, setFrozenReasons] = useState<string[]>([]);

  const pushSample = useCallback(
    (nowMs: number, angleDeg: number | null, signal: SignalQualityReport) => {
      if (!signal.scoringPermitted) {
        everFrozenRef.current = true;
        let changed = false;
        for (const r of signal.reasons) {
          if (!frozenReasonsRef.current.has(r)) {
            frozenReasonsRef.current.add(r);
            changed = true;
          }
        }
        if (changed) setFrozenReasons(Array.from(frozenReasonsRef.current));
      }

      if (angleDeg !== null) {
        const closed = detectorRef.current!.push(nowMs, angleDeg, signal.scoringPermitted);
        if (closed) {
          lastRepRef.current = closed;
          setReps((prev) => [...prev, closed]);
        }
      }

      const nextCue = selectCue({ signal, lastCompletedRep: lastRepRef.current, config, nowMs }, cueRef.current);
      if (nextCue !== cueRef.current) {
        cueRef.current = nextCue;
        setLiveCue(nextCue);
      }
    },
    [config],
  );

  const reset = useCallback(() => {
    detectorRef.current = new RepDetector({ config, calibrationBaselineAbsoluteDeg });
    lastRepRef.current = null;
    everFrozenRef.current = false;
    frozenReasonsRef.current = new Set();
    cueRef.current = null;
    setReps([]);
    setLiveCue(null);
    setFrozenReasons([]);
  }, [config, calibrationBaselineAbsoluteDeg]);

  return {
    reps,
    liveCue,
    scoringFrozen: everFrozenRef.current,
    frozenReasons,
    result: buildResult(config, reps, prescribedReps, everFrozenRef.current, frozenReasons),
    pushSample,
    reset,
  };
}
