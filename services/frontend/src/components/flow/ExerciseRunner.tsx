"use client";

// ExerciseRunner — the exercise step for EVERY exercise, and the first screen in this app that joins the three
// things that were each built and then left unwired: the clinician's reference clip, the camera pose engine, and
// the deterministic scoring engine.
//
// WHY IT EXISTS. Until now the exercise step ran exactly one exercise (HeelSlideExercise, Heel Slide, three BLE
// sensors) and showed every other exercise a placeholder. A patient prescribed ankle pumps could not do them.
//
// TWO INSTRUMENTS, ONE PIPELINE. The movement is measured either by the sensors on the leg or by the camera, and
// the patient picks which before they start. Both instruments end up in the same three steps, so a rep is defined
// the same way whichever one measured it:
//
//     a stream of degrees  ->  createProxyOrienter (zeroes on the first half second, makes a bend positive)
//                          ->  useLiveScoring     (RepDetector -> RepResult -> SessionResult)
//
// ONE INSTRUMENT PER SESSION. Running both at once would give two independent rep counts for one movement, so the
// choice is made before counting starts and is written into the summary as `input_mode`. A stored count that does
// not say what measured it is a count nobody can interpret later.
//
// WHAT THE DEGREES ARE, AND ARE NOT. On sensors they are the uncalibrated orientation proxy (lib/motion/flexion);
// on the camera they are an image-plane joint angle (lib/cv/jointAngles). Neither is a clinically measured knee
// angle, and this screen never presents one: the patient sees a count, a phase in words, and a drawing. The score
// panel says in its own words which parts of the score were measured and which were not.
//
// WHAT THIS DELIBERATELY DOES NOT DO.
//  - It does not replace HeelSlideExercise. Heel Slide on sensors keeps its own screen and keeps writing
//    `heel_slide_path.v1`, because the clinician portal and the clinician recount are written against that record
//    and against its thigh/shank pitch pairs. Moving it would lose the one exercise in clinical use.
//  - It does not write session_metrics. finish_prescribed_session is contractually forbidden from doing so
//    (migration 0034), so the score travels in the summary jsonb and the clinician reader for it is a later
//    migration. The pull request says so.
//  - It runs no sets-and-rest model. One set, the prescribed number of repetitions.

