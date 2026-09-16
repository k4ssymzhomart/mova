"use client";

// ExerciseStudio — the real BLE-driven exercise screen for the 8 knee-rehab exercises. Successor to
// SessionStudio.tsx for this exercise family: SessionStudio remains in place for the camera/MediaPipe
// reach + gait flow (stroke / Parkinson's patients), which this does not touch or replace. Wires
// together, on one screen (NTZ §16.1): the reference video, real per-role sensor status, calibration,
// the live rep/score loop (lib/scoring/), a single prioritized cue, sets/rest/pause, and the post-session
// reward — all driven by real WT901BLE68 frames, never a fabricated number.

import { Loader2, Maximize2, Minimize2, Square } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import SessionReward, { type SessionRewardData } from "@/components/gamification/SessionReward";
import CalibrationStep from "@/components/session/CalibrationStep";
import GhostTrajectory from "@/components/session/GhostTrajectory";
import LiveCuePanel from "@/components/session/LiveCuePanel";
import PostSessionCheckin from "@/components/session/PostSessionCheckin";
import ReferenceVideo from "@/components/session/ReferenceVideo";
import ScorePanel from "@/components/session/ScorePanel";
import SensorStatusRail from "@/components/session/SensorStatusRail";
import SetsRestPanel, { type PauseReason } from "@/components/session/SetsRestPanel";
import { Panel, PillButton } from "@/components/session/ui";
import { SENSOR_ROLE_ORDER, type SensorRole, type Side } from "@/lib/ble/roles";
import { LEVEL_SCORE, MIN_CALIBRATION_SECONDS, type SignalQualityReport } from "@/lib/ble/signalQuality";
import { SignalQualityMonitor } from "@/lib/ble/signalQualityMonitor";
import { useSensorConnect } from "@/lib/ble/useSensorConnect";
import type { ParsedWt901Frame } from "@/lib/ble/wt901ble68";
import { CalibrationCapture, type CalibrationBaseline } from "@/lib/scoring/calibration";
import { getExerciseConfig } from "@/lib/scoring/exerciseConfigs";
import { computeJointAngle } from "@/lib/scoring/jointAngle";
import type { ExerciseSlug } from "@/lib/scoring/types";
import { useLiveScoring } from "@/lib/scoring/useLiveScoring";
import { createClient } from "@/lib/supabase/client";
import { TelemetryBuffer } from "@/lib/telemetry/buffer";
import { cn } from "@/lib/utils";

type Phase = "pick_side" | "connect" | "calibrating" | "training" | "resting" | "finished";
const TICK_MS = 150;
const REST_SEC = 30;

