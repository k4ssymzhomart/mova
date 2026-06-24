"use client";

// LiveCapturePanel — the edge→backend bridge for a training session.
//
// Runs the same on-device pipeline as /session (MediaPipe pose → virtual-IMU window → ONNX FoG/HAR)
// but, instead of a local game store, streams DERIVED telemetry into Supabase: per-frame keypoints +
// IMU summaries → session_frames, smoothed freezing-of-gait episodes → fog_events (both via the 0018
// RPCs, keyed to this session). On finish it derives REAL aggregate metrics from the stream and closes
// the session through finish_training_session — superseding the simulated placeholder metrics.
// Privacy-first: raw video stays on-device; only keypoints + derived motion leave the browser.

import { Loader2, Play, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import PoseStage, { type SessionMode, type StageStats } from "@/components/session/PoseStage";
import SessionTelemetry from "@/components/session/SessionTelemetry";
import { Metric, Panel, PillButton, Toggle } from "@/components/session/ui";
import { POSE_LANDMARKS, type Landmark } from "@/lib/cv/landmarks";
import { VirtualImuPipeline } from "@/lib/cv/imuWindow";
import { useMediaPipePose } from "@/lib/cv/useMediaPipePose";
import { type LivePrediction, useLiveInference } from "@/lib/onnx/useLiveInference";
import { createClient } from "@/lib/supabase/client";
import { FogEpisodeDetector } from "@/lib/telemetry/fogEpisodes";
import { type StreamerCounters, TelemetryStreamer } from "@/lib/telemetry/streamer";

const INFER_MS = 600;
const CH = 6;
const ZERO_COUNTERS: StreamerCounters = {
  framesSent: 0,
  eventsSent: 0,
  pending: 0,
  errors: 0,
  lastError: null,
};

export default function LiveCapturePanel({ sessionId }: { sessionId: string }) {
  const pipeline = useRef(new VirtualImuPipeline());
  const pose = useMediaPipePose({
    onFrame: (f) => pipeline.current.push(f.worldLandmarks, f.timestampMs),
  });
  const live = useLiveInference();
  const liveRef = useRef(live);
  liveRef.current = live;

  const [mode, setMode] = useState<SessionMode>("gait");
  const [side, setSide] = useState<"left" | "right">("right");
  const [showVideo, setShowVideo] = useState(false);
  const [prediction, setPrediction] = useState<LivePrediction | null>(null);
  const [fill, setFill] = useState(0);
  const [inferences, setInferences] = useState(0);
  const [counters, setCounters] = useState<StreamerCounters>(ZERO_COUNTERS);
  const [finishing, setFinishing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const modeRef = useRef(mode);
  const sideRef = useRef(side);
  modeRef.current = mode;
  sideRef.current = side;

  // Stream + per-session accumulators
  const streamer = useRef<TelemetryStreamer | null>(null);
  const detector = useRef<FogEpisodeDetector | null>(null);
  const seq = useRef(0);
  const fog = useRef({ sum: 0, n: 0, peak: 0 });
  const quality = useRef({ sum: 0, n: 0 });
  const episodes = useRef(0);
  const steps = useRef(0);
  const startedAt = useRef(0);
  const [supabase] = useState(() => createClient());

  const running = pose.status === "running";

  useEffect(() => {
    pipeline.current.side = side;
  }, [side]);
  useEffect(() => {
    pipeline.current.segment = mode === "gait" ? "shank" : "forearm";
  }, [mode]);

  const onStats = useCallback((s: StageStats) => {
    if (s.mode === "gait") steps.current = s.gait.steps;
  }, []);

  const start = useCallback(async () => {
    setErr(null);
    seq.current = 0;
    fog.current = { sum: 0, n: 0, peak: 0 };
    quality.current = { sum: 0, n: 0 };
    episodes.current = 0;
    steps.current = 0;
    setInferences(0);
    setPrediction(null);
    setCounters(ZERO_COUNTERS);
    pipeline.current.reset();
    streamer.current = new TelemetryStreamer(sessionId, setCounters);
    streamer.current.start();
    detector.current = new FogEpisodeDetector({ source: "fog.onnx" });
    startedAt.current = Date.now();
    void liveRef.current.loadAll();
    await pose.start();
  }, [pose, sessionId]);

  // Inference + stream loop — decoupled from the render loop so the camera stays smooth.
  useEffect(() => {
    if (!running) return;
    let alive = true;
    const id = window.setInterval(async () => {
      const now = performance.now();
      setFill(pipeline.current.fill(now));
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
      const cover = pipeline.current.fill(now);
      quality.current.sum += cover;
      quality.current.n += 1;

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
            har_prob: pred.har ? round(pred.har.prob, 4) : null,
            mode: pred.mode,
            side: sideRef.current,
          },
          quality: round(cover, 3),
        });
      }

      if (pred.fog) {
        fog.current.sum += pred.fog.risk;
        fog.current.n += 1;
        fog.current.peak = Math.max(fog.current.peak, pred.fog.risk);
        const ep = detector.current?.update(pred.fog.risk, pred.fog.valid, wall);
        if (ep && s) {
          episodes.current += 1;
          void s.sendEvents([ep]);
        }
      }
    }, INFER_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [running, pose.latest]);

  const finish = useCallback(async () => {
    setFinishing(true);
    setErr(null);
    pose.stop();

    // Close any open episode and flush the remaining frame buffer before computing metrics.
    const ep = detector.current?.finalize(Date.now());
    if (ep && streamer.current) {
      episodes.current += 1;
      await streamer.current.sendEvents([ep]);
    }
    await streamer.current?.stop();

    const fogMean = fog.current.n ? round(fog.current.sum / fog.current.n, 4) : null;
    const qualMean = quality.current.n ? round(quality.current.sum / quality.current.n, 3) : null;

    const metrics: Record<string, number | null> = {
      reps: modeRef.current === "gait" ? steps.current : null,
      quality_score: qualMean,
      fog_risk: fogMean,
      adherence: 1.0,
    };
    const summary = {
      source: "live-capture",
      mode: modeRef.current,
      side: sideRef.current,
      duration_s: Math.max(0, Math.round((Date.now() - (startedAt.current || Date.now())) / 1000)),
      inferences,
      frames_sent: streamer.current?.counters.framesSent ?? 0,
      fog_episodes: episodes.current,
      fog_risk_peak: round(fog.current.peak, 4),
      fog_valid: modeRef.current === "gait",
    };

    const { error } = await supabase.rpc("finish_training_session", {
      p_session: sessionId,
      p_summary: summary,
      p_metrics: metrics,
    });
    setFinishing(false);
    if (error) {
      setErr(error.message);
      return;
    }
    router.refresh();
  }, [pose, supabase, sessionId, inferences]);

  const router = useRouter();

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <PoseStage
          videoRef={pose.videoRef}
          landmarks={pose.latest}
          running={running}
          showVideo={showVideo}
          mode={mode}
          side={side}
          difficulty={0.5}
          onStats={onStats}
        />
        <div className="grid grid-cols-3 gap-3">
          <Metric label="Frames sent" value={String(counters.framesSent)} />
          <Metric label="FoG episodes" value={String(counters.eventsSent)} />
          <Metric label="Inferences" value={String(inferences)} />
        </div>
        {counters.pending > 0 && (
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
            {counters.pending} frame{counters.pending === 1 ? "" : "s"} buffered…
          </p>
        )}
        {counters.errors > 0 && (
          <div className="rounded-card border border-line bg-night px-4 py-3 font-mono text-xs text-paper-soft">
            stream error ({counters.errors}): {counters.lastError}
          </div>
        )}
        {(pose.status === "denied" || pose.status === "error") && (
          <div className="rounded-card border border-line bg-night px-4 py-3 font-mono text-xs text-paper-soft">
            {pose.error}
          </div>
        )}
      </div>

      <aside className="space-y-4">
        <Panel label="Capture control">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <PillButton active={mode === "gait"} onClick={() => setMode("gait")} disabled={running}>
                Gait &amp; balance
              </PillButton>
              <PillButton active={mode === "reach"} onClick={() => setMode("reach")} disabled={running}>
                Upper-limb
              </PillButton>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <PillButton active={side === "left"} onClick={() => setSide("left")} disabled={running}>
                {mode === "gait" ? "Lead left" : "Left"}
              </PillButton>
              <PillButton active={side === "right"} onClick={() => setSide("right")} disabled={running}>
                {mode === "gait" ? "Lead right" : "Right"}
              </PillButton>
            </div>
            {!running ? (
              <button
                type="button"
                onClick={start}
                disabled={pose.status === "loading" || finishing}
                className="inline-flex w-full items-center justify-center gap-2 rounded-pill bg-signal px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-signal-bright disabled:opacity-60"
              >
                {pose.status === "loading" ? (
                  <Loader2 className="size-4 animate-spin" strokeWidth={1.8} />
                ) : (
                  <Play className="size-4" strokeWidth={1.8} />
                )}
                {pose.status === "loading" ? "Starting camera…" : "Start capture"}
              </button>
            ) : (
              <button
                type="button"
                onClick={finish}
                disabled={finishing}
                className="inline-flex w-full items-center justify-center gap-2 rounded-pill bg-night px-5 py-3 text-sm font-medium text-paper-soft transition-colors hover:bg-ink disabled:opacity-60"
              >
                {finishing ? (
                  <Loader2 className="size-4 animate-spin" strokeWidth={1.8} />
                ) : (
                  <Square className="size-4" strokeWidth={1.8} />
                )}
                {finishing ? "Saving…" : "Stop & save session"}
              </button>
            )}
            <Toggle
              label="Show camera (off by default)"
              on={showVideo}
              onClick={() => setShowVideo((v) => !v)}
            />
            {err && <p className="text-sm text-destructive">{err}</p>}
          </div>
        </Panel>

        <SessionTelemetry
          status={live.status}
          prediction={prediction}
          mode={mode}
          fill={fill}
          inferences={inferences}
        />

        <Panel label="Privacy">
          <p className="text-[13px] leading-relaxed text-ink-soft">
            Raw video is processed on-device and never leaves this browser — only derived keypoints and
            motion features are streamed to your session record.
          </p>
        </Panel>
      </aside>
    </div>
  );
}

