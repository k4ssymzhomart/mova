"use client";

// useOnnxModel — onnxruntime-web (WASM) loader for the Phase-3 FoG/HAR exports.
//
// Wires the full WASM backend: it dynamically imports onnxruntime-web, points the runtime at the CDN
// wasm artifacts, and creates an InferenceSession from a model served out of /public/models. The
// Phase-3 ONNX signature is fixed by the encoder architecture:
//   window      float32 [B, 200, 6]   (50 Hz · 4 s · acc+gyro)
//   placement_id int64   [B]
//   dataset_id   int64   [B]            ->  logits float32 [B, C]
//
// For Phase 4 the inputs are mocked (random window) — the point is to prove the browser can load and
// execute the real exported graph end-to-end. If the model file is absent the hook reports
// "unavailable" rather than throwing, so the CV/game loop is never blocked on it.

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

export function useOnnxModel(modelUrl: string) {
  const sessionRef = useRef<unknown>(null);
  const ortRef = useRef<typeof OrtNS | null>(null);
  const [status, setStatus] = useState<OnnxStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [io, setIo] = useState<{ inputs: string[]; outputs: string[] } | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      // Probe first so a missing artifact degrades cleanly instead of throwing deep in ORT.
      const head = await fetch(modelUrl, { method: "HEAD" }).catch(() => null);
      if (!head || !head.ok) {
        setStatus("unavailable");
        return;
      }
      const ort = (await import(/* webpackIgnore: true */ ORT_ESM_URL)) as typeof OrtNS;
      ort.env.wasm.wasmPaths = ORT_CDN_DIST;
      ortRef.current = ort;
      const session = await ort.InferenceSession.create(modelUrl, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      });
      sessionRef.current = session;
      setIo({ inputs: [...session.inputNames], outputs: [...session.outputNames] });
      setStatus("ready");
    } catch (err) {
      setStatus("error");
      setError((err as Error).message ?? "Failed to load ONNX model.");
    }
  }, [modelUrl]);

  const runMock = useCallback(async (): Promise<InferenceResult | null> => {
    const ort = ortRef.current;
    const session = sessionRef.current as {
      run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: Float32Array; dims: number[] }>>;
      inputNames: readonly string[];
      outputNames: readonly string[];
    } | null;
    if (!ort || !session) return null;

    const window = new Float32Array(WINDOW_LEN * CHANNELS);
    for (let i = 0; i < window.length; i += 1) window[i] = (Math.random() - 0.5) * 2;
    const feeds: Record<string, unknown> = {
      window: new ort.Tensor("float32", window, [1, WINDOW_LEN, CHANNELS]),
      placement_id: new ort.Tensor("int64", new BigInt64Array([0n]), [1]),
      dataset_id: new ort.Tensor("int64", new BigInt64Array([0n]), [1]),
    };
    const t0 = performance.now();
    const out = await session.run(feeds);
    const latencyMs = performance.now() - t0;
    const head = out[session.outputNames[0]];
    return { logits: Array.from(head.data), outputDims: head.dims, latencyMs };
  }, []);

  return { status, error, io, load, runMock };
}
