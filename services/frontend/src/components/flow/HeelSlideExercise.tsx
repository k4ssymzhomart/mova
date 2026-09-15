"use client";

// HeelSlideExercise — the exercise step of Heel Slide with real sensors.
//
//  - Start. The patient lies down with the leg straight and presses «Начать»; a three-second countdown lets the
//    leg settle after the press. The zero is taken from the first half second after that, so it cannot be a
//    sitting pose from the moment the page opened. Recording starts at the same instant, which keeps the stored
//    series (the clinician view recounts from its first half second) on the same zero as the live count.
//  - Every frame from all three sensors is recorded to session_frames (lib/ble/useBleSessionRecorder). Thigh and
//    shank pitch are paired within 100 ms, turned into the relative orientation proxy, zeroed and oriented
//    (lib/motion/flexion), then counted by the streaming hysteresis counter with the exercise's thresholds
//    (lib/motion/reps). The proxy is not a knee angle: the patient sees a count, the phase in words and a drawing,
//    never a degree number, and nothing is scored.
//  - When a sensor stops streaming the connect panel appears in place. A full reload drops every Bluetooth
//    connection, so after one the panel is the first thing shown. Counting resumes on the same zero once frames
//    are back; the count itself lives in this page and starts again from zero after a reload.
//  - Finishing stops the recorder and waits for the last rows, completes the session with a summary of what was
//    counted and how, disconnects the sensors and opens the check-in.
//
// Frames come only from the live Web Bluetooth store; the mock sensor source never produces any.

