"use client";

// ExerciseVisionStage — the camera "exoskeleton".
//
// WHY THIS EXISTS. Every exercise in this app is counted from three BLE sensors, and a patient without
// that hardware cannot do a session at all. This component runs the pose engine that already lives in
// src/lib/cv on the live camera, draws the body as an ink wireframe on a white clinical stage, accents
// the one limb the exercise is watched on, and reads that exercise's own joint angle off the landmarks.
// It exists so an exercise can be done with nothing attached to the leg.
//
// WHAT IT IS NOT. It is not goniometry and it is not a substitute for the sensors. The angle is
// measured in the camera's image plane (lib/cv/jointAngles), so it is only meaningful while the camera
// is level and roughly side-on to the movement, and nothing here checks that it is. The caption says so
// in the patient's own words, the same way flow.exercise.guideCaption does for the IMU proxy. The
// number drives a drawing and a repetition count; it is never stored or shown as a measured knee angle,
// and this component invents no target — a target is a value the caller passes in or there is none.
//
// PRIVACY. The camera is OFF until the patient presses the button, and pressing it is the only thing
// that opens it. The <video> element is owned here, never uploaded, never recorded, and never shown
// except as a faint underlay the patient switches on themselves. Only { tMs, deg, confidence } numbers
// leave this component.
//
// PERFORMANCE. It follows PoseStage's discipline: landmarks arrive through a ref, every prop that can
// change is mirrored onto a ref in the render body, one requestAnimationFrame owns all drawing, and the
// hook is mounted HERE rather than in the session screen so its 2 Hz fps state cannot re-render the
// whole session UI (it is asked not to report fps at all). React state is touched only when a whole
// degree or a displayed message changes, and at most ten times a second.
//
// MIRRORING. One derived boolean — mirror = (facing === "user") — is used for the video transform and
// for every draw call in this file. Nothing here passes a mirror literal. A rear camera drawn mirrored
// puts the operated leg on the wrong side of the screen from where the person holding the phone sees it.

