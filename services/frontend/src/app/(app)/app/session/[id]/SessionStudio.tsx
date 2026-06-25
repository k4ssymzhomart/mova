"use client";

// SessionStudio — the single, authenticated training surface. It encapsulates the full on-device engine
// (MediaPipe pose -> virtual-IMU -> ONNX FoG/HAR), the gamified reaching/gait stages, personalization
// from the intake profile, AND the Supabase-backed session: it streams derived telemetry into
// session_frames/fog_events as you train, then on finish scores the session (finish_training_session)
// and awards XP/streak/badges (award_session_rewards). Keyed to the session id created upstream
// (/app/session/new). Replaces the old standalone /session + the capture-only LiveCapturePanel.

import { Loader2, Maximize2, Minimize2, Play, Square } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import SessionInsightsCoach from "@/components/session/SessionInsightsCoach";
import PoseStage, { type SessionMode, type StageStats } from "@/components/session/PoseStage";
import SessionReward, { type SessionRewardData } from "@/components/gamification/SessionReward";
import SessionTelemetry from "@/components/session/SessionTelemetry";
import { Metric, Panel, PillButton, Toggle } from "@/components/session/ui";
import { POSE_LANDMARKS, type Landmark } from "@/lib/cv/landmarks";
import { VirtualImuPipeline } from "@/lib/cv/imuWindow";
import { useMediaPipePose } from "@/lib/cv/useMediaPipePose";
import type { GaitStats } from "@/lib/game/gait";
import type { ReachingStats } from "@/lib/game/reaching";
import { computeInsights } from "@/lib/insights/engine";
import { loadSessions, makeId, saveSession } from "@/lib/insights/store";
import type { SessionRecord, Side } from "@/lib/insights/types";
import { type LivePrediction, useLiveInference } from "@/lib/onnx/useLiveInference";
import { useTranslation } from "@/locales/client";
import { abilityFor, loadProfile, startingCadence } from "@/lib/profile/store";
import type { PatientProfile } from "@/lib/profile/types";
import { createClient } from "@/lib/supabase/client";
import { FogEpisodeDetector } from "@/lib/telemetry/fogEpisodes";
import { type BufferCounters, TelemetryBuffer } from "@/lib/telemetry/buffer";
import { cn } from "@/lib/utils";

const INFER_MS = 600;
const CH = 6;
const ZERO_REACH: ReachingStats = { score: 0, attempts: 0, lastReachMs: null };
const ZERO_GAIT: GaitStats = {
  steps: 0, beats: 0, cadenceSpm: 0, rhythmPct: 0, currentStreak: 0, bestStreak: 0, lastErrMs: null,
};

function downsample(values: number[], n: number): number[] {
  if (values.length <= n) return values.map((v) => Math.round(v * 1000) / 1000);
  const out: number[] = [];
  const bucket = values.length / n;
  for (let i = 0; i < n; i += 1) {
    const a = Math.floor(i * bucket);
    const b = Math.floor((i + 1) * bucket);
    let s = 0;
    for (let k = a; k < b; k += 1) s += values[k];
    out.push(Math.round((s / Math.max(1, b - a)) * 1000) / 1000);
  }
  return out;
}

