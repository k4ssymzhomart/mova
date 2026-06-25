"use client";

// useOnnxModel — onnxruntime-web (WASM) loader + runner for one Phase-3 export.
//
// Wires the full WASM backend: dynamically imports onnxruntime-web, points the runtime at the CDN wasm
// artifacts, runs inference off the main thread (wasm proxy worker) so the camera/render loop stays
// smooth, and creates an InferenceSession from a model served out of /public/models. Signature (fixed
// by the encoder):
//   window      float32 [B, 200, 6]   (50 Hz · 4 s · acc+gyro, train-normalized)
//   placement_id int64   [B]
//   dataset_id   int64   [B]            ->  logits float32 [B, C]
// A missing model file reports "unavailable" instead of throwing, so the CV/game loop is never blocked.

import { useCallback, useRef, useState } from "react";

// Type-only import (erased at build time — pulls no code into the bundle).
import type * as OrtNS from "onnxruntime-web";

export type OnnxStatus = "idle" | "loading" | "ready" | "unavailable" | "error";

const WINDOW_LEN = 200;
const CHANNELS = 6;
const ORT_CDN_DIST = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/";
// Load ORT as a native ESM module straight from the CDN at runtime. The `webpackIgnore` magic comment
// keeps webpack from bundling it — onnxruntime-web's wasm bundles use top-level `import.meta`, which
// Terser cannot minify as a webpack asset, so bundling it breaks `next build`. Loading it externally
// (same pattern as MediaPipe's CDN wasm) sidesteps that entirely and keeps our client bundle small.
const ORT_ESM_URL = `${ORT_CDN_DIST}ort.wasm.bundle.min.mjs`;

export interface InferenceResult {
  logits: number[];
  outputDims: number[];
  latencyMs: number;
}

type Session = {
  run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: Float32Array; dims: number[] }>>;
  inputNames: readonly string[];
  outputNames: readonly string[];
};

export function useOnnxModel(modelUrl: string) {
  const sessionRef = useRef<Session | null>(null);
  const ortRef = useRef<typeof OrtNS | null>(null);
  const [status, setStatus] = useState<OnnxStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [io, setIo] = useState<{ inputs: string[]; outputs: string[] } | null>(null);

  // Returns the resolved status so callers (useLiveInference) can decide synchronously whether to
  // switch to simulated scoring — React state updates here aren't readable until the next render.
  const load = useCallback(async (): Promise<OnnxStatus> => {
    if (sessionRef.current) return "ready";
    setStatus("loading");
    setError(null);
    try {
      // Probe first so a missing artifact degrades cleanly instead of throwing deep in ORT.
      const head = await fetch(modelUrl, { method: "HEAD" }).catch(() => null);
      if (!head || !head.ok) {
        setStatus("unavailable");
        return "unavailable";
      }
      const ort = (await import(/* webpackIgnore: true */ ORT_ESM_URL)) as typeof OrtNS;
      ort.env.wasm.wasmPaths = ORT_CDN_DIST;
      ort.env.wasm.proxy = true; // run the session in a worker -> never blocks the UI thread
      ortRef.current = ort;
      const session = (await ort.InferenceSession.create(modelUrl, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      })) as unknown as Session;
      sessionRef.current = session;
      setIo({ inputs: [...session.inputNames], outputs: [...session.outputNames] });
      setStatus("ready");
      return "ready";
    } catch (err) {
      setStatus("error");
      setError((err as Error).message ?? "Failed to load ONNX model.");
      return "error";
    }
  }, [modelUrl]);

  /** Run the real graph on a [200,6] train-normalized window. Returns logits + latency. */
  const run = useCallback(
    async (window: Float32Array, placementId: number, datasetId: number): Promise<InferenceResult | null> => {
      const ort = ortRef.current;
      const session = sessionRef.current;
      if (!ort || !session) return null;
      const feeds: Record<string, unknown> = {
        window: new ort.Tensor("float32", window, [1, WINDOW_LEN, CHANNELS]),
        placement_id: new ort.Tensor("int64", new BigInt64Array([BigInt(placementId)]), [1]),
        dataset_id: new ort.Tensor("int64", new BigInt64Array([BigInt(datasetId)]), [1]),
      };
      const t0 = performance.now();
      const out = await session.run(feeds);
      const latencyMs = performance.now() - t0;
      const headOut = out[session.outputNames[0]];
      return { logits: Array.from(headOut.data), outputDims: headOut.dims, latencyMs };
    },
    [],
  );

  /** Run on a random window — used by the standalone loader panel to smoke-test the WASM backend. */
  const runMock = useCallback(async (): Promise<InferenceResult | null> => {
    const w = new Float32Array(WINDOW_LEN * CHANNELS);
    for (let i = 0; i < w.length; i += 1) w[i] = (Math.random() - 0.5) * 2;
    return run(w, 0, 0);
  }, [run]);

  return { status, error, io, load, run, runMock };
}
