"use client";

import { type MutableRefObject, type RefObject, useEffect, useRef } from "react";

import { drawLegAccent, drawSkeleton, landmarkPx, wristPx } from "@/lib/cv/drawSkeleton";
import type { Landmark } from "@/lib/cv/landmarks";
import { POSE_LANDMARKS } from "@/lib/cv/landmarks";
import { GaitGame, type GaitStats } from "@/lib/game/gait";
import { ReachingGame, type ReachingStats } from "@/lib/game/reaching";

export type SessionMode = "reach" | "gait";

export type StageStats =
  | { mode: "reach"; reach: ReachingStats }
  | { mode: "gait"; gait: GaitStats };

interface PoseStageProps {
  videoRef: RefObject<HTMLVideoElement>;
  landmarks: MutableRefObject<Landmark[] | null>;
  running: boolean;
  showVideo: boolean;
  mode: SessionMode;
  side: "left" | "right";
  tempoSpm?: number; // gait cadence target (steps/min)
  difficulty?: number; // 0..1 ability knob seeded from the baseline ROM
  onStats?: (s: StageStats) => void;
}

/**
 * The session stage. A pure paper clinical surface: the camera frame never appears unless explicitly
 * toggled on (privacy-first); by default only the ink skeletal wireframe + the active exercise game
 * render. One requestAnimationFrame loop owns drawing; landmarks arrive through a ref so detection never
 * re-renders React. The `mode` selects upper-limb reaching vs lower-limb gait/balance.
 */
export default function PoseStage({
  videoRef,
  landmarks,
  running,
  showVideo,
  mode,
  side,
  tempoSpm = 67,
  difficulty = 0.5,
  onStats,
}: PoseStageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reachRef = useRef<ReachingGame>(new ReachingGame());
  const gaitRef = useRef<GaitGame>(new GaitGame());
  const rafRef = useRef<number | null>(null);
  const showVideoRef = useRef(showVideo);
  const modeRef = useRef(mode);
  const sideRef = useRef(side);
  const tempoRef = useRef(tempoSpm);
  const appliedTempoRef = useRef(-1);
  const difficultyRef = useRef(difficulty);
  const runningRef = useRef(running);
  const statsTick = useRef(0);
  showVideoRef.current = showVideo;
  modeRef.current = mode;
  sideRef.current = side;
  tempoRef.current = tempoSpm;
  difficultyRef.current = difficulty;
  runningRef.current = running;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reach = reachRef.current;
    const gait = gaitRef.current;

    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      reach.resize(w, h);
      gait.resize(w, h);
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

      const now = performance.now();
      if (runningRef.current && lm) {
        drawSkeleton(ctx, lm, { width: w, height: h, mirror: true, ink: "#121311" });
        if (modeRef.current === "gait") {
          drawLegAccent(ctx, lm, { width: w, height: h, mirror: true });
          gait.lead = sideRef.current;
          gait.hitLift = 0.4 + 0.2 * difficultyRef.current; // limited ROM -> lower lift required
          if (appliedTempoRef.current !== tempoRef.current) {
            gait.setTempoSpm(tempoRef.current);
            appliedTempoRef.current = tempoRef.current;
          }
          gait.update(sampleLowerBody(lm, w, h), now);
          gait.draw(ctx, now);
        } else {
          reach.difficulty = difficultyRef.current;
          const wrist = wristPx(lm, sideRef.current, w, h, true);
          reach.update(wrist, now);
          reach.draw(ctx, now);
        }
      } else {
        if (modeRef.current === "gait") gait.update(null, now);
        idleStage(ctx, w, h, runningRef.current, modeRef.current);
      }

      statsTick.current += 1;
      if (onStats && statsTick.current % 6 === 0) {
        onStats(
          modeRef.current === "gait"
            ? { mode: "gait", gait: { ...gait.stats } }
            : { mode: "reach", reach: { ...reach.stats } },
        );
      }
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

/** Build the gait engine's lower-body sample from image-space landmarks (mirror only affects foot x). */
function sampleLowerBody(lm: Landmark[], w: number, h: number) {
  const la = lm[POSE_LANDMARKS.leftAnkle];
  const ra = lm[POSE_LANDMARKS.rightAnkle];
  const lk = lm[POSE_LANDMARKS.leftKnee];
  const rk = lm[POSE_LANDMARKS.rightKnee];
  const lh = lm[POSE_LANDMARKS.leftHip];
  const rh = lm[POSE_LANDMARKS.rightHip];
  if (!la || !ra || !lk || !rk || !lh || !rh) return null;
  const hipY = (lh.y + rh.y) / 2;
  const leftFoot = landmarkPx(lm, POSE_LANDMARKS.leftAnkle, w, h, true, 0.3);
  const rightFoot = landmarkPx(lm, POSE_LANDMARKS.rightAnkle, w, h, true, 0.3);
  return {
    left: { footX: leftFoot ? leftFoot[0] : NaN, ankleY: la.y, kneeY: lk.y },
    right: { footX: rightFoot ? rightFoot[0] : NaN, ankleY: ra.y, kneeY: rk.y },
    hipY,
  };
}

function idleStage(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  running: boolean,
  mode: SessionMode,
) {
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
  const hint = mode === "gait" ? "step in view of the camera" : "reach for the targets";
  ctx.fillText(
    running ? "Acquiring pose…" : `Camera idle — start your session to ${hint}`,
    w / 2,
    h / 2,
  );
}
