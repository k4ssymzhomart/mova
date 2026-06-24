"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import AppHeader from "@/components/app/AppHeader";
import RequireAuth from "@/components/auth/RequireAuth";
import PoseStage from "@/components/session/PoseStage";
import SessionTelemetry from "@/components/session/SessionTelemetry";
import { Metric, Panel, PillButton, Toggle } from "@/components/session/ui";
import { VirtualImuPipeline } from "@/lib/cv/imuWindow";
import { useMediaPipePose } from "@/lib/cv/useMediaPipePose";
import { computeInsights } from "@/lib/insights/engine";
import { loadSessions, makeId, saveSession } from "@/lib/insights/store";
import type { Insight, SessionRecord, Side } from "@/lib/insights/types";
import { type LivePrediction, useLiveInference } from "@/lib/onnx/useLiveInference";
import type { ReachingStats } from "@/lib/game/reaching";

const INFER_MS = 600;

export default function SessionPage() {
  const pipeline = useRef(new VirtualImuPipeline());
  const sideRef = useRef<Side>("right");

  const pose = useMediaPipePose({
    onFrame: (f) => pipeline.current.push(f.worldLandmarks, f.timestampMs),
  });
  const live = useLiveInference();
  const liveRef = useRef(live);
  liveRef.current = live;

  const [side, setSide] = useState<Side>("right");
  const [showVideo, setShowVideo] = useState(false);
  const [stats, setStats] = useState<ReachingStats>({ score: 0, attempts: 0, lastReachMs: null });
  const [prediction, setPrediction] = useState<LivePrediction | null>(null);
  const [fill, setFill] = useState(0);
  const [inferences, setInferences] = useState(0);
  const [summary, setSummary] = useState<{ record: SessionRecord; insights: Insight[] } | null>(null);

  // session accumulators
  const startedAt = useRef(0);
  const prevScore = useRef(0);
  const reachTimes = useRef<number[]>([]);
  const fogAccum = useRef({ sum: 0, n: 0 });
  const harCounts = useRef<Record<string, number>>({});

  const running = pose.status === "running";
  useEffect(() => {
    sideRef.current = side;
    pipeline.current.side = side;
  }, [side]);

  const onStats = useCallback((s: ReachingStats) => {
    setStats(s);
    if (s.score > prevScore.current && s.lastReachMs != null) reachTimes.current.push(s.lastReachMs);
    prevScore.current = s.score;
  }, []);

  const start = useCallback(async () => {
    setSummary(null);
    prevScore.current = 0;
    reachTimes.current = [];
    fogAccum.current = { sum: 0, n: 0 };
    harCounts.current = {};
    setInferences(0);
    setPrediction(null);
    pipeline.current.reset();
    startedAt.current = Date.now();
    void liveRef.current.loadAll();
    await pose.start();
  }, [pose]);

  const stop = useCallback(() => {
    pose.stop();
    const rt = reachTimes.current;
    const harTop =
      Object.entries(harCounts.current).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const record: SessionRecord = {
      id: makeId(),
      startedAt: startedAt.current || Date.now(),
      endedAt: Date.now(),
      exercise: "reaching",
      side: sideRef.current,
      durationSec: Math.max(0, Math.round((Date.now() - (startedAt.current || Date.now())) / 1000)),
      reaches: stats.score,
      attempts: stats.attempts,
      reachMs: {
        mean: rt.length ? Math.round(rt.reduce((a, b) => a + b, 0) / rt.length) : 0,
        best: rt.length ? Math.min(...rt) : 0,
      },
      fogRiskMean: fogAccum.current.n ? fogAccum.current.sum / fogAccum.current.n : null,
      harTop,
      inferenceCount: inferences,
    };
    if (record.reaches > 0 || record.inferenceCount > 0) {
      saveSession(record);
      setSummary({ record, insights: computeInsights(loadSessions()) });
    }
  }, [pose, stats.score, stats.attempts, inferences]);

  // Inference loop — decoupled from the render loop, off-main-thread (ort proxy), so the camera stays smooth.
  useEffect(() => {
    if (!running) return;
    let alive = true;
    const id = window.setInterval(async () => {
      const now = performance.now();
      setFill(pipeline.current.fill(now));
      const l = liveRef.current;
      if (l.status !== "ready") return;
      const w = pipeline.current.window(now);
      if (!w) return;
      const pred = await l.infer(w);
      if (!alive || !pred) return;
      setPrediction(pred);
      setInferences((c) => c + 1);
      if (pred.fog) {
        fogAccum.current.sum += pred.fog.risk;
        fogAccum.current.n += 1;
      }
      if (pred.har) harCounts.current[pred.har.label] = (harCounts.current[pred.har.label] ?? 0) + 1;
    }, INFER_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [running]);

  return (
    <RequireAuth>
    <div className="min-h-screen bg-paper text-ink">
      <AppHeader active="/session" />

      <main className="mx-auto max-w-shell px-5 py-8 sm:px-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-ink-faint">
              Live session · upper-limb reaching
            </div>
            <h1 className="mt-2 font-serif text-4xl italic leading-none text-ink">
              Move, and the model watches.
            </h1>
          </div>
          <div className="font-mono text-xs uppercase tracking-[0.14em] text-ink-faint">
            {pose.fps} fps · {pose.status}
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
          <div className="space-y-5">
            <PoseStage
              videoRef={pose.videoRef}
              landmarks={pose.latest}
              running={running}
              showVideo={showVideo}
              side={side}
              onStats={onStats}
            />
            <div className="grid grid-cols-3 gap-4">
              <Metric label="Reaches" value={String(stats.score)} />
              <Metric label="Attempts" value={String(stats.attempts)} />
              <Metric
                label="Last reach"
                value={stats.lastReachMs == null ? "—" : String(stats.lastReachMs)}
                unit={stats.lastReachMs == null ? undefined : "ms"}
              />
            </div>
            {(pose.status === "denied" || pose.status === "error") && (
              <div className="rounded-card border border-line bg-night px-4 py-3 font-mono text-xs text-paper-soft">
                {pose.error}
              </div>
            )}
          </div>

          <aside className="space-y-5">
            <Panel label="Session control">
              <div className="space-y-4">
                <div className="flex gap-2">
                  <PillButton active={running} onClick={start} disabled={running || pose.status === "loading"}>
                    {pose.status === "loading" ? "Starting…" : "Start session"}
                  </PillButton>
                  <PillButton onClick={stop} disabled={!running}>
                    Stop
                  </PillButton>
                </div>
                <Toggle label="Show camera (off by default)" on={showVideo} onClick={() => setShowVideo((v) => !v)} />
                <div className="flex gap-2">
                  <PillButton active={side === "left"} onClick={() => setSide("left")}>
                    Left hand
                  </PillButton>
                  <PillButton active={side === "right"} onClick={() => setSide("right")}>
                    Right hand
                  </PillButton>
                </div>
              </div>
            </Panel>

            <SessionTelemetry status={live.status} prediction={prediction} fill={fill} inferences={inferences} />

            <Panel label="Privacy">
              <p className="text-[13px] leading-relaxed text-ink-soft">
                Raw video is processed on-device and never leaves this browser — only pose keypoints and
                derived motion are used. The camera frame stays hidden unless you enable it.
              </p>
            </Panel>
          </aside>
        </div>

        {summary && <PostSession summary={summary} onRestart={start} />}
      </main>
    </div>
    </RequireAuth>
  );
}

function PostSession({
  summary,
  onRestart,
}: {
  summary: { record: SessionRecord; insights: Insight[] };
  onRestart: () => void;
}) {
  const r = summary.record;
  const toneRing: Record<string, string> = {
    positive: "border-signal/40",
    watch: "border-ink/30",
    neutral: "border-line",
  };
  return (
    <section className="mt-10 rounded-card border border-line bg-paper-soft p-6 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-ink-faint">
            Session complete
          </div>
          <h2 className="mt-2 font-serif text-3xl italic text-ink">Here's what changed.</h2>
        </div>
        <div className="flex gap-2">
          <Link
            href="/progress"
            className="rounded-pill bg-night px-5 py-2.5 text-sm font-medium text-paper-soft transition-colors hover:bg-ink"
          >
            View full progress →
          </Link>
          <PillButton onClick={onRestart}>New session</PillButton>
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Metric label="Reaches" value={String(r.reaches)} />
        <Metric label="Avg reach" value={r.reachMs.mean ? String(r.reachMs.mean) : "—"} unit={r.reachMs.mean ? "ms" : undefined} />
        <Metric label="Duration" value={String(r.durationSec)} unit="s" />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {summary.insights.map((ins) => (
          <div key={ins.id} className={`rounded-card border bg-card p-5 ${toneRing[ins.tone] ?? "border-line"}`}>
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-serif text-xl italic text-ink">{ins.title}</h3>
              {ins.metric && <span className="font-mono text-sm tabular-nums text-signal-deep">{ins.metric}</span>}
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">{ins.body}</p>
            {ins.clinical && (
              <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-faint">
                {ins.clinical}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
