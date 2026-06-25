"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import SessionReward, { type SessionRewardData } from "@/components/gamification/SessionReward";
import PoseStage, { type SessionMode, type StageStats } from "@/components/session/PoseStage";
import SessionTelemetry from "@/components/session/SessionTelemetry";
import { Metric, Panel, PillButton, Toggle } from "@/components/session/ui";
import { VirtualImuPipeline } from "@/lib/cv/imuWindow";
import { useMediaPipePose } from "@/lib/cv/useMediaPipePose";
import type { GaitStats } from "@/lib/game/gait";
import type { ReachingStats } from "@/lib/game/reaching";
import { computeInsights } from "@/lib/insights/engine";
import { loadSessions, makeId, saveSession } from "@/lib/insights/store";
import type { Insight, SessionRecord, Side } from "@/lib/insights/types";
import { type LivePrediction, useLiveInference } from "@/lib/onnx/useLiveInference";
import { abilityFor, loadProfile, startingCadence } from "@/lib/profile/store";
import type { PatientProfile } from "@/lib/profile/types";
import { createClient } from "@/lib/supabase/client";

const INFER_MS = 600;
const ZERO_REACH: ReachingStats = { score: 0, attempts: 0, lastReachMs: null };
const ZERO_GAIT: GaitStats = {
  steps: 0,
  beats: 0,
  cadenceSpm: 0,
  rhythmPct: 0,
  currentStreak: 0,
  bestStreak: 0,
  lastErrMs: null,
};

const MODES: { id: SessionMode; eyebrow: string; title: string }[] = [
  { id: "reach", eyebrow: "Live session · upper-limb reaching", title: "Move, and the model watches." },
  { id: "gait", eyebrow: "Live session · gait & balance", title: "Step to the beat." },
];

/** Reduce a raw per-frame risk stream to at most `n` mean-bucketed samples for the stored timeline. */
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