export default function SessionStudio({ sessionId, userId }: { sessionId: string; userId: string }) {
  const { t } = useTranslation();
  const pipeline = useRef(new VirtualImuPipeline());
  const sideRef = useRef<Side>("right");
  const modeRef = useRef<SessionMode>("reach");
  const pose = useMediaPipePose({ onFrame: (f) => pipeline.current.push(f.worldLandmarks, f.timestampMs) });
  const live = useLiveInference();
  const liveRef = useRef(live);
  liveRef.current = live;
  const stageRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [supabase] = useState(() => createClient());
  const [mode, setMode] = useState<SessionMode>("reach");
  const [side, setSide] = useState<Side>("right");
  const [tempoSpm, setTempoSpm] = useState(67);
  const [showVideo, setShowVideo] = useState(false);
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [reach, setReach] = useState<ReachingStats>(ZERO_REACH);
  const [gait, setGait] = useState<GaitStats>(ZERO_GAIT);
  const [prediction, setPrediction] = useState<LivePrediction | null>(null);
  const [fill, setFill] = useState(0);
  const [inferences, setInferences] = useState(0);
  const [counters, setCounters] = useState<BufferCounters>({ framesSent: 0, eventsSent: 0, pending: 0, errors: 0, lastError: null });
  const [finishing, setFinishing] = useState(false);
  const [reward, setReward] = useState<SessionRewardData | null>(null);
  const [summary, setSummary] = useState<{ record: SessionRecord; history: SessionRecord[] } | null>(null);

  // accumulators + stream
  const streamer = useRef<TelemetryBuffer | null>(null);
  const detector = useRef<FogEpisodeDetector | null>(null);
  const seq = useRef(0);
  const startedAt = useRef(0);
  const prevScore = useRef(0);
  const reachTimes = useRef<number[]>([]);
  const gaitRef = useRef<GaitStats>(ZERO_GAIT);
  const fogAccum = useRef({ sum: 0, n: 0 });
  const fogSamples = useRef<number[]>([]);
  const harCounts = useRef<Record<string, number>>({});

  const running = pose.status === "running";
  const difficulty = abilityFor(profile, mode);

  useEffect(() => {
    const p = loadProfile(userId);
    if (!p) return;
    setProfile(p);
    setMode(p.recommendedPack === "gait" ? "gait" : "reach");
    setTempoSpm(startingCadence(p));
    if (p.affectedSide !== "bilateral") setSide(p.affectedSide);
  }, [userId]);
  useEffect(() => { sideRef.current = side; pipeline.current.side = side; }, [side]);
  useEffect(() => { modeRef.current = mode; pipeline.current.segment = mode === "gait" ? "shank" : "forearm"; }, [mode]);

  const onStats = useCallback((s: StageStats) => {
    if (s.mode === "gait") { setGait(s.gait); gaitRef.current = s.gait; }
    else {
      setReach(s.reach);
      if (s.reach.score > prevScore.current && s.reach.lastReachMs != null) reachTimes.current.push(s.reach.lastReachMs);
      prevScore.current = s.reach.score;
    }
  }, []);

  // Focus mode — drive the native Fullscreen API off the camera stage so the rail + header chrome
  // disappear entirely while recording. Esc or the overlay's "Exit focus" button drops focus mode
  // without ending the session; Finish/Stop tears it down explicitly.
  const enterFocus = useCallback(() => {
    const el = stageRef.current;
    if (!el || document.fullscreenElement) return;
    // Fired from the Start click, so it's a valid user gesture. A blocked request is non-fatal —
    // the session still runs windowed.
    void el.requestFullscreen?.().catch(() => {});
  }, []);
  const exitFocus = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
  }, []);
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  // Never leave the document stuck in fullscreen when the studio unmounts (e.g. route change).
  useEffect(() => () => { if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {}); }, []);

  const start = useCallback(async () => {
    enterFocus();
    setReward(null);
    setSummary(null);
    prevScore.current = 0;
    reachTimes.current = [];
    gaitRef.current = ZERO_GAIT;
    fogAccum.current = { sum: 0, n: 0 };
    fogSamples.current = [];
    harCounts.current = {};
    seq.current = 0;
    setReach(ZERO_REACH);
    setGait(ZERO_GAIT);
    setInferences(0);
    setPrediction(null);
    setCounters({ framesSent: 0, eventsSent: 0, pending: 0, errors: 0, lastError: null });
    pipeline.current.reset();
    streamer.current = new TelemetryBuffer(sessionId, setCounters);
    await streamer.current.start();
    detector.current = new FogEpisodeDetector({ source: "fog.onnx" });
    startedAt.current = Date.now();
    void liveRef.current.loadAll();
    await pose.start();
  }, [pose, sessionId, enterFocus]);

  // Inference + stream loop.
  useEffect(() => {
    if (!running) return;
    let alive = true;
    const id = window.setInterval(async () => {
      const now = performance.now();
      const cover = pipeline.current.fill(now);
      setFill(cover);
      const l = liveRef.current;
      if (l.status !== "ready") return;
      const raw = pipeline.current.window(now);
      if (!raw) return;
      const pred = await l.infer(raw, modeRef.current, sideRef.current);
      if (!alive || !pred) return;
      setPrediction(pred);
      setInferences((c) => c + 1);

      const lm = pose.latest.current;
      const wall = Date.now();
      const s = streamer.current;
      if (s) {
        s.pushFrame({
          recorded_at: new Date(wall).toISOString(),
          seq: seq.current++,
          joint_angles: jointAngles(lm, sideRef.current),
          keypoints: snapshotKeypoints(lm),
          imu: {
            ...imuSummary(raw),
            fog_risk: pred.fog ? round(pred.fog.risk, 4) : null,
            fog_valid: pred.fog?.valid ?? false,
            har_label: pred.har?.label ?? null,
            mode: pred.mode,
            side: sideRef.current,
            simulated: pred.simulated ?? false,
          },
          quality: round(cover, 3),
        });
      }
      if (pred.fog) {
        fogAccum.current.sum += pred.fog.risk;
        fogAccum.current.n += 1;
        fogSamples.current.push(pred.fog.risk);
        const ep = detector.current?.update(pred.fog.risk, pred.fog.valid, wall);
        if (ep && s) s.pushEvent(ep);
      }
      if (pred.har) harCounts.current[pred.har.label] = (harCounts.current[pred.har.label] ?? 0) + 1;
    }, INFER_MS);
    return () => { alive = false; window.clearInterval(id); };
  }, [running, pose.latest]);

  const finish = useCallback(async () => {
    exitFocus();
    setFinishing(true);
    pose.stop();
    const m = modeRef.current;
    const now = Date.now();
    const durationSec = Math.max(0, Math.round((now - (startedAt.current || now)) / 1000));
    const harTop = Object.entries(harCounts.current).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const fogRiskMean = fogAccum.current.n ? fogAccum.current.sum / fogAccum.current.n : null;
    const rt = reachTimes.current;
    const g = gaitRef.current;
    const record: SessionRecord = {
      id: makeId(),
      startedAt: startedAt.current || now,
      endedAt: now,
      exercise: m === "gait" ? "gait" : "reaching",
      side: sideRef.current,
      durationSec,
      reaches: m === "gait" ? 0 : reach.score,
      attempts: m === "gait" ? g.beats : reach.attempts,
      reachMs: { mean: rt.length ? Math.round(rt.reduce((a, b) => a + b, 0) / rt.length) : 0, best: rt.length ? Math.min(...rt) : 0 },
      gait: m === "gait" ? { steps: g.steps, beats: g.beats, cadenceSpm: g.cadenceSpm, rhythmPct: g.rhythmPct, bestStreak: g.bestStreak } : undefined,
      fogRiskMean,
      fogSeries: downsample(fogSamples.current, 48),
      fogValid: m === "gait",
      harTop,
      inferenceCount: inferences,
    };
    saveSession(record, userId);
    setSummary({ record, history: loadSessions(userId) });

    // Close any open FoG episode, flush the buffer, then score + award on the backend.
    const ep = detector.current?.finalize(now);
    if (ep) streamer.current?.pushEvent(ep);
    await streamer.current?.stop(); // awaited final flush — no trailing frames lost
    const quality = m === "gait" ? (g.steps ? g.rhythmPct : null) : reach.attempts > 0 ? reach.score / reach.attempts : null;
    try {
      await supabase.rpc("finish_training_session", {
        p_session: sessionId,
        p_summary: { source: "session-studio", mode: m, side: sideRef.current, duration_s: durationSec },
        p_metrics: { reps: m === "gait" ? g.steps : reach.score, quality_score: quality, fog_risk: fogRiskMean, adherence: 1 },
      });
      const { data } = await supabase.rpc("award_session_rewards", { p_session: sessionId });
      if (data) setReward(data as SessionRewardData);
    } catch {
      /* best-effort rewards */
    }
    setFinishing(false);
  }, [pose, sessionId, supabase, reach.score, reach.attempts, inferences, exitFocus]);

  // Post-session view
  if (summary) {
    return (
      <div className="space-y-2">
        <Link href="/app" className="text-sm text-ink-soft transition-colors hover:text-ink">{t("session.allSessions")}</Link>
        {reward ? (
          <SessionReward reward={reward} onRestart={() => location.assign("/app/session/new")} />
        ) : (
          <div className="mt-8 rounded-xl border border-line bg-card p-6 text-sm text-ink-soft">
            {t("session.sessionSaved")} {finishing ? t("session.scoring") : t("session.rewardsOffline")}
          </div>
        )}
        <SessionInsightsCoach record={summary.record} history={summary.history} />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-signal">
            {mode === "gait" ? t("session.eyebrowGait") : t("session.eyebrowReach")}
          </div>
          <h1 className="mt-2 text-4xl leading-none text-ink sm:text-5xl">
            {mode === "gait" ? t("session.titleGait") : t("session.titleReach")}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {running && (
            <span className="inline-flex items-center gap-2 rounded-pill bg-signal/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-signal-deep">
              <span className="live-dot size-2 rounded-full bg-signal" />
              {t("session.recording")}
            </span>
          )}
          <span className="tnum font-mono text-xs uppercase tracking-[0.14em] text-ink-faint">{pose.fps} fps</span>
        </div>
      </div>

      {profile && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-card border border-line bg-paper-soft px-4 py-3">
          <span className="rounded-pill bg-signal/12 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.14em] text-signal-deep">{t("session.personalised")}</span>
          <span className="text-[13px] text-ink-soft">
            {t("session.tunedTo", {
              condition: profile.condition === "parkinsons" ? t("clinician.condition.parkinsons") : t(`clinician.condition.${profile.condition}`),
              side: profile.affectedSide,
            })}
          </span>
          <Link href="/intake" className="ml-auto text-[13px] text-ink-soft underline-offset-2 transition-colors hover:text-ink hover:underline">{t("session.recalibrate")}</Link>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <div
            ref={stageRef}
            className={cn(
              "relative",
              isFullscreen && "z-50 flex h-full w-full items-center justify-center bg-night p-4 sm:p-8",
            )}
          >
            <div className={cn(isFullscreen ? "w-full max-w-[min(92vw,117vh)]" : "w-full")}>
              <PoseStage videoRef={pose.videoRef} landmarks={pose.latest} running={running} showVideo={showVideo} mode={mode} side={side} tempoSpm={tempoSpm} difficulty={difficulty} onStats={onStats} />
            </div>
            {/* On-stage focus affordance — re-enter distraction-free fullscreen at any point, not just on Start. */}
            {!isFullscreen && (
              <button
                type="button"
                onClick={enterFocus}
                title={t("session.focusMode")}
                className="absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-pill bg-night/70 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-soft backdrop-blur transition-colors hover:bg-night"
              >
                <Maximize2 className="size-3.5" strokeWidth={2} />
                {t("session.focusMode")}
              </button>
            )}
            {isFullscreen && (
              <FocusOverlay
                mode={mode}
                reach={reach}
                gait={gait}
                fps={pose.fps}
                finishing={finishing}
                onFinish={finish}
                onExit={exitFocus}
              />
            )}
          </div>
          {mode === "gait" ? (
            <div className="grid grid-cols-3 gap-4">
              <Metric label={t("session.steps")} value={String(gait.steps)} />
              <Metric label={t("session.cadence")} value={gait.cadenceSpm ? String(gait.cadenceSpm) : "—"} unit={gait.cadenceSpm ? "spm" : undefined} />
              <Metric label={t("session.onBeat")} value={`${Math.round(gait.rhythmPct * 100)}`} unit="%" />
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              <Metric label={t("session.reaches")} value={String(reach.score)} />
              <Metric label={t("session.attempts")} value={String(reach.attempts)} />
              <Metric label={t("session.framesSent")} value={String(counters.framesSent)} />
            </div>
          )}
          {(pose.status === "denied" || pose.status === "error") && (
            <div className="rounded-card border border-line bg-night px-4 py-3 font-mono text-xs text-paper-soft">{pose.error}</div>
          )}
        </div>

        <aside className="space-y-5">
          <Panel label={t("session.control")}>
            <div className="space-y-4">
              {/* primary action — flips between Start and Finish so there's always one obvious next step */}
              {!running ? (
                <button
                  type="button"
                  onClick={start}
                  disabled={pose.status === "loading"}
                  className="flex w-full items-center justify-center gap-2 rounded-pill bg-signal px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-signal-bright disabled:opacity-60"
                >
                  {pose.status === "loading" ? (
                    <Loader2 className="size-4 animate-spin" strokeWidth={1.8} />
                  ) : (
                    <Play className="size-4" strokeWidth={2} />
                  )}
                  {pose.status === "loading" ? t("session.startingCamera") : t("session.startSession")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={finish}
                  disabled={finishing}
                  className="flex w-full items-center justify-center gap-2 rounded-pill bg-night px-5 py-3 text-sm font-medium text-paper-soft transition-colors hover:bg-ink disabled:opacity-60"
                >
                  {finishing ? (
                    <Loader2 className="size-4 animate-spin" strokeWidth={1.8} />
                  ) : (
                    <Square className="size-4" strokeWidth={2} />
                  )}
                  {finishing ? t("session.saving") : t("session.finishSave")}
                </button>
              )}

              {/* focus toggle — explicit fullscreen control available throughout the session */}
              {running && (
                <button
                  type="button"
                  onClick={isFullscreen ? exitFocus : enterFocus}
                  className="flex w-full items-center justify-center gap-2 rounded-pill border border-line bg-paper-soft px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-paper"
                >
                  {isFullscreen ? <Minimize2 className="size-4" strokeWidth={2} /> : <Maximize2 className="size-4" strokeWidth={2} />}
                  {isFullscreen ? t("session.exitFocus") : t("session.focusMode")}
                </button>
              )}

              {/* exercise */}
              <div>
                <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">{t("session.exercise")}</div>
                <div className="grid grid-cols-2 gap-2">
                  <PillButton active={mode === "reach"} onClick={() => setMode("reach")} disabled={running}>
                    {t("session.upperLimb")}
                  </PillButton>
                  <PillButton active={mode === "gait"} onClick={() => setMode("gait")} disabled={running}>
                    {t("session.gaitBalance")}
                  </PillButton>
                </div>
              </div>

              {/* side */}
              <div>
                <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
                  {mode === "gait" ? t("session.leadLeg") : t("session.activeHand")}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <PillButton active={side === "left"} onClick={() => setSide("left")}>
                    {t("session.left")}
                  </PillButton>
                  <PillButton active={side === "right"} onClick={() => setSide("right")}>
                    {t("session.right")}
                  </PillButton>
                </div>
              </div>

              {mode === "gait" && (
                <div>
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">{t("session.cadenceTarget")}</span>
                    <span className="tnum font-mono text-sm text-ink">{tempoSpm} spm</span>
                  </div>
                  <input
                    type="range"
                    min={40}
                    max={110}
                    step={1}
                    value={tempoSpm}
                    onChange={(e) => setTempoSpm(Number(e.target.value))}
                    aria-label="Cadence target"
                    className="w-full accent-signal"
                  />
                </div>
              )}

              <Toggle label={t("session.showCamera")} on={showVideo} onClick={() => setShowVideo((v) => !v)} />
            </div>
          </Panel>

          <SessionTelemetry status={live.status} simulated={live.simulated} prediction={prediction} mode={mode} fill={fill} inferences={inferences} />

          <Panel label={t("session.recordingLabel")}>
            <p className="text-[13px] leading-relaxed text-ink-soft">
              {t("session.recordingNote", {
                frames: counters.framesSent > 0 ? t("session.framesSaved", { n: counters.framesSent }) : "",
              })}
            </p>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

// Focus-mode overlay — the only chrome left on screen while the stage is fullscreen. Gives the user a
// persistent stop action plus a non-destructive way back out, so they're never trapped in focus mode.
function FocusOverlay({
  mode,
  reach,
  gait,
  fps,
  finishing,
  onFinish,
  onExit,
}: {
  mode: SessionMode;
  reach: ReachingStats;
  gait: GaitStats;
  fps: number;
  finishing: boolean;
  onFinish: () => void;
  onExit: () => void;
}) {
  const { t } = useTranslation();
  const primary = mode === "gait"
    ? { label: t("session.steps"), value: String(gait.steps) }
    : { label: t("session.reaches"), value: String(reach.score) };
  const secondary = mode === "gait"
    ? { label: t("session.onBeat"), value: `${Math.round(gait.rhythmPct * 100)}%` }
    : { label: t("session.attempts"), value: String(reach.attempts) };
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-4 sm:p-8">
      <div className="flex items-start justify-between">
        <span className="inline-flex items-center gap-2 rounded-pill bg-signal/15 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-signal-bright backdrop-blur">
          <span className="live-dot size-2 rounded-full bg-signal" />
          {t("session.recording")}
        </span>
        <button
          type="button"
          onClick={onExit}
          className="pointer-events-auto inline-flex items-center gap-2 rounded-pill bg-white/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-soft backdrop-blur transition-colors hover:bg-white/20"
        >
          <Minimize2 className="size-3.5" strokeWidth={2} />
          {t("session.exitFocus")}
        </button>
      </div>
      <div className="pointer-events-auto mx-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-4 rounded-xl bg-black/40 px-5 py-3.5 backdrop-blur">
        <div className="flex items-center gap-6">
          <FocusMetric label={primary.label} value={primary.value} />
          <FocusMetric label={secondary.label} value={secondary.value} />
          <FocusMetric label="FPS" value={String(fps)} />
        </div>
        <button
          type="button"
          onClick={onFinish}
          disabled={finishing}
          className="inline-flex items-center gap-2 rounded-pill bg-white px-5 py-2.5 text-sm font-medium text-night transition-colors hover:bg-paper-soft disabled:opacity-60"
        >
          {finishing ? <Loader2 className="size-4 animate-spin" strokeWidth={1.8} /> : <Square className="size-4" strokeWidth={2} />}
          {finishing ? t("session.saving") : t("session.finishSave")}
        </button>
      </div>
    </div>
  );
}

function FocusMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-paper-soft/60">{label}</div>
      <div className="tnum text-xl text-white">{value}</div>
    </div>
  );
}

// — derivation helpers (shared shape with the former LiveCapturePanel) ————————————

function round(v: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}
function imuSummary(win: Float32Array): { mean: number[]; rms: number[] } {
  const n = win.length / CH;
  const mean = new Array(CH).fill(0);
  const sq = new Array(CH).fill(0);
  for (let k = 0; k < win.length; k += 1) { const c = k % CH; mean[c] += win[k]; sq[c] += win[k] * win[k]; }
  return { mean: mean.map((m) => round(m / n, 4)), rms: sq.map((s) => round(Math.sqrt(s / n), 4)) };
}
function snapshotKeypoints(lm: Landmark[] | null): number[][] | null {
  if (!lm) return null;
  return lm.map((p) => [round(p.x, 4), round(p.y, 4), round(p.z, 4), round(p.visibility ?? 0, 3)]);
}
function jointAngles(lm: Landmark[] | null, side: "left" | "right"): Record<string, number> | null {
  if (!lm) return null;
  const L = POSE_LANDMARKS;
  const [shoulder, hip, knee, ankle] = side === "left"
    ? [L.leftShoulder, L.leftHip, L.leftKnee, L.leftAnkle]
    : [L.rightShoulder, L.rightHip, L.rightKnee, L.rightAnkle];
  const out: Record<string, number> = {};
  const kneeDeg = angleDeg(lm[hip], lm[knee], lm[ankle]);
  const hipDeg = angleDeg(lm[shoulder], lm[hip], lm[knee]);
  if (kneeDeg != null) out.knee = round(kneeDeg, 1);
  if (hipDeg != null) out.hip = round(hipDeg, 1);
  return Object.keys(out).length ? out : null;
}
function angleDeg(a?: Landmark, b?: Landmark, c?: Landmark): number | null {
  if (!a || !b || !c) return null;
  const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
  const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
  if (m1 < 1e-6 || m2 < 1e-6) return null;
  return (Math.acos(Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y) / (m1 * m2)))) * 180) / Math.PI;
}
