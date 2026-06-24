"use client";

// CV-guided baseline ROM capture. A ~60-second on-device assessment: the patient steps back into full
// view and raises their arms / lifts their knees while MediaPipe pose runs; we track the *maximum*
// comfortable elevation per side and hand back a RomBaseline. Privacy-first: raw video stays on-device
// (we only ever draw the skeleton), and only the four max angles leave this component.

import { useCallback, useEffect, useRef, useState } from "react";

import { drawLegAccent, drawSkeleton } from "@/lib/cv/drawSkeleton";
import { armElevationDeg, kneeRaiseDeg } from "@/lib/cv/rom";
import { useMediaPipePose } from "@/lib/cv/useMediaPipePose";
import type { RomBaseline } from "@/lib/profile/types";

const CAPTURE_MS = 60_000;

interface MaxRom {
  armL: number;
  armR: number;
  kneeL: number;
  kneeR: number;
  frames: number;
}

const ZERO: MaxRom = { armL: 0, armR: 0, kneeL: 0, kneeR: 0, frames: 0 };

export default function BaselineCapture({
  onComplete,
  onSkip,
}: {
  onComplete: (baseline: RomBaseline) => void;
  onSkip: () => void;
}) {
  const maxRef = useRef<MaxRom>({ ...ZERO });
  const startRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const pose = useMediaPipePose({
    onFrame: (f) => {
      const w = f.worldLandmarks;
      if (!w?.length) return;
      const m = maxRef.current;
      const aL = armElevationDeg(w, "left");
      const aR = armElevationDeg(w, "right");
      const kL = kneeRaiseDeg(w, "left");
      const kR = kneeRaiseDeg(w, "right");
      if (aL != null) m.armL = Math.max(m.armL, aL);
      if (aR != null) m.armR = Math.max(m.armR, aR);
      if (kL != null) m.kneeL = Math.max(m.kneeL, kL);
      if (kR != null) m.kneeR = Math.max(m.kneeR, kR);
      if (aL != null || kL != null) m.frames += 1;
    },
  });

  const [live, setLive] = useState<MaxRom>({ ...ZERO });
  const [secondsLeft, setSecondsLeft] = useState(60);
  const running = pose.status === "running";

  const finish = useCallback(() => {
    pose.stop();
    const m = maxRef.current;
    onComplete({
      capturedAt: Date.now(),
      armElevationDeg: { left: Math.round(m.armL), right: Math.round(m.armR) },
      kneeRaiseDeg: { left: Math.round(m.kneeL), right: Math.round(m.kneeR) },
      frames: m.frames,
    });
  }, [onComplete, pose]);

  const begin = useCallback(async () => {
    maxRef.current = { ...ZERO };
    setLive({ ...ZERO });
    setSecondsLeft(60);
    startRef.current = Date.now();
    await pose.start();
  }, [pose]);

  // countdown + live mirror (avoids re-rendering on every pose frame)
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setLive({ ...maxRef.current });
      const left = Math.max(0, CAPTURE_MS - (Date.now() - startRef.current));
      setSecondsLeft(Math.ceil(left / 1000));
      if (left <= 0) finish();
    }, 250);
    return () => window.clearInterval(id);
  }, [running, finish]);

  // skeleton preview
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      const lm = pose.latest.current;
      if (lm) {
        drawSkeleton(ctx, lm, { width: w, height: h, mirror: true, ink: "#121311" });
        drawLegAccent(ctx, lm, { width: w, height: h, mirror: true });
      } else {
        ctx.fillStyle = "rgba(18,19,17,0.4)";
        ctx.font = "12px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText(
          running ? "Step back so your whole body is in view" : "Camera off",
          w / 2,
          h / 2,
        );
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [pose.latest, running]);

  useEffect(() => () => pose.stop(), [pose]);

  const progress = 1 - secondsLeft / 60;
  const enough = live.frames > 20 && (live.armL > 0 || live.kneeL > 0 || live.armR > 0 || live.kneeR > 0);

  return (
    <div>
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[1.25rem] border border-line bg-card shadow-soft">
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        {running && (
          <div className="absolute left-4 right-4 top-4 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-pill bg-paper-soft">
              <div className="h-full rounded-pill bg-signal transition-[width] duration-300 ease-editorial" style={{ width: `${progress * 100}%` }} />
            </div>
            <span className="font-mono text-xs tabular-nums text-ink">{secondsLeft}s</span>
          </div>
        )}
        {!running && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-paper/70 backdrop-blur-sm">
            <p className="max-w-xs text-center text-sm text-ink-soft">
              Stand a few steps back so your whole body is visible. When the timer starts, slowly raise
              both arms overhead, then lift each knee as high as is comfortable.
            </p>
            <div className="flex gap-2">
              <button
                onClick={begin}
                disabled={pose.status === "loading"}
                className="rounded-pill bg-night px-6 py-2.5 text-sm font-medium text-paper-soft transition-colors hover:bg-ink disabled:opacity-50"
              >
                {pose.status === "loading" ? "Starting camera…" : "Start 60-second baseline"}
              </button>
              <button onClick={onSkip} className="rounded-pill border border-line px-5 py-2.5 text-sm text-ink transition-colors hover:bg-paper-soft">
                Skip for now
              </button>
            </div>
          </div>
        )}
      </div>

      {/* live captured maxima */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <RomTile label="Arm · left" value={live.armL} />
        <RomTile label="Arm · right" value={live.armR} />
        <RomTile label="Knee · left" value={live.kneeL} />
        <RomTile label="Knee · right" value={live.kneeR} />
      </div>

      {(pose.status === "denied" || pose.status === "error") && (
        <div className="mt-3 rounded-card border border-line bg-paper-soft px-4 py-3 text-sm text-ink-soft">
          {pose.error} You can skip the baseline — your games will start at a neutral difficulty.
        </div>
      )}

      {running && (
        <div className="mt-4 flex justify-end">
          <button
            onClick={finish}
            disabled={!enough}
            className="rounded-pill bg-signal px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-signal-deep disabled:opacity-40"
          >
            Capture baseline →
          </button>
        </div>
      )}
    </div>
  );
}

function RomTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-card border border-line bg-card p-3">
      <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-ink-faint">{label}</div>
      <div className="mt-1 font-mono text-2xl leading-none tabular-nums text-ink">
        {Math.round(value)}
        <span className="ml-0.5 text-sm text-ink-faint">°</span>
      </div>
    </div>
  );
}
