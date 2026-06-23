"use client";

import Link from "next/link";
import { useState } from "react";

import OnnxPanel from "@/components/session/OnnxPanel";
import PoseStage from "@/components/session/PoseStage";
import { GhostButton, MonoLabel, Panel, Stat, StatusDot, Toggle } from "@/components/session/mono";
import { useMediaPipePose } from "@/lib/cv/useMediaPipePose";
import type { ReachingStats } from "@/lib/game/reaching";

export default function SessionPage() {
  const pose = useMediaPipePose();
  const [showVideo, setShowVideo] = useState(false);
  const [side, setSide] = useState<"left" | "right">("right");
  const [stats, setStats] = useState<ReachingStats>({ score: 0, attempts: 0, lastReachMs: null });

  const running = pose.status === "running";

  return (
    <div className="min-h-screen bg-white text-black">
      {/* top bar */}
      <header className="flex items-center justify-between border-b border-black/15 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 border border-black" />
          <div className="font-mono text-sm tracking-tight">mova · session</div>
          <span className="hidden font-mono text-[11px] uppercase tracking-[0.14em] text-black/40 sm:inline">
            upper-limb reaching
          </span>
        </div>
        <div className="flex items-center gap-4 font-mono text-[11px] uppercase tracking-[0.12em] text-black/55">
          <span className="flex items-center gap-2">
            <StatusDot state={pose.status === "running" ? "running" : pose.status === "loading" ? "loading" : pose.status === "error" || pose.status === "denied" ? "error" : "idle"} />
            {pose.status}
          </span>
          <span className="tabular-nums">{pose.fps} fps</span>
          <Link href="/dashboard" className="border-b border-black/30 hover:border-black">
            dashboard
          </Link>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1400px] gap-4 p-4 lg:grid-cols-[1fr_360px]">
        {/* stage */}
        <div className="space-y-4">
          <PoseStage
            videoRef={pose.videoRef}
            landmarks={pose.latest}
            running={running}
            showVideo={showVideo}
            side={side}
            onStats={setStats}
          />
          <div className="grid grid-cols-3 gap-4">
            <Stat label="Reaches" value={String(stats.score)} />
            <Stat label="Attempts" value={String(stats.attempts)} />
            <Stat
              label="Last reach"
              value={stats.lastReachMs == null ? "—" : String(stats.lastReachMs)}
              unit={stats.lastReachMs == null ? undefined : "ms"}
            />
          </div>
          {(pose.status === "denied" || pose.status === "error") && (
            <div className="border border-black bg-black px-3 py-2 font-mono text-xs text-white">
              {pose.error}
            </div>
          )}
        </div>

        {/* control rail */}
        <aside className="space-y-4">
          <Panel title="Session control">
            <div className="space-y-3">
              <div className="flex gap-2">
                <GhostButton active={running} onClick={pose.start} disabled={running || pose.status === "loading"}>
                  {pose.status === "loading" ? "Starting…" : "Start"}
                </GhostButton>
                <GhostButton onClick={pose.stop} disabled={!running}>
                  Stop
                </GhostButton>
              </div>
              <Toggle label="Show camera (privacy)" on={showVideo} onClick={() => setShowVideo((v) => !v)} />
              <div className="flex gap-2">
                <GhostButton active={side === "left"} onClick={() => setSide("left")}>
                  Left hand
                </GhostButton>
                <GhostButton active={side === "right"} onClick={() => setSide("right")}>
                  Right hand
                </GhostButton>
              </div>
            </div>
          </Panel>

          <Panel title="Edge inference · onnxruntime-web">
            <OnnxPanel />
          </Panel>

          <Panel title="Privacy">
            <p className="font-mono text-[11px] leading-relaxed text-black/60">
              Raw video is processed on-device and never leaves this browser. Only pose keypoints and
              derived metrics are used. The camera frame stays hidden unless you enable it above.
            </p>
          </Panel>
        </aside>
      </main>

      <footer className="border-t border-black/15 px-4 py-3">
        <MonoLabel>Decision support, not diagnosis · on-device computer vision</MonoLabel>
      </footer>
    </div>
  );
}
