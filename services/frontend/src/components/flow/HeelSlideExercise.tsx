"use client";

// HeelSlideExercise — the exercise step of Heel Slide with real sensors.
//
//  - Nothing starts or finishes before the session's status has been read fresh. Back after finishing can restore
//    this screen from the router cache for a session that is already completed; the fresh read sends it on to its
//    check-in instead of letting «Начать» or «Закончить раньше» act on it. If the read itself fails the screen
//    carries on, because the server holds the line too: finish_prescribed_session refuses a session that is not in
//    progress (55000, handled as "already finished") and the telemetry RPC skips frames recorded after a session
//    ended.
//  - Start. The patient lies down with the leg straight and presses «Начать»; a three-second countdown lets the leg
//    settle after the press, and focus moves to the instruction line, which is announced. The zero is taken from the
//    first half second after that. The span of every zero that succeeds is kept per session in sessionStorage, which
//    survives a reload, and the whole list goes into the summary as baseline_windows_ms (baseline_window_ms is its
//    last entry). The clinician recount counts each span on its own zero, so reps done before a reload are counted
//    too, and a start abandoned before its zero is not.
//  - Every frame from all three sensors is recorded to session_frames (lib/ble/useBleSessionRecorder). Thigh and
//    shank pitch are paired within 100 ms, turned into the relative orientation proxy, zeroed and oriented
//    (lib/motion/flexion), then counted by the streaming hysteresis counter with the exercise's thresholds
//    (lib/motion/reps). The proxy is not a knee angle: the patient sees a count, the phase in words and a drawing,
//    never a degree number, and nothing is scored.
//  - Counting needs the thigh and shank sensors. While either is not streaming, a status line next to the count says
//    counting is paused and names the sensor, and a rep left open by a pause of more than a second is dropped rather
//    than counted after it (lib/motion/reps). The store reconnects a dropped sensor on its own; counting resumes on
//    the same zero. A foot dropout does not pause counting, and a notice says its frames are not being saved.
//  - A reload drops every Bluetooth connection and the count, which lives in this page. When the screen finds that
//    the session recorded before it opened (this tab's flag, a stored frame, or rows waiting on the device), it tells
//    the patient the count starts again from zero; the summary records restarted_after_reload. What it asks next
//    depends on whether this tab kept the zero of an earlier start (exerciseStatus restartNoticeKey): if it did,
//    those reps are recounted and the patient does only the rest; if not (no storage, or the earlier start was in
//    another tab), nothing ties them to a zero, and the patient is asked for the whole set.
//  - Finishing stops the recorder, which keeps trying to deliver for about ten seconds. Rows it could not deliver
//    stay on the device, and the telemetry outbox (mounted in the app layout) keeps sending them while the app is
//    open. The session is completed with finish_prescribed_session and the summary (heelSlideRecords.ts), then the
//    sensors are disconnected and the check-in opens.
//
// Frames come only from the live Web Bluetooth store; the mock sensor source never produces any. With the development
// simulation on (lib/ble/simulation.ts: `next dev` with NEXT_PUBLIC_SENSOR_SIMULATION=1) that store runs on simulated
// sensors: the screen starts their scripted heel slides when counting starts, and the summary and every recorded frame
// are marked simulated.

import { CircleCheck, Info, LoaderCircle, Pause, Play, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { bodyText, card, focusRing, primaryButton, secondaryButton, sectionTitle, tileLabel } from "@/components/app/recipes";
import { disconnectAll, getSnapshot, setRequestedRate, subscribeFrames, useLiveSensors } from "@/lib/ble/liveSensors";
import { SENSOR_ROLE_ORDER, type SensorRole } from "@/lib/ble/roles";
import type { RecorderCounters } from "@/lib/ble/sessionRecorder";
import { SIMULATION_ENABLED, startSimulatedMovement } from "@/lib/ble/simulation";
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
  MAX_REP_GAP_MS,
  createRepCounter,
  heelSlideThresholds,
  type RepCounter,
  type RepPhase,
  type RepThresholds,
} from "@/lib/motion/reps";
import { createClient } from "@/lib/supabase/client";
import { drainTelemetryOutbox, pendingForSession } from "@/lib/telemetry/outbox";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/locales/client";

