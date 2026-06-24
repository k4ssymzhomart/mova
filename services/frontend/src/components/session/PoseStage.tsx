"use client";

import { type MutableRefObject, type RefObject, useEffect, useRef } from "react";

import { drawSkeleton, wristPx } from "@/lib/cv/drawSkeleton";
import type { Landmark } from "@/lib/cv/landmarks";
import { ReachingGame, type ReachingStats } from "@/lib/game/reaching";

interface PoseStageProps {
  videoRef: RefObject<HTMLVideoElement>;
  landmarks: MutableRefObject<Landmark[] | null>;
  running: boolean;
  showVideo: boolean;
  side: "left" | "right";
  onStats?: (s: ReachingStats) => void;
}

/**
 * The session stage. A pure white clinical surface: the camera frame never appears unless explicitly
 * toggled on (privacy-first); by default only the black skeletal wireframe + the reaching game render.
 * One requestAnimationFrame loop owns drawing; landmarks arrive through a ref so detection never
 * re-renders React.
 */
export default function PoseStage({
  videoRef,
  landmarks,
  running,
  showVideo,
  side,
  onStats,
}: PoseStageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef<ReachingGame>(new ReachingGame());
  const rafRef = useRef<number | null>(null);
  const showVideoRef = useRef(showVideo);
  const sideRef = useRef(side);
  const runningRef = useRef(running);
  const statsTick = useRef(0);
  showVideoRef.current = showVideo;
  sideRef.current = side;
  runningRef.current = running;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const game = gameRef.current;

    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      game.resize(w, h);
      return { w, h };
    };

    const render = () => {
      const { w, h } = fit();
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);

      const lm = landmarks.current;
      const video = videoRef.current;
      if (showVideoRef.current && video && video.readyState >= 2) {
        ctx.save();
        ctx.globalAlpha = 0.16;
        ctx.translate(w, 0);
        ctx.scale(-1, 1); // mirror (selfie)
        ctx.drawImage(video, 0, 0, w, h);
        ctx.restore();
      }

      if (runningRef.current && lm) {
        drawSkeleton(ctx, lm, { width: w, height: h, mirror: true, ink: "#121311" });
        const wrist = wristPx(lm, sideRef.current, w, h, true);
        game.update(wrist, performance.now());
        game.draw(ctx, performance.now());
      } else {
        idleStage(ctx, w, h, runningRef.current);
      }

      statsTick.current += 1;
      if (onStats && statsTick.current % 6 === 0) onStats({ ...game.stats });
      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [landmarks, onStats, videoRef]);

  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-card border border-line bg-card shadow-soft">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      {/* hidden source feed — owned here, never shown unless drawn into the canvas */}
      <video ref={videoRef} className="hidden" playsInline muted />
    </div>
  );
}

function idleStage(ctx: CanvasRenderingContext2D, w: number, h: number, running: boolean) {
  ctx.strokeStyle = "rgba(18,19,17,0.06)";
  ctx.lineWidth = 1;
  const step = 40;
  ctx.beginPath();
  for (let x = step; x < w; x += step) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, h);
  }
  for (let y = step; y < h; y += step) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(w, y + 0.5);
  }
  ctx.stroke();
  ctx.fillStyle = "rgba(18,19,17,0.40)";
  ctx.font = "11px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText(
    running ? "Acquiring pose…" : "Camera idle — start your session to begin",
    w / 2,
    h / 2,
  );
}