import { Camera, CircleCheck, Cpu, LoaderCircle, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { bodyText, card, cardTitle, primaryButton, secondaryButton, sectionTitle, tileLabel } from "@/components/app/recipes";
import GhostTrajectory from "@/components/session/GhostTrajectory";
import LiveCuePanel from "@/components/session/LiveCuePanel";
import ReferenceVideo from "@/components/session/ReferenceVideo";
import ScorePanel from "@/components/session/ScorePanel";
import type { VisionAngleSample } from "@/components/session/ExerciseVisionStage";
import ExerciseVisionStage from "@/components/session/ExerciseVisionStage";
import { disconnectAll, subscribeFrames, useLiveSensors } from "@/lib/ble/liveSensors";
import type { SensorRole } from "@/lib/ble/roles";
import type { SignalQualityReport } from "@/lib/ble/signalQuality";
import { SIMULATION_ENABLED, startSimulatedMovement } from "@/lib/ble/simulation";
import { useBleSessionRecorder } from "@/lib/ble/useBleSessionRecorder";
import type { ParsedWt901Frame } from "@/lib/ble/wt901ble68";
import { linesIn } from "@/components/exercises/library";
import { resolveExercise, type ResolvedExercise } from "@/lib/exercises/config";
import { visionJointFor } from "@/lib/exercises/visionJoint";
import {
  KNEE_SIGNAL,
  createProxyOrienter,
  createSignalPairer,
  proxyPitchDeg,
  signalDefinition,
  signalRoles,
  type FlexionSignal,
  type ProxyOrienter,
  type ProxyPairer,
} from "@/lib/motion/flexion";
import { createRepCounter, type RepCounter } from "@/lib/motion/reps";
import type { ExerciseConfig } from "@/lib/scoring/types";
import { useLiveScoring, type UseLiveScoringResult } from "@/lib/scoring/useLiveScoring";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/locales/client";

import { buildExerciseSummary, scoreRecord, type InputMode, type ScoreRecord } from "./exerciseRecords";
import { exerciseRouteFor } from "./exerciseStatus";
import SensorConnectPanel, { type SavedDeviceRow } from "./SensorConnectPanel";
import { stepHref } from "./steps";

/** Seconds between pressing «Начать» and the zero being taken, so the limb can settle after the press. */
const SETTLE_SECONDS = 3;

/** The rep counter's own clock is performance.now() for the camera and epoch ms for the sensors; see toEpochMs. */
const CLOCK_OFFSET_MS = () => Date.now() - performance.now();

type Stage = "choosing" | "waiting" | "settling" | "counting" | "finished";

export interface ExerciseRunnerProps {
  sessionId: string;
  /** Canonical kebab-case slug, straight from public.exercises. */
  exerciseSlug: string;
  exerciseName: string | null;
  targetReps: number | null;
  /** exercises.scoring_rubric as stored. It may raise the counting threshold, never lower it. */
  scoringRubric: unknown;
  patientId: string | null;
  side: "left" | "right" | null;
  savedDevices: readonly SavedDeviceRow[];
}

/**
 * The signal-quality report the camera path hands the scoring engine.
 *
 * `SignalQualityReport` was written for three BLE sensors — packet counts, per-role sample rates, synchronisation
 * skew — and a camera has none of those. Rather than fill those fields with plausible-looking numbers, they are
 * left empty and the only thing that carries information is `level`, taken from the pose engine's own landmark
 * confidence, and `reasons`, which names the instrument outright. A reader of a frozen score therefore sees
 * "camera_input" rather than a fabricated packet count.
 */
function cameraQuality(confidence: number | null): SignalQualityReport {
  const level = confidence === null ? "INVALID" : confidence >= 0.8 ? "HIGH" : confidence >= 0.5 ? "MEDIUM" : "LOW";
  return {
    level,
    reasons: confidence === null ? ["camera_input", "no_pose"] : ["camera_input"],
    calibrationDurationSeconds: 0,
    synchronizationSkewMs: null,
    sampleRatesHz: {},
    packetCounts: { thigh: 0, shank: 0, foot: 0 },
    // The camera measures something real; it is simply not the instrument the thresholds were written for.
    scoringPermitted: confidence !== null && confidence >= 0.5,
  };
}

/**
 * The scoring hook needs a config, and four catalog exercises deliberately have none. React forbids calling a hook
 * conditionally, so the choice is made by which COMPONENT renders: an exercise with a config goes through
 * ScoredRunner, which calls the hook; one without goes straight to the body with `scoring: null` and says plainly
 * that it is not scored. Neither path fabricates a config to keep a hook happy.
 */
export default function ExerciseRunner(props: ExerciseRunnerProps) {
  const resolved = useMemo(
    () => resolveExercise(props.exerciseSlug, props.scoringRubric),
    [props.exerciseSlug, props.scoringRubric],
  );
  if (resolved.config === null) return <RunnerBody {...props} resolved={resolved} scoring={null} />;
  return <ScoredRunner {...props} resolved={resolved} config={resolved.config} />;
}

function ScoredRunner({
  resolved,
  config,
  ...props
}: ExerciseRunnerProps & { resolved: ResolvedExercise; config: ExerciseConfig }) {
  const scoring = useLiveScoring(config, props.targetReps ?? config.prescribedRepsDefault ?? 0);
  return <RunnerBody {...props} resolved={resolved} scoring={scoring} />;
}

function RunnerBody({
  sessionId,
  exerciseName,
  targetReps,
  patientId,
  side,
  savedDevices,
  resolved,
  scoring,
}: ExerciseRunnerProps & { resolved: ResolvedExercise; scoring: UseLiveScoringResult | null }) {
  const { t, locale } = useTranslation();
  const router = useRouter();
  const live = useLiveSensors();
  const recorder = useBleSessionRecorder();
  const [supabase] = useState(() => createClient());

  const { config, thresholds, entry } = resolved;
  const exerciseSlug = resolved.slug;

  /**
   * The signal the movement is counted on.
   *
   * `resolved.signal` is null for the four exercises the scoring engine has no config for, because no source states
   * which segments carry their movement. They are still worth doing and still worth counting, so counting falls back
   * to the knee bend — the same signal Heel Slide uses and the most defensible default for lower-limb work — rather
   * than showing a repetition counter that can never move. The summary records exactly what was counted, so a reader
   * can see that this one was a fallback and not a stated measurement.
   */
  const signal: FlexionSignal = config ? (resolved.signal ?? KNEE_SIGNAL) : KNEE_SIGNAL;
  const signalStated = resolved.signal !== null;

  // Sensors the chosen signal needs. Heel Slide needed all three; an ankle pump needs shank and foot, and a
  // straight leg raise needs only the thigh. Gating on all three would refuse a session a patient could do.
  const requiredRoles = useMemo<SensorRole[]>(() => signalRoles(signal), [signal]);
  const visionJoint = useMemo(() => visionJointFor(exerciseSlug), [exerciseSlug]);

  const [mode, setMode] = useState<InputMode | null>(null);
  const [stage, setStage] = useState<Stage>("choosing");
  const [countdown, setCountdown] = useState(SETTLE_SECONDS);
  const [reps, setReps] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState(false);
  const [liveAngle, setLiveAngle] = useState(0);

  const stageRef = useRef<Stage>("choosing");
  stageRef.current = stage;
  const armedRef = useRef(false);
  const lastAngleRef = useRef(0);
  const clockOffsetRef = useRef(0);
  const segmentsRef = useRef<{ startMs: number; endMs: number; peakValue: number }[]>([]);
  const cameraConfidenceRef = useRef<number | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // One orienter and one pairer per mounted screen. The orienter takes the zero over the first half second after
  // arming and then reports every sample relative to it, bend positive — the same seam Heel Slide uses.
  const pipelineRef = useRef<{ pairer: ProxyPairer; orienter: ProxyOrienter } | null>(null);
  if (pipelineRef.current === null) {
    pipelineRef.current = { pairer: createSignalPairer(signal), orienter: createProxyOrienter() };
  }

  /**
   * The repetition counter for an exercise the scoring engine has no config for. ONE counter runs per session: an
   * exercise WITH a config is counted by the scoring engine's RepDetector (inside useLiveScoring) so the count and
   * the score can never disagree, and an exercise WITHOUT one is counted here by the same hysteresis counter Heel
   * Slide ships with. Running both would give two different numbers for one movement.
   */
  const fallbackCounterRef = useRef<RepCounter | null>(null);
  if (fallbackCounterRef.current === null && config === null) {
    fallbackCounterRef.current = createRepCounter(thresholds);
  }
  const fallbackCountRef = useRef(0);
  const fallbackSegmentsRef = useRef<{ startMs: number; endMs: number; peakValue: number }[]>([]);

  const clearSettle = useCallback(() => {
    if (settleTimerRef.current !== null) clearInterval(settleTimerRef.current);
    settleTimerRef.current = null;
  }, []);

  useEffect(() => () => clearSettle(), [clearSettle]);

  /** One measured sample, whatever produced it: orient it, count it, score it. */
  const pushAngle = useCallback(
    (tMs: number, rawDeg: number, quality: SignalQualityReport) => {
      const pipeline = pipelineRef.current;
      if (!pipeline) return;
      const value = pipeline.orienter.push(tMs, rawDeg);
      if (value === null) return; // still filling the zero window
      if (stageRef.current === "settling") return;
      lastAngleRef.current = value;
      if (scoring) {
        scoring.pushSample(tMs, value, quality);
        return;
      }
      const counter = fallbackCounterRef.current;
      if (!counter) return;
      const state = counter.push(tMs, value);
      if (state.justCompleted) {
        fallbackCountRef.current = state.count;
        const segment = counter.segments[counter.segments.length - 1];
        if (segment) {
          fallbackSegmentsRef.current.push({
            startMs: segment.startMs,
            endMs: segment.endMs,
            peakValue: segment.peakValue,
          });
        }
      }
    },
    [scoring],
  );

  // — sensors ————————————————————————————————————————————————————————————————————————

  const onFrame = useCallback(
    (role: SensorRole, frame: ParsedWt901Frame, receivedAtMs: number) => {
      if (!armedRef.current || mode !== "sensors") return;
      recorder.recordFrame(role, frame, receivedAtMs);
      const pipeline = pipelineRef.current;
      if (!pipeline) return;
      const pair = pipeline.pairer.push(role, receivedAtMs, proxyPitchDeg(frame.eulerDegrees));
      if (!pair) return;
      pushAngle(pair.tMs, pair.relativeDeg, recorder.lastQuality() ?? cameraQuality(null));
    },
    [mode, pushAngle, recorder],
  );

  useEffect(() => subscribeFrames(onFrame), [onFrame]);

  // — camera —————————————————————————————————————————————————————————————————————————

  const onVisionSample = useCallback(
    (sample: VisionAngleSample) => {
      cameraConfidenceRef.current = sample.confidence;
      if (!armedRef.current || mode !== "camera") return;
      // The stage's clock is performance.now(); the summary stores receive times in epoch ms, like session_frames.
      pushAngle(sample.tMs + clockOffsetRef.current, sample.deg, cameraQuality(sample.confidence));
    },
    [mode, pushAngle],
  );

  // — the live readout, polled rather than pushed, so 30 Hz of samples never re-render React ——————

  useEffect(() => {
    if (stage !== "counting") return;
    let handle = 0;
    let shownReps = -1;
    let shownAngle = -1;
    const tick = () => {
      const count = scoring ? scoring.reps.filter((rep) => rep.validForVolume).length : fallbackCountRef.current;
      if (count !== shownReps) {
        shownReps = count;
        setReps(count);
      }
      const rounded = Math.round(lastAngleRef.current);
      if (rounded !== shownAngle) {
        shownAngle = rounded;
        setLiveAngle(rounded);
      }
      handle = window.requestAnimationFrame(tick);
    };
    handle = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(handle);
  }, [stage, scoring]);

  // — start and finish ————————————————————————————————————————————————————————————————

  const sensorsReady = requiredRoles.every((role) => live.roles[role].link === "streaming");
  const canBegin = mode === "sensors" ? sensorsReady : mode === "camera" ? cameraReady : false;

  const begin = useCallback(async () => {
    if (!canBegin || stage === "counting") return;
    clockOffsetRef.current = CLOCK_OFFSET_MS();
    pipelineRef.current?.pairer.reset();
    pipelineRef.current?.orienter.reset();
    scoring?.reset();
    segmentsRef.current = [];
    fallbackCounterRef.current = config === null ? createRepCounter(thresholds) : null;
    fallbackCountRef.current = 0;
    fallbackSegmentsRef.current = [];

    if (mode === "sensors") {
      try {
        await recorder.start(sessionId);
      } catch {
        setFinishError(true);
        return;
      }
    }

    setStage("settling");
    setCountdown(SETTLE_SECONDS);
    let left = SETTLE_SECONDS;
    clearSettle();
    settleTimerRef.current = setInterval(() => {
      left -= 1;
      setCountdown(left);
      if (left <= 0) {
        clearSettle();
        armedRef.current = true;
        // The orienter takes its zero from the first half second of samples after this point. The development
        // simulation's scripted movement starts here too, so the zero is taken on a still limb rather than a
        // moving one — the same order HeelSlideExercise uses.
        setStage("counting");
        startSimulatedMovement();
      }
    }, 1000);
  }, [canBegin, clearSettle, config, mode, recorder, scoring, sessionId, stage, thresholds]);

  const finish = useCallback(async () => {
    if (finishing) return;
    setFinishing(true);
    setFinishError(false);
    armedRef.current = false;
    clearSettle();

    const counters = mode === "sensors" ? await recorder.stop() : null;
    const result = scoring?.result ?? null;

    const score: ScoreRecord | null =
      result === null
        ? null
        : scoreRecord(
            result.execution.score,
            {
              score: result.correctnessScore.score,
              weightUsed: result.execution.componentsUsed.correctness ?? null,
              measured: result.correctnessScore.measured,
              abstained: result.correctnessScore.abstained,
            },
            {
              score: result.volumeScore,
              weightUsed: result.execution.componentsUsed.volume ?? null,
              measured: result.volumeScore === null ? [] : ["volume"],
              abstained: result.volumeScore === null ? ["volume"] : [],
            },
            {
              score: result.targetScore.score,
              weightUsed: result.execution.componentsUsed.target ?? null,
              measured: result.targetScore.measured,
              abstained: result.targetScore.abstained,
            },
          );

    const summary = buildExerciseSummary({
      exerciseSlug: resolved.slug,
      inputMode: mode === "sensors" && SIMULATION_ENABLED ? "simulated" : (mode ?? "sensors"),
      repsCounted: result ? result.reps.filter((rep) => rep.validForVolume).length : fallbackCountRef.current,
      targetReps,
      segments: (result
        ? result.reps.map((rep) => ({ startMs: rep.startedAtMs, endMs: rep.endedAtMs, peakValue: rep.peakExcursionDeg }))
        : fallbackSegmentsRef.current
      ).map((rep, index) => ({
        startIndex: index,
        endIndex: index,
        peakIndex: index,
        startMs: rep.startMs,
        endMs: rep.endMs,
        peakMs: rep.endMs,
        peakValue: rep.peakValue,
      })),
      // An exercise with no stated signal says so, rather than letting the fallback read as a measurement choice.
      signalDefinition: signalStated ? signalDefinition(signal) : `${signalDefinition(signal)} (fallback: no signal stated for this exercise)`,
      thresholds,
      maxGapMs: null,
      baselineWindows: pipelineRef.current?.orienter.baselineWindow
        ? [
            {
              start: pipelineRef.current.orienter.baselineWindow.startMs,
              end: pipelineRef.current.orienter.baselineWindow.endMs,
            },
          ]
        : [],
      restartedAfterReload: false,
      sensors: null,
      telemetry: {
        framesConfirmed: counters?.framesConfirmed ?? null,
        pendingAtFinish: counters?.pending ?? null,
        errors: counters?.errors ?? null,
        dropped: counters?.framesDropped ?? null,
      },
      score,
    });

    const { error } = await supabase.rpc("finish_prescribed_session", { p_session: sessionId, p_summary: summary });
    if (error && error.code !== "55000") {
      setFinishing(false);
      setFinishError(true);
      return;
    }
    if (mode === "sensors") await disconnectAll();
    setStage("finished");
    router.replace(stepHref(sessionId, "checkIn"));
  }, [
    clearSettle,
    finishing,
    mode,
    recorder,
    resolved.slug,
    router,
    scoring,
    sessionId,
    signal,
    signalStated,
    supabase,
    targetReps,
    thresholds,
  ]);

  // A session that stopped being in progress while this screen was open (Back after finishing) goes on rather than
  // letting «Завершить» act on it. The server refuses too (55000), so a failed read is not fatal.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.from("sessions").select("status").eq("id", sessionId).maybeSingle();
      if (cancelled || !data) return;
      const route = exerciseRouteFor(String(data.status));
      if (route === "checkIn") router.replace(stepHref(sessionId, "checkIn"));
      else if (route === "summary") router.replace(stepHref(sessionId, "summary"));
    })();
    return () => {
      cancelled = true;
    };
  }, [router, sessionId, supabase]);

  // — rendering ——————————————————————————————————————————————————————————————————————

  const stageMessage = (() => {
    if (stage === "choosing") return t("flow.exercise.stage.genericWaiting");
    if (stage === "waiting") return t("flow.exercise.stage.genericWaiting");
    if (stage === "settling") return t("flow.exercise.stage.settling", { n: Math.max(countdown, 0) });
    if (stage === "finished") return t("flow.exercise.stage.finishing");
    return liveAngle >= thresholds.enterDeg
      ? t("flow.exercise.stage.genericMoving")
      : t("flow.exercise.stage.genericRest");
  })();

  const missing = requiredRoles.filter((role) => live.roles[role].link !== "streaming");

  return (
    <div className="space-y-6">
      {mode === null ? (
        <section className={cn(card, "p-5 sm:p-6")} aria-labelledby="input-mode-title">
          <h2 id="input-mode-title" className={sectionTitle}>
            {t("flow.exercise.input.title")}
          </h2>
          <p className={cn("mt-2", bodyText)}>{t("flow.exercise.input.lead")}</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <ModeChoice
              icon={Cpu}
              title={t("flow.exercise.input.sensors")}
              hint={t("flow.exercise.input.sensorsHint")}
              onClick={() => {
                setMode("sensors");
                setStage("waiting");
              }}
            />
            <ModeChoice
              icon={Camera}
              title={t("flow.exercise.input.camera")}
              hint={t("flow.exercise.input.cameraHint")}
              disabled={visionJoint === null}
              disabledHint={t("flow.exercise.input.cameraNoJoint")}
              onClick={() => {
                setMode("camera");
                setStage("waiting");
              }}
            />
          </div>
        </section>
      ) : null}

      {mode !== null ? (
        <>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="space-y-6">
              {mode === "camera" ? (
                <ExerciseVisionStage
                  joint={visionJoint}
                  side={side ?? "right"}
                  facing="environment"
                  targetDeg={config?.targetValueDeg ?? null}
                  label={exerciseName ?? undefined}
                  onSample={onVisionSample}
                  onStatusChange={(status) => setCameraReady(status === "running")}
                />
              ) : (
                <SensorConnectPanel patientId={patientId} side={side} savedDevices={savedDevices} />
              )}

              <section className={cn(card, "p-5 sm:p-6")} aria-live="polite">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className={tileLabel}>{t("flow.exercise.repsTitle")}</div>
                    <div className="mt-1 font-mono text-5xl leading-none tabular-nums text-ink">
                      {reps}
                      {targetReps ? <span className="text-2xl text-ink-faint"> / {targetReps}</span> : null}
                    </div>
                  </div>
                  <GhostTrajectory
                    currentAngleDeg={liveAngle}
                    targetDeg={config?.targetValueDeg ?? null}
                    minValidExcursionDeg={thresholds.enterDeg}
                    className="h-24 w-40 shrink-0"
                  />
                </div>
                <p className={cn("mt-4", bodyText)}>{stageMessage}</p>
                {mode === "sensors" && stage === "counting" && missing.length > 0 ? (
                  <p className="mt-2 flex items-start gap-2 text-[15px] leading-snug text-ink-soft">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-signal-deep" aria-hidden="true" />
                    {t("flow.exercise.pauseSensor", { sensor: t(`sensors.role.${missing[0]}`) })}
                  </p>
                ) : null}
                <p className="mt-3 text-[13px] leading-snug text-ink-faint">
                  {mode === "camera" ? t("vision.caption") : t("flow.exercise.guideCaption")}
                </p>
              </section>

              {scoring?.liveCue ? (
                <LiveCuePanel cue={scoring.liveCue} signal={mode === "sensors" ? recorder.lastQuality() : null} />
              ) : null}

              {/* ScorePanel sizes its four tiles on the viewport breakpoint, so it needs the full column rather
                  than the sidebar: at 20rem it lays four tiles across 320px and clips its own labels. */}
              {config && scoring ? (
                <ScorePanel
                  config={config}
                  result={scoring.result}
                  signal={mode === "sensors" ? recorder.lastQuality() : null}
                />
              ) : (
                <p className={cn(card, "p-5", bodyText, "text-[15px]")}>{t("flow.exercise.notScored")}</p>
              )}

              <div className="flex flex-wrap gap-3">
                {stage === "waiting" || stage === "choosing" ? (
                  <button type="button" className={primaryButton} onClick={() => void begin()} disabled={!canBegin}>
                    {t("flow.exercise.beginGeneric")}
                  </button>
                ) : null}
                {stage === "counting" || stage === "settling" ? (
                  <button type="button" className={primaryButton} onClick={() => void finish()} disabled={finishing}>
                    {finishing ? (
                      <>
                        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                        {t("flow.exercise.finishing")}
                      </>
                    ) : (
                      t("flow.exercise.finishGeneric")
                    )}
                  </button>
                ) : null}
                <button
                  type="button"
                  className={secondaryButton}
                  onClick={() => {
                    setMode(null);
                    setStage("choosing");
                    armedRef.current = false;
                  }}
                  disabled={stage === "counting" || finishing}
                >
                  {t("flow.exercise.input.change")}
                </button>
              </div>

              {!canBegin && (stage === "waiting" || stage === "choosing") ? (
                <p className={cn(bodyText, "text-[15px]")}>
                  {mode === "sensors" ? t("flow.exercise.beginBlockedSensors") : t("flow.exercise.beginBlockedCamera")}
                </p>
              ) : null}

              {finishError ? (
                <p role="alert" className="text-[15px] leading-snug text-ink">
                  {t("flow.exercise.finishFailed")}
                </p>
              ) : null}
            </div>

            <aside className="space-y-6">
              <section className={cn(card, "overflow-hidden")}>
                <h2 className={cn(cardTitle, "px-5 pt-5")}>{exerciseName ?? t("flow.untitledExercise")}</h2>
                <div className="p-5">
                  {resolved.video ? (
                    <ReferenceVideo
                      videoUrl={resolved.video}
                      poster={resolved.poster}
                      name={exerciseName ?? resolved.slug}
                    />
                  ) : (
                    <p className={cn(bodyText, "text-[15px]")}>{t("flow.exercise.noReferenceVideo")}</p>
                  )}
                </div>
              </section>

              {entry && entry.cues.length > 0 ? (
                <section className={cn(card, "p-5")}>
                  <h3 className={tileLabel}>{t("flow.exercise.cuesTitle")}</h3>
                  <ul className="mt-3 space-y-2">
                    {linesIn(entry.cues, locale).map((cue) => (
                      <li key={cue} className="flex items-start gap-2 text-[15px] leading-snug text-ink-soft">
                        <CircleCheck className="mt-0.5 size-4 shrink-0 text-signal-deep" aria-hidden="true" />
                        {cue}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </aside>
          </div>
        </>
      ) : null}
    </div>
  );
}

function ModeChoice({
  icon: Icon,
  title,
  hint,
  onClick,
  disabled = false,
  disabledHint,
}: {
  icon: typeof Camera;
  title: string;
  hint: string;
  onClick: () => void;
  disabled?: boolean;
  disabledHint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex min-h-28 flex-col items-start gap-2 rounded-card border border-line bg-card p-4 text-left transition-colors",
        disabled ? "cursor-not-allowed opacity-60" : "hover:border-signal-deep hover:bg-paper-soft",
      )}
    >
      <Icon className="size-5 text-signal-deep" aria-hidden="true" />
      <span className="text-base font-medium text-ink">{title}</span>
      <span className="text-[14px] leading-snug text-ink-soft">{disabled ? (disabledHint ?? hint) : hint}</span>
    </button>
  );
}