import {
  appendBaselineWindow,
  baselineWindowsKey,
  exerciseRouteFor,
  missingCountingRoles,
  parseBaselineWindows,
  pauseMessageKey,
  recordedFlagKey,
  restartNoticeKey,
  type BaselineWindowRecord,
} from "./exerciseStatus";
import {
  batteryRecord,
  buildHeelSlideSummary,
  pendingAtFinish,
  requestedHzFromDeviceInfo,
  startSensorsFromDeviceInfo,
  type SeenBattery,
} from "./heelSlideRecords";
import HeelSlideGuide from "./HeelSlideGuide";
import SensorConnectPanel, { type SavedDeviceRow } from "./SensorConnectPanel";
import { formatNumber } from "./sensorReadout";
import SensorTechnicalReadout from "./SensorTechnicalReadout";
import { stepHref } from "./steps";

const SETTLE_SECONDS = 3;

/**
 * After a reload the recorder never ran on this page, so rows from before may still be on their way through the
 * outbox. Finishing gives that run this long before it reads what is still stored.
 */
const OUTBOX_WAIT_AT_FINISH_MS = 5000;

/**
 * - waiting: before «Начать», or back here when the sensors dropped before the zero was taken.
 * - settling: the countdown after the press; frames are neither recorded nor counted yet.
 * - baseline: recording, and the first half second of paired samples is becoming the zero.
 * - counting: reps are counted.
 */
type Stage = "waiting" | "settling" | "baseline" | "counting";

/**
 * - checking: the fresh status read is under way, or it found the session is no longer in progress and the screen
 *   is on its way out. Nothing may start or finish.
 * - ok: the session is in progress.
 * - unverified: the read failed; the screen carries on under the server's own guards.
 */
type SessionCheck = "checking" | "ok" | "unverified";

interface Pipeline {
  pairer: ProxyPairer;
  orienter: ProxyOrienter;
  counter: RepCounter;
  thresholds: RepThresholds;
}

type BrowserClient = ReturnType<typeof createClient>;

export interface HeelSlideExerciseProps {
  sessionId: string;
  targetReps: number | null;
  scoringRubric: unknown;
  /** sessions.device_info as written when the session opened. */
  deviceInfo: unknown;
  patientId: string;
  side: "left" | "right" | null;
  savedDevices: readonly SavedDeviceRow[];
}