// — derivation helpers ————————————————————————————————————————————————

function round(v: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

/** Per-channel mean + RMS over a raw [200,6] virtual-IMU window (g, rad/s). */
function imuSummary(win: Float32Array): { mean: number[]; rms: number[] } {
  const n = win.length / CH;
  const mean = new Array(CH).fill(0);
  const sq = new Array(CH).fill(0);
  for (let k = 0; k < win.length; k += 1) {
    const c = k % CH;
    mean[c] += win[k];
    sq[c] += win[k] * win[k];
  }
  return {
    mean: mean.map((m) => round(m / n, 4)),
    rms: sq.map((s) => round(Math.sqrt(s / n), 4)),
  };
}

/** A compact snapshot of the 33 normalized landmarks ([x,y,z,visibility]) — derived pose only. */
function snapshotKeypoints(lm: Landmark[] | null): number[][] | null {
  if (!lm) return null;
  return lm.map((p) => [round(p.x, 4), round(p.y, 4), round(p.z, 4), round(p.visibility ?? 0, 3)]);
}

/** Clinically relevant joint angles (deg) for the lead side: knee (hip-knee-ankle), hip (shoulder-hip-knee). */
function jointAngles(lm: Landmark[] | null, side: "left" | "right"): Record<string, number> | null {
  if (!lm) return null;
  const L = POSE_LANDMARKS;
  const [shoulder, hip, knee, ankle] =
    side === "left"
      ? [L.leftShoulder, L.leftHip, L.leftKnee, L.leftAnkle]
      : [L.rightShoulder, L.rightHip, L.rightKnee, L.rightAnkle];
  const out: Record<string, number> = {};
  const kneeDeg = angleDeg(lm[hip], lm[knee], lm[ankle]);
  const hipDeg = angleDeg(lm[shoulder], lm[hip], lm[knee]);
  if (kneeDeg != null) out.knee = round(kneeDeg, 1);
  if (hipDeg != null) out.hip = round(hipDeg, 1);
  return Object.keys(out).length ? out : null;
}

/** Interior angle (deg) at vertex b for points a-b-c, in normalized image space. */
function angleDeg(a?: Landmark, b?: Landmark, c?: Landmark): number | null {
  if (!a || !b || !c) return null;
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const dot = v1x * v2x + v1y * v2y;
  const m1 = Math.hypot(v1x, v1y);
  const m2 = Math.hypot(v2x, v2y);
  if (m1 < 1e-6 || m2 < 1e-6) return null;
  const cos = Math.min(1, Math.max(-1, dot / (m1 * m2)));
  return (Math.acos(cos) * 180) / Math.PI;
}
