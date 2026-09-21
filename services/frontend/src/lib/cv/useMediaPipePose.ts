"use client";

// useMediaPipePose — browser-side pose engine.
//
// Requests the webcam, runs MediaPipe Pose Landmarker over the live feed on a requestAnimationFrame
// loop, and exposes the latest 33 landmarks through a *ref* (not state) so the 30–60 Hz detection loop
// never triggers React re-renders. The heavy @mediapipe/tasks-vision module is dynamically imported on
// start() so it stays out of the SSR/initial bundle. Privacy-first: the raw <video> is owned by the
// caller and can be kept off-screen — only keypoints leave this hook.

import { useCallback, useEffect, useRef, useState } from "react";

import type { Landmark } from "./landmarks";

export type PoseStatus = "idle" | "loading" | "running" | "denied" | "error";

export interface PoseFrameData {
  landmarks: Landmark[]; // normalized image space (x,y in [0,1])
  worldLandmarks: Landmark[]; // metric, hip-centered
  timestampMs: number;
}

export interface UseMediaPipePoseOptions {
  onFrame?: (frame: PoseFrameData) => void;
  /** Overrides the self-hosted-then-CDN search. Given one, only this path is tried. */
  modelAssetPath?: string;
  /** Overrides the self-hosted-then-CDN search. Given one, only this base is tried. */
  wasmBasePath?: string;
  numPoses?: number;
  /**
   * Which lens to ask for. "user" is the selfie camera (a laptop in front of the patient); "environment"
   * is the rear camera, which is what a phone propped 2-3 m away filming a supine patient needs.
   * Requested as `{ ideal }` rather than an exact string, so a laptop that only has a front camera still
   * starts instead of throwing OverconstrainedError.
   */
  facingMode?: "user" | "environment";
  /** Capture size. The 640x480 default is 4:3, which is the aspect the stages lay their canvas out at. */
  videoWidth?: number;
  videoHeight?: number;
  /**
   * Whether the measured frame rate is lifted into React state twice a second. It is a diagnostic
   * number, and lifting it re-renders whatever component called this hook at 2 Hz. The default is true
   * because turning it off by default would silently zero an existing readout (SessionStudio prints it);
   * a screen that mounts this hook high in its tree should pass false and read `fpsRef.current` instead.
   */
  reportFps?: boolean;
}

// Where the wasm runtime and the pose model come from, in order. scripts/fetch-models.mjs puts both
// under /mediapipe on prebuild, so a normal deploy serves them from our own origin and the feature
// works on a network that cannot reach Google or jsDelivr. That script never fails the build, so the
// local copy may simply not be there — hence the CDN entries after it, and the loop in start() that
// moves on to the next candidate when one throws. A caller that passes an explicit path gets that path
// and nothing else: an override is a decision, not a preference.
const SELF_HOSTED_WASM = "/mediapipe/wasm";
const SELF_HOSTED_MODEL = "/mediapipe/pose_landmarker_lite.task";
const CDN_WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const CDN_MODEL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