export default function SessionPage() {
  const pipeline = useRef(new VirtualImuPipeline());
  const sideRef = useRef<Side>("right");
  const modeRef = useRef<SessionMode>("reach");

  const pose = useMediaPipePose({
    onFrame: (f) => pipeline.current.push(f.worldLandmarks, f.timestampMs),
  });
  const live = useLiveInference();
  const liveRef = useRef(live);
  liveRef.current = live;

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
  const [summary, setSummary] = useState<{ record: SessionRecord; insights: Insight[] } | null>(null);
  const [reward, setReward] = useState<SessionRewardData | null>(null);

  // session accumulators
  const [supabase] = useState(() => createClient());
  const sessionIdRef = useRef<string | null>(null);
  const startedAt = useRef(0);
  const prevScore = useRef(0);
  const reachTimes = useRef<number[]>([]);
  const gaitRef = useRef<GaitStats>(ZERO_GAIT);
  const fogAccum = useRef({ sum: 0, n: 0 });
  const fogSamples = useRef<number[]>([]);
  const harCounts = useRef<Record<string, number>>({});

  const running = pose.status === "running";
  const meta = MODES.find((m) => m.id === mode)!;
  const difficulty = abilityFor(profile, mode);

  // Personalise from the intake profile once, on mount: recommended pack, seeded cadence, affected side.
  useEffect(() => {
    const p = loadProfile();
    if (!p) return;
    setProfile(p);
    setMode(p.recommendedPack === "gait" ? "gait" : "reach");
    setTempoSpm(startingCadence(p));
    if (p.affectedSide !== "bilateral") setSide(p.affectedSide);
  }, []);

  useEffect(() => {
    sideRef.current = side;
    pipeline.current.side = side;
  }, [side]);

  useEffect(() => {
    modeRef.current = mode;
    pipeline.current.segment = mode === "gait" ? "shank" : "forearm";
  }, [mode]);

  const onStats = useCallback((s: StageStats) => {
    if (s.mode === "gait") {
      setGait(s.gait);
      gaitRef.current = s.gait;
    } else {
      setReach(s.reach);
      if (s.reach.score > prevScore.current && s.reach.lastReachMs != null)
        reachTimes.current.push(s.reach.lastReachMs);
      prevScore.current = s.reach.score;
    }
  }, []);

  const start = useCallback(async () => {
    setSummary(null);
    setReward(null);
    prevScore.current = 0;
    reachTimes.current = [];
    gaitRef.current = ZERO_GAIT;
    fogAccum.current = { sum: 0, n: 0 };
    fogSamples.current = [];
    harCounts.current = {};
    setReach(ZERO_REACH);
    setGait(ZERO_GAIT);
    setInferences(0);
    setPrediction(null);
    pipeline.current.reset();
    startedAt.current = Date.now();
    // Open a backing Supabase training session so this workout can be scored + rewarded (best-effort).
    sessionIdRef.current = null;
    void (async () => {
      try {
        const { data } = await supabase.rpc("start_training_session", {
          p_exercise_slug: null,
          p_device_info: { client: "web", via: "session-game", mode: modeRef.current },
        });
        const s = Array.isArray(data) ? data[0] : data;
        sessionIdRef.current = s?.id ?? null;
      } catch {
        /* offline / unauthenticated — the game still works locally */
      }
    })();
    void liveRef.current.loadAll();
    await pose.start();
  }, [pose, supabase]);

  const stop = useCallback(() => {
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
      reachMs: {
        mean: rt.length ? Math.round(rt.reduce((a, b) => a + b, 0) / rt.length) : 0,
        best: rt.length ? Math.min(...rt) : 0,
      },
      gait:
        m === "gait"
          ? {
              steps: g.steps,
              beats: g.beats,
              cadenceSpm: g.cadenceSpm,
              rhythmPct: g.rhythmPct,
              bestStreak: g.bestStreak,
            }
          : undefined,
      fogRiskMean,
      fogSeries: downsample(fogSamples.current, 48),
      fogValid: m === "gait",
      harTop,
      inferenceCount: inferences,
    };

    const did = m === "gait" ? record.gait!.steps > 0 || record.inferenceCount > 0 : record.reaches > 0 || record.inferenceCount > 0;
    if (did) {
      saveSession(record);
      setSummary({ record, insights: computeInsights(loadSessions()) });

      // Score the session on the backend, then award XP / streak / badges (best-effort).
      const sid = sessionIdRef.current;
      if (sid) {
        const quality =
          m === "gait"
            ? record.gait
              ? record.gait.rhythmPct
              : null
            : record.attempts > 0
              ? record.reaches / record.attempts
              : null;
        const metrics = {
          reps: m === "gait" ? (record.gait?.steps ?? 0) : record.reaches,
          quality_score: quality,
          fog_risk: record.fogRiskMean,
          adherence: 1,
        };
        void (async () => {
          try {
            await supabase.rpc("finish_training_session", {
              p_session: sid,
              p_summary: { source: "session-game", mode: m, side: sideRef.current, duration_s: record.durationSec },
              p_metrics: metrics,
            });
            const { data } = await supabase.rpc("award_session_rewards", { p_session: sid });
            if (data) setReward(data as SessionRewardData);
          } catch {
            /* best-effort rewards */
          }
        })();
      }
    }
  }, [pose, reach.score, reach.attempts, inferences, supabase]);

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
      const pred = await l.infer(w, modeRef.current, sideRef.current);
      if (!alive || !pred) return;
      setPrediction(pred);
      setInferences((c) => c + 1);
      if (pred.fog) {
        fogAccum.current.sum += pred.fog.risk;
        fogAccum.current.n += 1;
        fogSamples.current.push(pred.fog.risk);
      }
      if (pred.har) harCounts.current[pred.har.label] = (harCounts.current[pred.har.label] ?? 0) + 1;
    }, INFER_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [running]);

  return (
    <>
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-ink-faint">
              {meta.eyebrow}
            </div>
            <h1 className="mt-2 font-serif text-4xl italic leading-none text-ink">{meta.title}</h1>
          </div>
          <div className="font-mono text-xs uppercase tracking-[0.14em] text-ink-faint">
            {pose.fps} fps · {pose.status}
          </div>
        </div>

        {profile ? (
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-card border border-line bg-paper-soft px-4 py-3">
            <span className="rounded-pill bg-signal/12 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.14em] text-signal-deep">
              Personalised
            </span>
            <span className="text-[13px] text-ink-soft">
              Tuned to your <span className="text-ink">{profile.condition === "parkinsons" ? "Parkinson's" : profile.condition}</span> program
              {profile.baseline ? " and baseline range" : ""} · affected side <span className="text-ink">{profile.affectedSide}</span>.
            </span>
            <Link href="/intake" className="ml-auto text-[13px] text-ink-soft underline-offset-2 transition-colors hover:text-ink hover:underline">
              Recalibrate
            </Link>
          </div>
        ) : (
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-card border border-line bg-paper-soft px-4 py-3">
            <span className="text-[13px] text-ink-soft">
              Set up your program in under two minutes — pick your condition and capture a baseline range so the games fit you.
            </span>
            <Link
              href="/intake"
              className="ml-auto rounded-pill bg-night px-4 py-1.5 text-sm font-medium text-paper-soft transition-colors hover:bg-ink"
            >
              Personalise →
            </Link>
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
          <div className="space-y-5">
            <PoseStage
              videoRef={pose.videoRef}
              landmarks={pose.latest}
              running={running}
              showVideo={showVideo}
              mode={mode}
              side={side}
              tempoSpm={tempoSpm}
              difficulty={difficulty}
              onStats={onStats}
            />
            {mode === "gait" ? (
              <div className="grid grid-cols-3 gap-4">
                <Metric label="Steps" value={String(gait.steps)} />
                <Metric label="Cadence" value={gait.cadenceSpm ? String(gait.cadenceSpm) : "—"} unit={gait.cadenceSpm ? "spm" : undefined} />
                <Metric label="On-beat" value={`${Math.round(gait.rhythmPct * 100)}`} unit="%" />
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-4">
                <Metric label="Reaches" value={String(reach.score)} />
                <Metric label="Attempts" value={String(reach.attempts)} />
                <Metric
                  label="Last reach"
                  value={reach.lastReachMs == null ? "—" : String(reach.lastReachMs)}
                  unit={reach.lastReachMs == null ? undefined : "ms"}
                />
              </div>
            )}
            {(pose.status === "denied" || pose.status === "error") && (
              <div className="rounded-card border border-line bg-night px-4 py-3 font-mono text-xs text-paper-soft">
                {pose.error}
              </div>
            )}
          </div>

          <aside className="space-y-5">
            <Panel label="Session control">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <PillButton active={mode === "reach"} onClick={() => setMode("reach")} disabled={running}>
                    Upper-limb reach
                  </PillButton>
                  <PillButton active={mode === "gait"} onClick={() => setMode("gait")} disabled={running}>
                    Gait &amp; balance
                  </PillButton>
                </div>
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
                    {mode === "gait" ? "Lead left" : "Left hand"}
                  </PillButton>
                  <PillButton active={side === "right"} onClick={() => setSide("right")}>
                    {mode === "gait" ? "Lead right" : "Right hand"}
                  </PillButton>
                </div>
                {mode === "gait" && (
                  <div className="space-y-3">
                    <div>
                      <div className="mb-1.5 flex items-baseline justify-between">
                        <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-ink-faint">
                          Cadence target
                        </span>
                        <span className="font-mono text-sm tabular-nums text-ink">{tempoSpm} spm</span>
                      </div>
                      <input
                        type="range"
                        min={40}
                        max={110}
                        step={1}
                        value={tempoSpm}
                        onChange={(e) => setTempoSpm(Number(e.target.value))}
                        aria-label="Cadence target in steps per minute"
                        className="w-full accent-signal"
                      />
                      <div className="mt-1 flex justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
                        <span>40 · gentle</span>
                        <span>110 · brisk</span>
                      </div>
                    </div>
                    <p className="text-[12px] leading-relaxed text-ink-soft">
                      Stand in full view of the camera and march in place, lifting the cued knee on each beat.
                      Only your ankle/shank motion drives the FoG model.
                    </p>
                  </div>
                )}
              </div>
            </Panel>

            <SessionTelemetry status={live.status} prediction={prediction} mode={mode} fill={fill} inferences={inferences} />

            <Panel label="Privacy">
              <p className="text-[13px] leading-relaxed text-ink-soft">
                Raw video is processed on-device and never leaves this browser — only pose keypoints and
                derived motion are used. The camera frame stays hidden unless you enable it.
              </p>
            </Panel>
          </aside>
        </div>

        {reward ? (
          <>
            <SessionReward reward={reward} onRestart={start} />
            {summary && <InsightCards insights={summary.insights} />}
          </>
        ) : (
          summary && <PostSession summary={summary} onRestart={start} />
        )}
    </>
  );
}

function InsightCards({ insights }: { insights: Insight[] }) {
  const toneRing: Record<string, string> = {
    positive: "border-signal/40",
    watch: "border-ink/30",
    neutral: "border-line",
  };
  return (
    <section className="mt-6">
      <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint">
        What changed
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {insights.map((ins) => (
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

function PostSession({
  summary,
  onRestart,
}: {
  summary: { record: SessionRecord; insights: Insight[] };
  onRestart: () => void;
}) {
  const r = summary.record;
  const isGait = r.exercise === "gait";
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
        {isGait ? (
          <>
            <Metric label="Steps" value={String(r.gait?.steps ?? 0)} />
            <Metric label="Cadence" value={r.gait?.cadenceSpm ? String(r.gait.cadenceSpm) : "—"} unit={r.gait?.cadenceSpm ? "spm" : undefined} />
            <Metric label="Duration" value={String(r.durationSec)} unit="s" />
          </>
        ) : (
          <>
            <Metric label="Reaches" value={String(r.reaches)} />
            <Metric label="Avg reach" value={r.reachMs.mean ? String(r.reachMs.mean) : "—"} unit={r.reachMs.mean ? "ms" : undefined} />
            <Metric label="Duration" value={String(r.durationSec)} unit="s" />
          </>
        )}
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