import { CircleCheck, LoaderCircle, Play, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { bodyText, card, primaryButton, secondaryButton, sectionTitle, tileLabel } from "@/components/app/recipes";
import { disconnectAll, getSnapshot, subscribeFrames, useLiveSensors } from "@/lib/ble/liveSensors";
import { SENSOR_ROLE_ORDER, type SensorRole } from "@/lib/ble/roles";
import { useBleSessionRecorder } from "@/lib/ble/useBleSessionRecorder";
import type { ParsedWt901Frame } from "@/lib/ble/wt901ble68";
import {
  PROXY_DEFINITION,
  createPairer,
  createProxyOrienter,
  proxyPitchDeg,
  type ProxyOrienter,
  type ProxyPairer,
} from "@/lib/motion/flexion";
import {
  createRepCounter,
  heelSlideThresholds,
  type RepCounter,
  type RepPhase,
  type RepThresholds,
} from "@/lib/motion/reps";
import { createClient } from "@/lib/supabase/client";
import type { BufferCounters } from "@/lib/telemetry/buffer";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/locales/client";

import HeelSlideGuide from "./HeelSlideGuide";
import SensorConnectPanel, { formatNumber, rateRecord, type RateRecord, type SavedDeviceRow } from "./SensorConnectPanel";
import { stepHref } from "./steps";

const SETTLE_SECONDS = 3;

/**
 * - waiting: before «Начать», or back here when the sensors dropped before the zero was taken.
 * - settling: the countdown after the press; frames are neither recorded nor counted yet.
 * - baseline: recording, and the first half second of paired samples is becoming the zero.
 * - counting: reps are counted.
 */
type Stage = "waiting" | "settling" | "baseline" | "counting";

interface Pipeline {
  pairer: ProxyPairer;
  orienter: ProxyOrienter;
  counter: RepCounter;
  thresholds: RepThresholds;
}

/** sessions.summary written when Heel Slide finishes. */
interface HeelSlideSummary {
  kind: "heel_slide_path.v1";
  reps_counted_on_device: number;
  target_reps: number | null;
  /** Epoch ms of the browser receive times; peak in relative sensor-orientation degrees, not knee flexion. */
  rep_segments: { start_ms: number; end_ms: number; peak_rel_deg: number }[];
  proxy: { definition: string; calibrated: false; knee_flexion: false };
  thresholds: { enter_deg: number; exit_deg: number; min_rep_ms: number };
  delivered_hz: Record<SensorRole, number | null>;
  rate: Record<SensorRole, RateRecord>;
  telemetry: { frames_sent: number; errors: number; pending_at_finish: number; frames_dropped: number | null };
}

export interface HeelSlideExerciseProps {
  sessionId: string;
  targetReps: number | null;
  scoringRubric: unknown;
  patientId: string;
  side: "left" | "right" | null;
  savedDevices: readonly SavedDeviceRow[];
}

export default function HeelSlideExercise({
  sessionId,
  targetReps,
  scoringRubric,
  patientId,
  side,
  savedDevices,
}: HeelSlideExerciseProps) {
  const { t, locale } = useTranslation();
  const router = useRouter();
  const live = useLiveSensors();
  const { counters, start: startRecorder, stop: stopRecorder, recordFrame } = useBleSessionRecorder();
  const beginReasonId = useId();

  // Built once: a server refresh (the language toggle) must not replace the counter and lose the count.
  const pipelineRef = useRef<Pipeline | null>(null);
  if (!pipelineRef.current) {
    const thresholds = heelSlideThresholds(scoringRubric);
    pipelineRef.current = {
      pairer: createPairer(),
      orienter: createProxyOrienter(),
      counter: createRepCounter(thresholds),
      thresholds,
    };
  }
  const pipeline = pipelineRef.current;

  const [stage, setStage] = useState<Stage>("waiting");
  const [countdown, setCountdown] = useState(SETTLE_SECONDS);
  const [reps, setReps] = useState<{ count: number; phase: RepPhase }>({ count: 0, phase: "rest" });
  const [recording, setRecording] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishFailed, setFinishFailed] = useState(false);
  const [recorderFailed, setRecorderFailed] = useState(false);

  const stageRef = useRef<Stage>("waiting");
  const armedRef = useRef(false);
  const recordingRef = useRef(false);
  const stoppedRef = useRef(false);
  const finishingRef = useRef(false);
  const latestProxyRef = useRef<number | null>(null);
  const shownRef = useRef<{ count: number; phase: RepPhase }>({ count: 0, phase: "rest" });
  const allStreamingRef = useRef(live.allStreaming);
  const settleTimerRef = useRef<number | null>(null);
  const finalCountersRef = useRef<BufferCounters | null>(null);

  const moveTo = useCallback((next: Stage) => {
    stageRef.current = next;
    setStage(next);
  }, []);

  const clearSettleTimer = useCallback(() => {
    if (settleTimerRef.current === null) return;
    window.clearInterval(settleTimerRef.current);
    settleTimerRef.current = null;
  }, []);

  useEffect(() => clearSettleTimer, [clearSettleTimer]);

  // Runs synchronously inside the Bluetooth event for every frame of every role, so it stays cheap and touches
  // React state only when the count or the phase changes.
  const onFrame = useCallback(
    (role: SensorRole, frame: ParsedWt901Frame, receivedAtMs: number) => {
      if (!armedRef.current) return;
      recordFrame(role, frame, receivedAtMs);
      const pair = pipeline.pairer.push(role, receivedAtMs, proxyPitchDeg(frame.eulerDegrees));
      if (!pair) return;
      const value = pipeline.orienter.push(pair.tMs, pair.relativeDeg);
      if (value === null) return;
      latestProxyRef.current = value;
      const state = pipeline.counter.push(pair.tMs, value);
      if (stageRef.current === "baseline") moveTo("counting");
      const shown = shownRef.current;
      if (state.count !== shown.count || state.phase !== shown.phase) {
        shownRef.current = { count: state.count, phase: state.phase };
        setReps(shownRef.current);
      }
    },
    [pipeline, recordFrame, moveTo],
  );

  useEffect(() => subscribeFrames(onFrame), [onFrame]);

  useEffect(() => {
    allStreamingRef.current = live.allStreaming;
    if (live.allStreaming) return;
    if (stageRef.current === "settling") {
      clearSettleTimer();
      moveTo("waiting");
    } else if (stageRef.current === "baseline") {
      // A zero taken across a dropout is not trustworthy: start it again once the sensors are back.
      armedRef.current = false;
      pipeline.pairer.reset();
      pipeline.orienter.reset();
      latestProxyRef.current = null;
      moveTo("waiting");
    }
  }, [live.allStreaming, clearSettleTimer, moveTo, pipeline]);

  const readProxy = useCallback(() => (allStreamingRef.current ? latestProxyRef.current : null), []);

  const arm = useCallback(async () => {
    if (stageRef.current !== "settling" || stoppedRef.current) return;
    if (!getSnapshot().allStreaming) {
      moveTo("waiting");
      return;
    }
    if (!recordingRef.current) {
      try {
        await startRecorder(sessionId);
      } catch {
        setRecorderFailed(true);
        moveTo("waiting");
        return;
      }
      recordingRef.current = true;
      setRecording(true);
    }
    if (stageRef.current !== "settling" || stoppedRef.current) return;
    pipeline.pairer.reset();
    pipeline.orienter.reset();
    latestProxyRef.current = null;
    armedRef.current = true;
    moveTo("baseline");
  }, [pipeline, sessionId, startRecorder, moveTo]);

  function begin() {
    if (stageRef.current !== "waiting" || stoppedRef.current || !live.allStreaming) return;
    setRecorderFailed(false);
    moveTo("settling");
    let remaining = SETTLE_SECONDS;
    setCountdown(remaining);
    clearSettleTimer();
    settleTimerRef.current = window.setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        setCountdown(remaining);
        return;
      }
      clearSettleTimer();
      void arm();
    }, 1000);
  }

  async function finish() {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setFinishing(true);
    setFinishFailed(false);
    // Once finishing starts, nothing more is recorded or counted, even if completing the session has to be retried.
    stoppedRef.current = true;
    setStopped(true);
    clearSettleTimer();
    armedRef.current = false;

    let telemetry = finalCountersRef.current;
    if (!telemetry) {
      try {
        telemetry = (await stopRecorder()) ?? counters;
      } catch {
        telemetry = counters;
      }
      finalCountersRef.current = telemetry;
    }

    const snapshot = getSnapshot();
    const { counter, thresholds } = pipeline;
    const deliveredHz = {} as Record<SensorRole, number | null>;
    const rate = {} as Record<SensorRole, RateRecord>;
    for (const role of SENSOR_ROLE_ORDER) {
      deliveredHz[role] = snapshot.roles[role].deliveredHz;
      rate[role] = rateRecord(snapshot.roles[role].rate);
    }
    const summary: HeelSlideSummary = {
      kind: "heel_slide_path.v1",
      reps_counted_on_device: counter.count,
      target_reps: targetReps,
      rep_segments: counter.segments.map((segment) => ({
        start_ms: segment.startMs,
        end_ms: segment.endMs,
        peak_rel_deg: Math.round(segment.peakValue * 10) / 10,
      })),
      proxy: { definition: PROXY_DEFINITION, calibrated: false, knee_flexion: false },
      thresholds: { enter_deg: thresholds.enterDeg, exit_deg: thresholds.exitDeg, min_rep_ms: thresholds.minRepMs },
      delivered_hz: deliveredHz,
      rate,
      telemetry: {
        frames_sent: telemetry.framesSent,
        errors: telemetry.errors,
        pending_at_finish: telemetry.pending,
        frames_dropped: telemetry.framesDropped ?? null,
      },
    };

    let failed: boolean;
    try {
      const { error } = await createClient().rpc("finish_training_session", {
        p_session: sessionId,
        p_summary: summary,
        p_metrics: {},
      });
      failed = Boolean(error);
    } catch {
      failed = true;
    }
    if (failed) {
      finishingRef.current = false;
      setFinishing(false);
      setFinishFailed(true);
      return;
    }
    disconnectAll();
    router.push(stepHref(sessionId, "checkIn"));
  }

  const done = targetReps !== null && reps.count >= targetReps;
  const counting = stage === "counting" || stage === "baseline";
  const showPanel = !live.allStreaming && !stopped;

  let stageText: string;
  if (finishing) stageText = t("flow.exercise.stage.finishing");
  else if (stopped) stageText = t("flow.exercise.stage.stopped");
  else if (stage === "waiting") stageText = t("flow.exercise.stage.waiting");
  else if (stage === "settling") stageText = t("flow.exercise.stage.settling", { n: countdown });
  else if (stage === "baseline") stageText = t("flow.exercise.stage.baseline");
  else if (done) stageText = t("flow.exercise.stage.done");
  else stageText = t(`flow.exercise.stage.${reps.phase}`);

  const count = formatNumber(locale, reps.count);
  const total = targetReps !== null ? formatNumber(locale, targetReps) : null;

  return (
    <div className="space-y-6">
      {showPanel && (
        <section aria-labelledby="exercise-sensors" className="space-y-4">
          <div>
            <h2 id="exercise-sensors" className={sectionTitle}>
              {counting ? t("flow.exercise.interruptedTitle") : t("flow.exercise.connectTitle")}
            </h2>
            <p className={cn("mt-2 max-w-2xl", bodyText)}>
              {counting ? t("flow.exercise.interruptedBody") : t("flow.exercise.connectBody")}
            </p>
          </div>
          <SensorConnectPanel patientId={patientId} side={side} savedDevices={savedDevices} />
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <section aria-labelledby="exercise-reps" className={cn(card, "flex flex-col p-6 sm:p-8")}>
          <h2 id="exercise-reps" className={tileLabel}>
            {t("flow.exercise.repsTitle")}
          </h2>
          <p aria-live="polite" aria-atomic="true" className="mt-2">
            <span className="sr-only">
              {total !== null
                ? t("flow.exercise.repsSr", { n: count, total })
                : t("flow.exercise.repsSrNoTarget", { n: count })}
            </span>
            <span aria-hidden="true" className="tnum text-6xl font-semibold leading-none text-ink">
              {count}
              {total !== null && <span className="text-ink-soft"> / {total}</span>}
            </span>
          </p>
          <p className="mt-5 flex items-start gap-2 text-lg font-semibold leading-snug text-ink">
            {done && !stopped && (
              <CircleCheck className="mt-0.5 size-6 shrink-0 text-signal-deep" strokeWidth={2} aria-hidden="true" />
            )}
            {stageText}
          </p>

          {stage === "waiting" && !stopped && (
            <div className="mt-6 flex flex-col gap-3">
              <button
                type="button"
                onClick={begin}
                disabled={!live.allStreaming}
                aria-describedby={live.allStreaming ? undefined : beginReasonId}
                className={cn(primaryButton, "w-full sm:w-auto sm:self-start")}
              >
                <Play className="size-5" strokeWidth={2} aria-hidden="true" />
                {t("flow.exercise.begin")}
              </button>
              {!live.allStreaming && (
                <p id={beginReasonId} className={bodyText}>
                  {t("flow.exercise.beginBlocked")}
                </p>
              )}
              {recorderFailed && <ErrorLine>{t("flow.exercise.recordFailed")}</ErrorLine>}
            </div>
          )}
        </section>

        <HeelSlideGuide readProxy={readProxy} />
      </div>

      <section aria-labelledby="exercise-saving" className={cn(card, "px-5 py-4 sm:px-6")}>
        <h2 id="exercise-saving" className="text-base font-semibold text-ink">
          {t("flow.exercise.saving.title")}
        </h2>
        <p className="tnum mt-1 text-base text-ink-soft">
          {recording
            ? t("flow.exercise.saving.progress", {
                sent: formatNumber(locale, counters.framesSent),
                pending: formatNumber(locale, counters.pending),
              })
            : t("flow.exercise.saving.notStarted")}
        </p>
        {counters.errors > 0 && (
          <p className="tnum mt-1 text-base text-ink-soft">
            {t("flow.exercise.saving.errors", { n: formatNumber(locale, counters.errors) })}
          </p>
        )}
        {(counters.framesDropped ?? 0) > 0 && (
          <p className="tnum mt-1 text-base text-ink-soft">
            {t("flow.exercise.saving.dropped", { n: formatNumber(locale, counters.framesDropped ?? 0) })}
          </p>
        )}
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
        {done || targetReps === null || stopped ? (
          <button type="button" onClick={finish} disabled={finishing} className={primaryButton}>
            {finishing ? (
              <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden="true" />
            ) : (
              <CircleCheck className="size-5" strokeWidth={2} aria-hidden="true" />
            )}
            {finishing ? t("flow.exercise.finishing") : t("flow.exercise.finish")}
          </button>
        ) : (
          <button type="button" onClick={finish} disabled={finishing} className={secondaryButton}>
            {finishing && (
              <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden="true" />
            )}
            {finishing ? t("flow.exercise.finishing") : t("flow.exercise.finishEarly")}
          </button>
        )}
        {finishFailed && <ErrorLine>{t("flow.exercise.finishFailed")}</ErrorLine>}
      </div>
    </div>
  );
}

function ErrorLine({ children }: { children: string }) {
  return (
    <p role="alert" className="flex items-start gap-2 text-base leading-relaxed text-red-800">
      <TriangleAlert className="mt-0.5 size-5 shrink-0" strokeWidth={2} aria-hidden="true" />
      {children}
    </p>
  );
}