import { Camera, CameraOff, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { bodyText, card, secondaryButton, tileLabel } from "@/components/app/recipes";
import { drawLegAccent, drawSkeleton, landmarkPx } from "@/lib/cv/drawSkeleton";
import {
  type AnglePart,
  type JointAngleKind,
  type VisionSide,
  angleChain,
  createAngleSmoother,
  createMedian3,
  readJointAngle,
} from "@/lib/cv/jointAngles";
import type { Landmark } from "@/lib/cv/landmarks";
import type { PoseFrameData, PoseStatus } from "@/lib/cv/useMediaPipePose";
import { useMediaPipePose } from "@/lib/cv/useMediaPipePose";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/locales/client";

// The clinical palette in hex, because canvas cannot use Tailwind classes. These are the same values
// tailwind.config.ts holds for ink, ink-faint, line, signal and signal-deep.
const INK = "#121311";
const INK_FAINT = "rgba(18,19,17,0.40)";
const LINE = "rgba(18,19,17,0.12)";
const SIGNAL = "#16A35B";
const SIGNAL_DEEP = "#0A6E3E";

/** How often a changed readout or hint is allowed to reach React. Ten times a second is plenty to read. */
const READOUT_MS = 100;

/** One accepted frame's angle. This is the whole of what leaves this component. */
export interface VisionAngleSample {
  /** performance.now() at detection — the same clock lib/motion/reps measures its gaps on. */
  tMs: number;
  /** Degrees, median-of-3 filtered. NOT exponentially smoothed: the drawing smooths separately, and a
   *  rep counter should see the movement rather than a lagged version of it. */
  deg: number;
  /** Lowest landmark visibility in the chain the angle was built from, 0..1. */
  confidence: number;
}

export interface ExerciseVisionStageProps {
  /**
   * Which angle this exercise is watched on, from lib/exercises/visionJoint. null when no source states
   * a joint for the exercise: the skeleton still draws, and no angle is shown rather than a guessed one.
   */
  joint: JointAngleKind | null;
  /** The operated side. */
  side: VisionSide;
  /**
   * "environment" (the default) is the rear camera — a phone propped 2-3 m away filming a supine or
   * seated patient side-on, which is the TKA case. "user" is a laptop in front of the patient.
   * Mirroring follows from this and from nothing else.
   */
  facing?: "user" | "environment";
  /**
   * The exercise's target in degrees, shown beside the live value. null (the default) means no source
   * states one, and then none is shown. Never pass 0 to mean "unknown".
   */
  targetDeg?: number | null;
  /** Called once per ACCEPTED frame. Held in a ref, so it may change identity every render. */
  onSample?: (sample: VisionAngleSample) => void;
  /** Camera readiness, so the caller can gate its own start button without mounting the pose hook. */
  onStatusChange?: (status: PoseStatus) => void;
  /** Shown above the readout — the exercise name, usually. */
  label?: string;
}

/** What the stage is currently unable to see. Drives one line of guidance under the canvas. */
type Hint = "none" | "no_pose" | AnglePart;

export default function ExerciseVisionStage({
  joint,
  side,
  facing = "environment",
  targetDeg = null,
  onSample,
  onStatusChange,
  label,
}: ExerciseVisionStageProps) {
  const { t } = useTranslation();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Per-frame values that must never re-render React.
  const rawDegRef = useRef<number | null>(null);
  const hintRef = useRef<Hint>("none");
  const aspectRef = useRef(4 / 3);
  const medianRef = useRef(createMedian3());
  const jointRef = useRef(joint);
  const sideRef = useRef(side);
  const mirrorRef = useRef(facing === "user");
  const onSampleRef = useRef(onSample);
  const showVideoRef = useRef(true);
  // What React is currently showing. The draw loop compares against these before lifting anything, and
  // the reset effect below clears them with the state, so the two can never disagree about what is on
  // screen — a loop-local copy would go on believing it had already shown a hint it had just cleared.
  const shownDegRef = useRef<number | null>(null);
  const shownHintRef = useRef<Hint>("none");
  jointRef.current = joint;
  sideRef.current = side;
  mirrorRef.current = facing === "user";
  onSampleRef.current = onSample;

  // The picture is shown by default: a patient checking their own position has to see themselves, and the whole
  // point of the skeleton is that it sits over the body it was measured from. The switch below turns the picture
  // off for someone who wants the outline alone; either way the frames stay on this device.
  const [showVideo, setShowVideo] = useState(true);
  showVideoRef.current = showVideo;
  const [readoutDeg, setReadoutDeg] = useState<number | null>(null);
  const [hint, setHint] = useState<Hint>("none");

  // Why the camera cannot be opened at all, if it cannot. getUserMedia exists only in a secure context:
  // fine on Vercel and on localhost, absent on a plain-http LAN address — which is exactly how someone
  // would test a phone propped across the room from a patient, so the screen has to say so rather than
  // showing a button that fails. Resolved after mount, so the server render and the first client render
  // agree; null means "not decided yet" and blocks nothing.
  const [blocked, setBlocked] = useState<"insecure" | "unsupported" | null>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    const secure = typeof window !== "undefined" && window.isSecureContext === true;
    const hasApi = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
    setBlocked(!hasApi ? (secure ? "unsupported" : "insecure") : secure ? null : "insecure");
    setChecked(true);
  }, []);

  // Detection callback: ref writes and the caller's stream only. No setState here, ever.
  const handleFrame = useCallback((f: PoseFrameData) => {
    const kind = jointRef.current;
    if (kind === null) {
      // No joint for this exercise: the skeleton is the whole feature. Nothing to reject, nothing to emit.
      hintRef.current = "none";
      return;
    }
    // Always from the raw normalized landmarks, corrected for the frame's aspect. Never from the
    // mirrored pixels landmarkPx returns — see the header of lib/cv/jointAngles.ts.
    const reading = readJointAngle(kind, f.landmarks, sideRef.current, { aspect: aspectRef.current });
    if (!reading.ok) {
      // A rejected frame emits NOTHING. It must not repeat the last good value: a frozen number looks
      // exactly like a patient holding still. The rep counter's own gap rule handles the silence.
      hintRef.current = reading.problem.part ?? "none";
      return;
    }
    hintRef.current = "none";
    const filtered = medianRef.current(reading.sample.deg);
    if (filtered === null) return; // the median window is still filling
    rawDegRef.current = filtered;
    onSampleRef.current?.({
      tMs: f.timestampMs,
      deg: filtered,
      confidence: reading.sample.confidence,
    });
  }, []);

  const pose = useMediaPipePose({
    onFrame: handleFrame,
    facingMode: facing,
    // The fps counter is a diagnostic, and lifting it would re-render this stage twice a second for it.
    reportFps: false,
  });
  const { videoRef, latest, start, stop, status, error } = pose;

  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;
  useEffect(() => {
    onStatusChangeRef.current?.(status);
  }, [status]);

  // One draw loop for the whole component. Stable deps only: videoRef and latest are refs.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const smooth = createAngleSmoother(90);
    // Two independent throttles. One clock for both would let a moving angle, which changes ten times a
    // second, keep the guidance line from ever updating.
    let degAt = 0;
    let hintAt = 0;
    let handle = 0;

    const render = (now: number) => {
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

      const video = videoRef.current;
      const mirror = mirrorRef.current;
      if (video && video.videoWidth > 0 && video.videoHeight > 0) {
        // The real capture aspect, not the 4:3 we asked for: a device is free to hand back another.
        aspectRef.current = video.videoWidth / video.videoHeight;
      }
      if (showVideoRef.current && video && video.readyState >= 2) {
        ctx.save();
        ctx.globalAlpha = 0.16;
        if (mirror) {
          ctx.translate(w, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(video, 0, 0, w, h);
        ctx.restore();
      }

      const lm = latest.current;
      let nextHint: Hint = hintRef.current;
      if (lm) {
        drawSkeleton(ctx, lm, { width: w, height: h, mirror, ink: INK });
        drawLegAccent(ctx, lm, { width: w, height: h, mirror, side: sideRef.current });

        const raw = rawDegRef.current;
        const kind = jointRef.current;
        if (kind !== null && raw !== null) {
          const deg = smooth(raw, now);
          if (Number.isFinite(deg)) {
            drawAngleReadout(ctx, lm, w, h, mirror, kind, sideRef.current, deg);
            const rounded = Math.round(deg);
            if (rounded !== shownDegRef.current && now - degAt >= READOUT_MS) {
              shownDegRef.current = rounded;
              degAt = now;
              setReadoutDeg(rounded);
            }
          }
        }
      } else {
        drawIdleStage(ctx, w, h);
        // No pose at all outranks "your knee is out of frame": the patient is not in the picture.
        nextHint = "no_pose";
      }

      if (nextHint !== shownHintRef.current && now - hintAt >= READOUT_MS) {
        shownHintRef.current = nextHint;
        hintAt = now;
        setHint(nextHint);
      }
      handle = requestAnimationFrame(render);
    };

    handle = requestAnimationFrame(render);
    return () => cancelAnimationFrame(handle);
  }, [latest, videoRef]);

  // A new joint, a new side, or a new camera stream is a new signal: the old median window and the old
  // readout belong to the previous one. Without the status dependency, stopping and restarting the
  // camera would draw the angle from before the stop until the first new frame arrived.
  useEffect(() => {
    medianRef.current = createMedian3();
    rawDegRef.current = null;
    hintRef.current = "none";
    shownDegRef.current = null;
    shownHintRef.current = "none";
    setReadoutDeg(null);
    setHint("none");
  }, [joint, side, status]);

  const running = status === "running";
  const loading = status === "loading";

  return (
    <figure className={cn(card, "overflow-hidden")}>
      <div className="relative aspect-[4/3] w-full bg-card">
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        {/* The source feed. It is drawn into the canvas rather than shown directly, so the skeleton and the
            picture cannot drift apart, and it is moved off-screen rather than display:none, because Safari and
            iOS can stop delivering frames to a display:none video — and a phone propped across the room from
            the patient is exactly an iOS device. */}
        <video
          ref={videoRef}
          className="pointer-events-none absolute -left-[9999px] top-0 size-px opacity-0"
          playsInline
          muted
          autoPlay
        />
        {running && joint !== null && readoutDeg !== null && (
          <div className="absolute right-3 top-3 rounded-card border border-line bg-card/95 px-3 py-2">
            {label && <p className={tileLabel}>{label}</p>}
            <p className={tileLabel}>{t(JOINT_LABEL_KEY[joint])}</p>
            <p className="tnum text-3xl font-semibold text-signal-deep">{readoutDeg}&deg;</p>
            {/* A target is shown only when the caller has one. Nothing is invented to fill the slot. */}
            {typeof targetDeg === "number" && Number.isFinite(targetDeg) && (
              <p className={cn(tileLabel, "tnum")}>{t("vision.target", { n: Math.round(targetDeg) })}</p>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4">
        {!running ? (
          <button
            type="button"
            className={secondaryButton}
            onClick={() => void start()}
            disabled={loading || blocked !== null}
          >
            {loading ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
            ) : (
              <Camera className="size-4" aria-hidden />
            )}
            {loading ? t("vision.starting") : t("vision.enableCamera")}
          </button>
        ) : (
          <>
            <button type="button" className={secondaryButton} onClick={stop}>
              <CameraOff className="size-4" aria-hidden />
              {t("vision.disableCamera")}
            </button>
            <label className="inline-flex min-h-12 items-center gap-2 text-base text-ink">
              <input
                type="checkbox"
                checked={showVideo}
                onChange={(event) => setShowVideo(event.target.checked)}
                className="size-5 accent-[#0A6E3E]"
              />
              {t("vision.showCamera")}
            </label>
          </>
        )}
      </div>

      {checked && blocked !== null && (
        <p className={cn(bodyText, "border-t border-line px-5 py-4")}>
          {t(blocked === "insecure" ? "vision.insecureContext" : "vision.unsupported")}
        </p>
      )}
      {(status === "denied" || status === "error") && (
        <p className="border-t border-line px-5 py-4 text-base text-ink" role="status">
          {status === "denied" ? t("vision.permissionDenied") : t("vision.failed")}
          {/* The browser's own message, in its own language, after ours. It is a diagnostic, not copy. */}
          {status === "error" && error ? ` (${error})` : ""}
        </p>
      )}
      {running && hint !== "none" && (
        <p className="border-t border-line px-5 py-4 text-base text-ink" role="status">
          {t(HINT_KEY[hint])}
        </p>
      )}
      {running && joint === null && (
        <p className={cn(bodyText, "border-t border-line px-5 py-4")}>{t("vision.noJoint")}</p>
      )}

      <figcaption className={cn(bodyText, "border-t border-line px-5 py-4")}>
        {t("vision.privacy")} {t("vision.caption")}
      </figcaption>
    </figure>
  );
}

// Literal keys rather than a template, so every string this file can render is greppable in the locale
// files. The same reason no Tailwind class here is built by interpolation.
const JOINT_LABEL_KEY: Record<JointAngleKind, string> = {
  knee: "vision.jointKnee",
  thigh: "vision.jointThigh",
  ankle: "vision.jointAnkle",
};

// "none" is absent on purpose: it is the state in which nothing is rendered. `vision.outOfFrame` is the
// key that already existed for the knee case; the other three follow its wording for their own part.
const HINT_KEY: Record<Exclude<Hint, "none">, string> = {
  no_pose: "vision.noPose",
  hip: "vision.outOfFrameHip",
  knee: "vision.outOfFrame",
  ankle: "vision.outOfFrameAnkle",
  foot: "vision.outOfFrameFoot",
};

/** The angle arc at the joint plus a small badge, in the clinical palette. */
function drawAngleReadout(
  ctx: CanvasRenderingContext2D,
  lm: Landmark[],
  w: number,
  h: number,
  mirror: boolean,
  joint: JointAngleKind,
  side: VisionSide,
  deg: number,
): void {
  const [ai, bi, ci] = angleChain(joint, side);
  const a = landmarkPx(lm, ai, w, h, mirror, 0.5);
  const b = landmarkPx(lm, bi, w, h, mirror, 0.5);
  const c = landmarkPx(lm, ci, w, h, mirror, 0.5);
  if (!b) return;

  ctx.save();
  // "thigh" repeats its first index, which is how angleChain says there is no arc to draw.
  if (a && c && ai !== bi) {
    const r = 34;
    const a0 = Math.atan2(a[1] - b[1], a[0] - b[0]);
    const a1 = Math.atan2(c[1] - b[1], c[0] - b[0]);
    ctx.beginPath();
    ctx.arc(b[0], b[1], r, a0, a1, shorterWay(a0, a1));
    ctx.strokeStyle = SIGNAL;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(b[0], b[1], 7, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = SIGNAL_DEEP;
  ctx.lineWidth = 3;
  ctx.stroke();

  const text = `${Math.round(deg)}°`;
  ctx.font = "600 15px ui-monospace, monospace";
  const tw = ctx.measureText(text).width;
  const bx = b[0] + 14;
  const by = b[1] - 30;
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.rect(bx, by, tw + 16, 24);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = SIGNAL_DEEP;
  ctx.textBaseline = "middle";
  ctx.fillText(text, bx + 8, by + 12);
  ctx.restore();
}

/** Draw the arc the short way round, so an obtuse angle does not sweep 300 degrees. */
function shorterWay(a0: number, a1: number): boolean {
  let d = a1 - a0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d < 0;
}

/** The empty stage: the same anatomical-chart grid PoseStage draws when it has no pose. */
function drawIdleStage(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.save();
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
  ctx.fillStyle = INK_FAINT;
  ctx.font = "11px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText("—", w / 2, h / 2);
  ctx.restore();
}
