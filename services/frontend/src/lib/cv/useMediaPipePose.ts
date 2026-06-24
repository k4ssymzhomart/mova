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
  modelAssetPath?: string;
  wasmBasePath?: string;
  numPoses?: number;
}

// Defaults resolve from Google's model CDN so the loop runs without any local asset; drop the same
// files in /public/models and point these at "/models/…" to self-host (see public/models/README.md).
const DEFAULT_WASM =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const DEFAULT_MODEL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

export function useMediaPipePose(options: UseMediaPipePoseOptions = {}) {
  const { onFrame, modelAssetPath = DEFAULT_MODEL, wasmBasePath = DEFAULT_WASM, numPoses = 1 } =
    options;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const latest = useRef<Landmark[] | null>(null);

  const landmarkerRef = useRef<unknown>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const lastVideoTimeRef = useRef(-1);
  const fpsRef = useRef({ last: performance.now(), frames: 0 });

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
        setFps(Math.round((f.frames * 1000) / (now - f.last)));
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
    setFps(0);
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    if (runningRef.current) return;
    setError(null);
    setStatus("loading");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("video element not mounted");
      video.srcObject = stream;
      await video.play();

      const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks(wasmBasePath);
      let landmarker;
      try {
        landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath, delegate: "GPU" },
          runningMode: "VIDEO",
          numPoses,
        });
      } catch {
        landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath, delegate: "CPU" },
          runningMode: "VIDEO",
          numPoses,
        });
      }
      landmarkerRef.current = landmarker;

      runningRef.current = true;
      setStatus("running");
      rafRef.current = requestAnimationFrame(loop);
    } catch (err) {
      const e = err as { name?: string; message?: string };
      if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
        setStatus("denied");
        setError("Camera permission denied.");
      } else {
        setStatus("error");
        setError(e.message ?? "Failed to start the pose engine.");
      }
      stop();
    }
  }, [loop, modelAssetPath, numPoses, stop, wasmBasePath]);

  useEffect(() => () => stop(), [stop]);

  return { videoRef, latest, status, fps, error, start, stop };
}