export function useMediaPipePose(options: UseMediaPipePoseOptions = {}) {
  const {
    onFrame,
    modelAssetPath,
    wasmBasePath,
    numPoses = 1,
    facingMode = "user",
    videoWidth = 640,
    videoHeight = 480,
    reportFps = true,
  } = options;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const latest = useRef<Landmark[] | null>(null);

  const landmarkerRef = useRef<unknown>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const lastVideoTimeRef = useRef(-1);
  const fpsRef = useRef({ last: performance.now(), frames: 0 });
  /** The same number as `fps`, readable without a re-render. Written every 500 ms whatever reportFps is. */
  const fpsValueRef = useRef(0);
  const reportFpsRef = useRef(reportFps);
  reportFpsRef.current = reportFps;

  const [status, setStatus] = useState<PoseStatus>("idle");
  const [fps, setFps] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  const loop = useCallback(() => {
    const video = videoRef.current;
    const landmarker = landmarkerRef.current as {
      detectForVideo: (v: HTMLVideoElement, t: number) => {
        landmarks?: Landmark[][];
        worldLandmarks?: Landmark[][];
      };
    } | null;
    if (!runningRef.current || !video || !landmarker) return;

    if (video.readyState >= 2 && video.currentTime !== lastVideoTimeRef.current) {
      lastVideoTimeRef.current = video.currentTime;
      try {
        const result = landmarker.detectForVideo(video, performance.now());
        const lm = result.landmarks?.[0] ?? null;
        latest.current = lm;
        if (lm) {
          onFrameRef.current?.({
            landmarks: lm,
            worldLandmarks: result.worldLandmarks?.[0] ?? [],
            timestampMs: performance.now(),
          });
        }
      } catch {
        // a single dropped frame must not kill the loop
      }

      const f = fpsRef.current;
      f.frames += 1;
      const now = performance.now();
      if (now - f.last >= 500) {
        fpsValueRef.current = Math.round((f.frames * 1000) / (now - f.last));
        if (reportFpsRef.current) setFps(fpsValueRef.current);
        f.frames = 0;
        f.last = now;
      }
    }
    rafRef.current = requestAnimationFrame(loop);
  }, []);

  const stop = useCallback(() => {
    runningRef.current = false;
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const lk = landmarkerRef.current as { close?: () => void } | null;
    lk?.close?.();
    landmarkerRef.current = null;
    latest.current = null;
    lastVideoTimeRef.current = -1;
    fpsValueRef.current = 0;
    setFps(0);
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    if (runningRef.current) return;
    setError(null);
    setStatus("loading");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: videoWidth, height: videoHeight, facingMode: { ideal: facingMode } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("video element not mounted");
      video.srcObject = stream;
      await video.play();

      const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");

      // Self-hosted first, CDN second. The first candidate that loads wins; the last one's error is
      // the one the caller sees, because by then nothing is left to try.
      const wasmBases = wasmBasePath ? [wasmBasePath] : [SELF_HOSTED_WASM, CDN_WASM];
      const modelPaths = modelAssetPath ? [modelAssetPath] : [SELF_HOSTED_MODEL, CDN_MODEL];

      let vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>> | null = null;
      let lastErr: unknown = null;
      for (const base of wasmBases) {
        try {
          vision = await FilesetResolver.forVisionTasks(base);
          break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (!vision) throw lastErr ?? new Error("Could not load the MediaPipe wasm runtime.");

      let landmarker = null;
      for (const path of modelPaths) {
        // GPU first, then CPU: the same two-step this hook has always done, now per model source.
        for (const delegate of ["GPU", "CPU"] as const) {
          try {
            landmarker = await PoseLandmarker.createFromOptions(vision, {
              baseOptions: { modelAssetPath: path, delegate },
              runningMode: "VIDEO",
              numPoses,
            });
            break;
          } catch (e) {
            lastErr = e;
          }
        }
        if (landmarker) break;
      }
      if (!landmarker) throw lastErr ?? new Error("Could not load the pose model.");
      landmarkerRef.current = landmarker;

      runningRef.current = true;
      setStatus("running");
      rafRef.current = requestAnimationFrame(loop);
    } catch (err) {
      const e = err as { name?: string; message?: string };
      // Release the stream FIRST. stop() ends with setStatus("idle"), so running it after the lines
      // below would batch "idle" over the failure and the caller's denied/error banner would never
      // render — which is exactly what happened before this was reordered.
      stop();
      if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
        setStatus("denied");
        setError("Camera permission denied.");
      } else {
        setStatus("error");
        setError(e.message ?? "Failed to start the pose engine.");
      }
    }
  }, [facingMode, loop, modelAssetPath, numPoses, stop, videoHeight, videoWidth, wasmBasePath]);

  useEffect(() => () => stop(), [stop]);

  return { videoRef, latest, status, fps, fpsRef: fpsValueRef, error, start, stop };
}