export default function ExerciseStudio({
  sessionId,
  exerciseSlug,
  exerciseName,
  demoVideoUrl,
  patientId,
  affectedSide,
  pairedDeviceNames,
  prescribedRepsPerSet,
  totalSets,
}: {
  sessionId: string;
  exerciseSlug: ExerciseSlug;
  exerciseName: string;
  demoVideoUrl: string | null;
  patientId: string | null;
  affectedSide: Side | null;
  pairedDeviceNames: Partial<Record<SensorRole, string | null>>;
  prescribedRepsPerSet: number;
  totalSets: number;
}) {
  const config = getExerciseConfig(exerciseSlug);
  const supabase = createClient();

  const [side, setSide] = useState<Side | null>(affectedSide);
  const [phase, setPhase] = useState<Phase>(affectedSide ? "connect" : "pick_side");
  const [paused, setPaused] = useState(false);
  const [pauseReason, setPauseReason] = useState<PauseReason | null>(null);
  const [currentSet, setCurrentSet] = useState(1);
  const [restRemainingSec, setRestRemainingSec] = useState(REST_SEC);
  const [quality, setQuality] = useState<SignalQualityReport | null>(null);
  const [calibrationProgress01, setCalibrationProgress01] = useState(0);
  const [baseline, setBaseline] = useState<CalibrationBaseline | null>(null);
  const [liveAngle, setLiveAngle] = useState(0);
  const [receivingData, setReceivingData] = useState<Record<SensorRole, boolean>>({ thigh: false, shank: false, foot: false });
  const [focus, setFocus] = useState(false);
  const [reward, setReward] = useState<SessionRewardData | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [checkinDone, setCheckinDone] = useState(false);

  const latestFramesRef = useRef<Partial<Record<SensorRole, ParsedWt901Frame>>>({});
  const monitorRef = useRef(new SignalQualityMonitor());
  const calibrationRef = useRef(new CalibrationCapture());
  const streamerRef = useRef<TelemetryBuffer | null>(null);
  const seqRef = useRef(0);
  const repsAtSetStartRef = useRef(0);
  const calibrationStartRef = useRef<number | null>(null);
  const pauseEventsRef = useRef<{ reason: PauseReason; atMs: number }[]>([]);
  const stageRef = useRef<HTMLDivElement>(null);

  const calibrationBaselineAbsoluteDeg =
    exerciseSlug === "short_arc_quad" ? baseline?.perRole[config.primarySensorRoles[0]]?.[1] : undefined;
  const scoring = useLiveScoring(config, prescribedRepsPerSet * totalSets, calibrationBaselineAbsoluteDeg);

  const onFrame = useCallback((role: SensorRole, frame: ParsedWt901Frame) => {
    latestFramesRef.current[role] = frame;
    setReceivingData((s) => (s[role] ? s : { ...s, [role]: true }));
    monitorRef.current.push(role, {
      ax: frame.accelerometerRaw[0],
      ay: frame.accelerometerRaw[1],
      az: frame.accelerometerRaw[2],
      gx: frame.gyroscopeRaw[0],
      gy: frame.gyroscopeRaw[1],
      gz: frame.gyroscopeRaw[2],
    });
  }, []);

  const { statuses, connect, connectedCount, bleSupported } = useSensorConnect(patientId, side, pairedDeviceNames, onFrame);

  const requiredConnected = config.primarySensorRoles.every((r) => statuses[r] === "connected");

  // connect -> calibrating once every required sensor is paired.
  useEffect(() => {
    if (phase === "connect" && requiredConnected) {
      calibrationRef.current.reset();
      calibrationStartRef.current = Date.now();
      setPhase("calibrating");
    }
  }, [phase, requiredConnected]);

  // Start the telemetry buffer once, for the life of this exercise attempt.
  useEffect(() => {
    const buffer = new TelemetryBuffer(sessionId);
    streamerRef.current = buffer;
    void buffer.start();
    return () => {
      void buffer.stop();
    };
  }, [sessionId]);

  // Re-baseline every set, not just once per session, to bound onboard-fusion drift (jointAngle.ts).
  useEffect(() => {
    if (baseline) scoring.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseline]);

  // The main tick: evaluate signal quality, drive calibration or the live scoring loop.
  useEffect(() => {
    if (phase !== "connect" && phase !== "calibrating" && phase !== "training") return;
    const id = window.setInterval(() => {
      const now = Date.now();
      const report = monitorRef.current.evaluate();
      setQuality(report);

      if (phase === "calibrating") {
        for (const role of config.primarySensorRoles) {
          const frame = latestFramesRef.current[role];
          if (frame) calibrationRef.current.push(role, now, frame);
        }
        const elapsedSec = calibrationStartRef.current ? (now - calibrationStartRef.current) / 1000 : 0;
        setCalibrationProgress01(Math.min(1, elapsedSec / MIN_CALIBRATION_SECONDS));
        const ready = calibrationRef.current.isReady(now, config.primarySensorRoles);
        if (ready) {
          const b = calibrationRef.current.getBaseline(now, config.primarySensorRoles);
          if (b) {
            setBaseline(b);
            repsAtSetStartRef.current = scoring.reps.length;
            setPhase("training");
          }
        }
        return;
      }

      if (phase === "training") {
        if (paused || !baseline) return;
        const angle = computeJointAngle(config, latestFramesRef.current, baseline);
        setLiveAngle(angle ?? 0);
        scoring.pushSample(now, angle, report);

        seqRef.current += 1;
        streamerRef.current?.pushFrame({
          recorded_at: new Date(now).toISOString(),
          seq: seqRef.current,
          joint_angles: angle !== null ? { relative_knee: Math.round(angle * 10) / 10 } : null,
          imu: { signal_quality_level: report.level, per_role: latestFramesRef.current },
          quality: LEVEL_SCORE[report.level],
        });

        const repsThisSet = scoring.reps.length - repsAtSetStartRef.current;
        if (repsThisSet >= prescribedRepsPerSet) {
          if (currentSet < totalSets) {
            setRestRemainingSec(REST_SEC);
            setPhase("resting");
          } else {
            void finish();
          }
        }
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, TICK_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, paused, baseline, currentSet]);

  // Rest countdown -> next set.
  useEffect(() => {
    if (phase !== "resting") return;
    const id = window.setInterval(() => {
      setRestRemainingSec((s) => {
        if (s <= 1) {
          calibrationRef.current.reset();
          calibrationStartRef.current = Date.now();
          setCurrentSet((n) => n + 1);
          setPhase("calibrating");
          return REST_SEC;
        }
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  function togglePause() {
    setPaused((p) => {
      const next = !p;
      if (next) {
        // entering pause with no reason yet — recorded once the patient picks one below
      } else {
        setPauseReason(null);
      }
      return next;
    });
  }

  function pickPauseReason(reason: PauseReason) {
    setPauseReason(reason);
    pauseEventsRef.current.push({ reason, atMs: Date.now() });
  }

  async function enterFocus() {
    try {
      await stageRef.current?.requestFullscreen?.();
      setFocus(true);
    } catch {
      /* fullscreen is best-effort */
    }
  }
  async function exitFocus() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch {
      /* ignore */
    }
    setFocus(false);
  }
  useEffect(() => {
    const onChange = () => setFocus(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const finish = useCallback(async () => {
    if (finishing) return;
    setFinishing(true);
    await exitFocus();
    await streamerRef.current?.stop();
    const result = scoring.result;
    try {
      await supabase.rpc("finish_training_session", {
        p_session: sessionId,
        p_summary: {
          source: "exercise-studio",
          exercise_slug: exerciseSlug,
          side,
          sets: totalSets,
          pause_events: pauseEventsRef.current,
        },
        p_metrics: {
          reps: result.reps.filter((r) => r.validForVolume).length,
          rom_max: result.romMaxDeg,
          rom_mean: result.romMeanDeg,
          smoothness: result.reps.length
            ? Math.round((result.reps.reduce((a, r) => a + r.smoothness01, 0) / result.reps.length) * 100) / 100
            : null,
          quality_score: result.executionEffectiveness / 100,
          adherence: 1,
          volumeScore: result.volumeScore,
          targetScore: result.targetScore,
          correctnessScore: result.correctnessScore,
          targetReachedCount: result.targetReachedCount,
          frozen: result.frozen,
          frozenReasons: result.frozenReasons,
        },
      });
      const { data } = await supabase.rpc("award_session_rewards", { p_session: sessionId });
      if (data) setReward(data as SessionRewardData);
    } catch {
      /* best-effort rewards, same as the camera/gait flow */
    }
    setPhase("finished");
    setFinishing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishing, sessionId, exerciseSlug, side, totalSets]);

  // ---- render -----------------------------------------------------------------

  if (phase === "pick_side") {
    return (
      <Panel label="Какая нога?">
        <div className="flex justify-center gap-3 py-4">
          <PillButton onClick={() => { setSide("left"); setPhase("connect"); }}>Левая</PillButton>
          <PillButton onClick={() => { setSide("right"); setPhase("connect"); }}>Правая</PillButton>
        </div>
      </Panel>
    );
  }

  if (!bleSupported) {
    return (
      <Panel label={exerciseName}>
        <p className="text-sm text-ink-soft">
          Web Bluetooth не поддерживается в этом браузере. Откройте страницу в Chrome или Edge на компьютере
          или Android.
        </p>
      </Panel>
    );
  }

  if (phase === "finished") {
    if (!checkinDone) {
      return <PostSessionCheckin sessionId={sessionId} onDone={() => setCheckinDone(true)} />;
    }
    return (
      <div className="space-y-4">
        <Link href="/app" className="text-sm text-ink-soft transition-colors hover:text-ink">
          Все тренировки
        </Link>
        {reward && <SessionReward reward={reward} onRestart={() => window.location.assign("/app/session/new")} />}
        <ScorePanel config={config} result={scoring.result} signal={quality} />
      </div>
    );
  }

  return (
    <div ref={stageRef} className={cn("space-y-4", focus && "bg-night p-6")}>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl text-ink">{exerciseName}</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => (focus ? exitFocus() : enterFocus())}
            className="grid size-9 place-items-center rounded-full text-ink-faint transition-colors hover:bg-paper-soft hover:text-ink"
            aria-label={focus ? "Выйти из полноэкранного режима" : "Полноэкранный режим"}
          >
            {focus ? <Minimize2 className="size-4" strokeWidth={1.8} /> : <Maximize2 className="size-4" strokeWidth={1.8} />}
          </button>
          <button
            type="button"
            onClick={finish}
            disabled={finishing}
            className="inline-flex items-center gap-2 rounded-pill border border-line px-4 py-2 text-sm text-ink transition-colors hover:bg-paper-soft disabled:opacity-50"
          >
            {finishing ? <Loader2 className="size-4 animate-spin" strokeWidth={1.8} /> : <Square className="size-4" strokeWidth={1.8} />}
            Завершить
          </button>
        </div>
      </div>

      <ReferenceVideo videoUrl={demoVideoUrl} name={exerciseName} />

      <SensorStatusRail statuses={statuses} receivingData={receivingData} quality={quality} />

      {phase === "connect" && (
        <CalibrationStep
          requiredRoles={config.primarySensorRoles}
          connectedRoles={SENSOR_ROLE_ORDER.filter((r) => statuses[r] === "connected")}
          progress01={0}
          onConnectMissing={connect}
        />
      )}

      {phase === "calibrating" && (
        <CalibrationStep
          requiredRoles={config.primarySensorRoles}
          connectedRoles={SENSOR_ROLE_ORDER.filter((r) => statuses[r] === "connected")}
          progress01={calibrationProgress01}
          onConnectMissing={connect}
        />
      )}

      {(phase === "training" || phase === "resting") && (
        <>
          <SetsRestPanel
            currentSet={currentSet}
            totalSets={totalSets}
            repsThisSet={scoring.reps.length - repsAtSetStartRef.current}
            prescribedRepsPerSet={prescribedRepsPerSet}
            phase={phase === "resting" ? "resting" : "training"}
            restRemainingSec={restRemainingSec}
            paused={paused}
            pauseReason={pauseReason}
            onPauseToggle={togglePause}
            onPauseReason={pickPauseReason}
          />

          {!paused && phase === "training" && (
            <>
              <GhostTrajectory
                currentAngleDeg={liveAngle}
                targetDeg={config.targetValueDeg}
                minValidExcursionDeg={config.minValidExcursionDeg}
              />
              <LiveCuePanel cue={scoring.liveCue} signal={quality} />
              <ScorePanel config={config} result={scoring.result} signal={quality} />
            </>
          )}
        </>
      )}
    </div>
  );
}