export default function HeelSlideExercise({
  sessionId,
  targetReps,
  scoringRubric,
  deviceInfo,
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
      counter: createRepCounter({ ...thresholds, maxGapMs: MAX_REP_GAP_MS }),
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
  const [sessionCheck, setSessionCheck] = useState<SessionCheck>("checking");
  const [restarted, setRestarted] = useState(false);
  /** Zeros this tab kept from starts before the screen opened; null when storage could not be read. */
  const [earlierStarts, setEarlierStarts] = useState<number | null>(null);

  const stageRef = useRef<Stage>("waiting");
  /** Every successful zero of this session known to this tab, oldest first, this page's included. */
  const baselineWindowsRef = useRef<BaselineWindowRecord[] | null>(null);
  const armedRef = useRef(false);
  const recordingRef = useRef(false);
  const stoppedRef = useRef(false);
  const finishingRef = useRef(false);
  const restartedRef = useRef(false);
  const latestProxyRef = useRef<number | null>(null);
  const shownRef = useRef<{ count: number; phase: RepPhase }>({ count: 0, phase: "rest" });
  const countingLiveRef = useRef(false);
  const settleTimerRef = useRef<number | null>(null);
  /** The recorder's final counters once stopped (null inside: it never recorded here), kept across finish retries. */
  const stopResultRef = useRef<{ counters: RecorderCounters | null } | null>(null);
  const firstSeenBatteryRef = useRef<Partial<Record<SensorRole, SeenBattery>>>({});
  const stageStatusRef = useRef<HTMLParagraphElement>(null);
  const focusStageRef = useRef(false);
  const routerRef = useRef(router);
  routerRef.current = router;

  const startSensors = useMemo(() => startSensorsFromDeviceInfo(deviceInfo), [deviceInfo]);
  const openedWithHz = requestedHzFromDeviceInfo(deviceInfo);

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

  const leaveFor = useCallback(
    (status: string) => {
      const route = exerciseRouteFor(status);
      if (route === "checkIn") routerRef.current.replace(stepHref(sessionId, "checkIn"));
      else if (route === "summary") routerRef.current.replace(stepHref(sessionId, "summary"));
      else if (route === "refresh") routerRef.current.refresh();
    },
    [sessionId],
  );

  // The fresh status read, and whether this session recorded before the screen opened.
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    void readSessionStatus(supabase, sessionId).then((status) => {
      if (cancelled) return;
      if (status === null) setSessionCheck("unverified");
      else if (exerciseRouteFor(status) === "stay") setSessionCheck("ok");
      else leaveFor(status);
    });
    void recordedBefore(supabase, sessionId).then((before) => {
      // Once this page records, its own frames would answer the question.
      if (cancelled || !before || recordingRef.current) return;
      restartedRef.current = true;
      setRestarted(true);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId, leaveFor]);

  // The zeros of starts made before this screen opened, read before any start can happen here.
  useEffect(() => {
    let kept: BaselineWindowRecord[] | null;
    try {
      kept = parseBaselineWindows(window.sessionStorage.getItem(baselineWindowsKey(sessionId)));
    } catch {
      kept = null;
    }
    if (baselineWindowsRef.current === null) baselineWindowsRef.current = kept ?? [];
    setEarlierStarts(kept === null ? null : kept.length);
  }, [sessionId]);

  // A zero succeeded: add its span to the list, in memory for the summary and in storage for after a reload.
  const keepBaselineWindow = useCallback(() => {
    const zero = pipeline.orienter.baselineWindow;
    if (!zero) return;
    const next = appendBaselineWindow(baselineWindowsRef.current ?? [], { start: zero.startMs, end: zero.endMs });
    baselineWindowsRef.current = next;
    try {
      window.sessionStorage.setItem(baselineWindowsKey(sessionId), JSON.stringify(next));
    } catch {
      // The summary still carries it; only a later reload of this page would not know about this start.
    }
  }, [pipeline, sessionId]);

  // After a reload the store starts at 50 Hz; ask for the rate this session was opened with before anything connects.
  useEffect(() => {
    if (openedWithHz !== null) setRequestedRate(openedWithHz);
  }, [openedWithHz]);

  // The first battery reading seen from each device, for battery_start when the session opened without one.
  useEffect(() => {
    for (const role of SENSOR_ROLE_ORDER) {
      const state = live.roles[role];
      const record = batteryRecord(state.battery, state.batteryError);
      if (!record || state.deviceId === null) continue;
      const seen = firstSeenBatteryRef.current[role];
      if (!seen || seen.deviceId !== state.deviceId) {
        firstSeenBatteryRef.current[role] = { deviceId: state.deviceId, battery: record };
      }
    }
  }, [live]);

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
      if (stageRef.current === "baseline") {
        moveTo("counting");
        keepBaselineWindow();
        startSimulatedMovement();
      }
      const shown = shownRef.current;
      if (state.count !== shown.count || state.phase !== shown.phase) {
        shownRef.current = { count: state.count, phase: state.phase };
        setReps(shownRef.current);
      }
    },
    [pipeline, recordFrame, moveTo, keepBaselineWindow],
  );

  useEffect(() => subscribeFrames(onFrame), [onFrame]);

  const missingForCounting = missingCountingRoles(live.roles);
  const countingLive = missingForCounting.length === 0;

  useEffect(() => {
    countingLiveRef.current = countingLive;
    if (stageRef.current === "settling" && !live.allStreaming) {
      // Starting needs all three.
      clearSettleTimer();
      moveTo("waiting");
    } else if (stageRef.current === "baseline" && !countingLive) {
      // A zero taken across a thigh or shank dropout is not trustworthy: start it again once they are back.
      armedRef.current = false;
      pipeline.pairer.reset();
      pipeline.orienter.reset();
      latestProxyRef.current = null;
      moveTo("waiting");
    }
  }, [live.allStreaming, countingLive, clearSettleTimer, moveTo, pipeline]);

  const readProxy = useCallback(() => (countingLiveRef.current ? latestProxyRef.current : null), []);

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
      try {
        window.sessionStorage.setItem(recordedFlagKey(sessionId), String(Date.now()));
      } catch {
        // Storage can be unavailable (private mode); only the restart notice depends on it.
      }
    }
    if (stageRef.current !== "settling" || stoppedRef.current) return;
    pipeline.pairer.reset();
    pipeline.orienter.reset();
    latestProxyRef.current = null;
    armedRef.current = true;
    moveTo("baseline");
  }, [pipeline, sessionId, startRecorder, moveTo]);

  // «Начать» unmounts when the countdown starts; focus goes to the instruction line instead of being lost.
  useEffect(() => {
    if (!focusStageRef.current) return;
    focusStageRef.current = false;
    stageStatusRef.current?.focus();
  }, [stage]);

  const sessionUsable = sessionCheck !== "checking";

  function begin() {
    if (stageRef.current !== "waiting" || stoppedRef.current || !live.allStreaming || !sessionUsable) return;
    setRecorderFailed(false);
    focusStageRef.current = true;
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
    if (finishingRef.current || !sessionUsable) return;
    finishingRef.current = true;
    setFinishing(true);
    setFinishFailed(false);
    // Once finishing starts, nothing more is recorded or counted, even if completing the session has to be retried.
    stoppedRef.current = true;
    setStopped(true);
    clearSettleTimer();
    armedRef.current = false;

    const supabase = createClient();
    const status = await readSessionStatus(supabase, sessionId);
    if (status !== null && exerciseRouteFor(status) !== "stay") {
      leaveFor(status);
      return;
    }

    if (!stopResultRef.current) {
      let stoppedWith: RecorderCounters | null;
      try {
        stoppedWith = await stopRecorder();
      } catch {
        stoppedWith = recordingRef.current ? counters : null;
      }
      stopResultRef.current = { counters: stoppedWith };
    }
    const finalCounters = stopResultRef.current.counters;
    if (finalCounters === null) {
      await Promise.race([drainTelemetryOutbox().catch(() => undefined), delay(OUTBOX_WAIT_AT_FINISH_MS)]);
    }
    // Read again on every attempt: the outbox may have sent rows since the last one.
    const pending = await pendingAtFinish(finalCounters, () => pendingForSession(sessionId));

    const { counter, thresholds } = pipeline;
    const summary = buildHeelSlideSummary({
      repsCounted: counter.count,
      segments: counter.segments,
      targetReps,
      proxyDefinition: PROXY_DEFINITION,
      thresholds,
      maxGapMs: MAX_REP_GAP_MS,
      baselineWindows: baselineWindowsRef.current ?? [],
      restartedAfterReload: restartedRef.current,
      roles: getSnapshot().roles,
      startSensors,
      firstSeenBattery: firstSeenBatteryRef.current,
      telemetry: { counters: finalCounters, pending },
      simulated: SIMULATION_ENABLED,
    });

    let outcome: "completed" | "alreadyEnded" | "failed";
    try {
      const { error } = await supabase.rpc("finish_prescribed_session", { p_session: sessionId, p_summary: summary });
      // 55000: the session is no longer in progress, finished from another screen or tab. Its check-in comes next.
      outcome = !error ? "completed" : error.code === "55000" ? "alreadyEnded" : "failed";
    } catch {
      outcome = "failed";
    }
    if (outcome === "failed") {
      finishingRef.current = false;
      setFinishing(false);
      setFinishFailed(true);
      return;
    }
    disconnectAll();
    try {
      window.sessionStorage.removeItem(recordedFlagKey(sessionId));
      window.sessionStorage.removeItem(baselineWindowsKey(sessionId));
    } catch {
      // Nothing to clean up without storage.
    }
    router.replace(stepHref(sessionId, "checkIn"));
  }

  const done = targetReps !== null && reps.count >= targetReps;
  const counting = stage === "counting" || stage === "baseline";
  const showPanel = !live.allStreaming && !stopped;

  // When the in-place panel closes with focus inside it, focus would fall to <body>; keep it on the instruction.
  const panelShownRef = useRef(showPanel);
  useEffect(() => {
    const wasShown = panelShownRef.current;
    panelShownRef.current = showPanel;
    if (!wasShown || showPanel) return;
    const active = document.activeElement;
    if (!active || active === document.body) stageStatusRef.current?.focus();
  }, [showPanel]);

  let stageText: string;
  if (finishing) stageText = t("flow.exercise.stage.finishing");
  else if (stopped) stageText = t("flow.exercise.stage.stopped");
  else if (stage === "waiting") stageText = t("flow.exercise.stage.waiting");
  else if (stage === "settling") stageText = t("flow.exercise.stage.settling", { n: countdown });
  else if (stage === "baseline") stageText = t("flow.exercise.stage.baseline");
  else if (done) stageText = t("flow.exercise.stage.done");
  else stageText = t(`flow.exercise.stage.${reps.phase}`);

  const pauseKey = stage === "counting" && !stopped ? pauseMessageKey(missingForCounting) : null;
  const footMissing = counting && !stopped && live.roles.foot.link !== "streaming";

  const count = formatNumber(locale, reps.count);
  const total = targetReps !== null ? formatNumber(locale, targetReps) : null;

  let beginReason: string | null = null;
  if (!live.allStreaming) beginReason = t("flow.exercise.beginBlocked");
  else if (!sessionUsable) beginReason = t("flow.exercise.checkingSession");

  return (
    <div className="space-y-6">
      <div role="status" aria-atomic="true">
        {restarted && !stopped && (
          <div className={cn(card, "flex items-start gap-3 px-5 py-4")}>
            <Info className="mt-0.5 size-5 shrink-0 text-signal-deep" strokeWidth={2} aria-hidden="true" />
            <p className="text-base leading-relaxed text-ink">{t(restartNoticeKey(earlierStarts))}</p>
          </div>
        )}
      </div>

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

          <div role="status" aria-atomic="true">
            {pauseKey && (
              <p className="mt-4 flex items-start gap-2 rounded-card border-2 border-amber-700 px-4 py-3 text-base font-semibold leading-snug text-ink">
                <Pause className="mt-0.5 size-5 shrink-0 text-amber-700" strokeWidth={2} aria-hidden="true" />
                {t(pauseKey)}
              </p>
            )}
          </div>

          <p
            ref={stageStatusRef}
            tabIndex={-1}
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className={cn("mt-5 flex items-start gap-2 rounded-sm text-lg font-semibold leading-snug text-ink", focusRing)}
          >
            {done && !stopped && (
              <CircleCheck className="mt-0.5 size-6 shrink-0 text-signal-deep" strokeWidth={2} aria-hidden="true" />
            )}
            {stageText}
          </p>

          <div role="status" aria-atomic="true">
            {footMissing && (
              <p className="mt-4 flex items-start gap-2 text-base leading-relaxed text-ink-soft">
                <Info className="mt-0.5 size-5 shrink-0" strokeWidth={2} aria-hidden="true" />
                {t("flow.exercise.footMissing")}
              </p>
            )}
          </div>

          {stage === "waiting" && !stopped && (
            <div className="mt-6 flex flex-col gap-3">
              <button
                type="button"
                onClick={begin}
                disabled={!live.allStreaming || !sessionUsable}
                aria-describedby={beginReason ? beginReasonId : undefined}
                className={cn(primaryButton, "w-full sm:w-auto sm:self-start")}
              >
                <Play className="size-5" strokeWidth={2} aria-hidden="true" />
                {t("flow.exercise.begin")}
              </button>
              {beginReason && (
                <p id={beginReasonId} className={bodyText}>
                  {beginReason}
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
                sent: formatNumber(locale, counters.framesConfirmed),
                pending: formatNumber(locale, counters.pending),
              })
            : t("flow.exercise.saving.notStarted")}
        </p>
        {counters.errors > 0 && (
          <p className="tnum mt-1 text-base text-ink-soft">
            {t("flow.exercise.saving.errors", { n: formatNumber(locale, counters.errors) })}
          </p>
        )}
        {counters.framesDropped > 0 && (
          <p className="tnum mt-1 text-base text-ink-soft">
            {t("flow.exercise.saving.dropped", { n: formatNumber(locale, counters.framesDropped) })}
          </p>
        )}
        {finishing && recording && counters.pending > 0 && (
          <p className="tnum mt-1 text-base text-ink-soft">
            {t("flow.exercise.saving.finishingPending", { n: formatNumber(locale, counters.pending) })}
          </p>
        )}
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
        {done || targetReps === null || stopped ? (
          <button type="button" onClick={finish} disabled={finishing || !sessionUsable} className={primaryButton}>
            {finishing ? (
              <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden="true" />
            ) : (
              <CircleCheck className="size-5" strokeWidth={2} aria-hidden="true" />
            )}
            {finishing ? t("flow.exercise.finishing") : t("flow.exercise.finish")}
          </button>
        ) : (
          <button type="button" onClick={finish} disabled={finishing || !sessionUsable} className={secondaryButton}>
            {finishing && (
              <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden="true" />
            )}
            {finishing ? t("flow.exercise.finishing") : t("flow.exercise.finishEarly")}
          </button>
        )}
        {finishFailed && <ErrorLine>{t("flow.exercise.finishFailed")}</ErrorLine>}
      </div>

      <SensorTechnicalReadout />
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** The session's status read fresh from the database; null when the read failed or returned nothing. */
async function readSessionStatus(supabase: BrowserClient, sessionId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.from("sessions").select("status").eq("id", sessionId).maybeSingle();
    if (error || !data) return null;
    const status = (data as { status?: unknown }).status;
    return typeof status === "string" ? status : null;
  } catch {
    return null;
  }
}

/**
 * Whether this session recorded before the screen opened: this tab set its flag (it survives a reload), a frame is
 * stored on the server, or rows for it are still waiting on the device. A read that fails is no evidence either way,
 * so it never blocks the screen; the notice is then simply not shown.
 */
async function recordedBefore(supabase: BrowserClient, sessionId: string): Promise<boolean> {
  try {
    if (window.sessionStorage.getItem(recordedFlagKey(sessionId)) !== null) return true;
  } catch {
    // No storage: fall through to the other two.
  }
  const stored = (async () => {
    try {
      const { data, error } = await supabase.from("session_frames").select("seq").eq("session_id", sessionId).limit(1);
      return !error && Array.isArray(data) && data.length > 0;
    } catch {
      return false;
    }
  })();
  const waiting = pendingForSession(sessionId).then(
    (rows) => rows > 0,
    () => false,
  );
  const [onServer, onDevice] = await Promise.all([stored, waiting]);
  return onServer || onDevice;
}
