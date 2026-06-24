"use client";

// useLiveInference — the end-to-end edge bridge.
//
// Takes a raw [200,6] virtual-IMU window (g, rad/s) from the pose pipeline, train-normalizes it with
// the same per-channel stats the Python dataloader used, and runs BOTH exported graphs off the main
// thread: HAR (wrist placement / HHAR conditioning) and FoG (ankle placement / Daphnet conditioning).
// Returns labelled, softmaxed predictions for the live telemetry. Models + metadata are fetched from
// /public/models; if either is missing the hook stays "unavailable" and the CV loop is unaffected.

import { useCallback, useRef, useState } from "react";

import { type OnnxStatus, useOnnxModel } from "./useOnnxModel";

const CH = 6;

// Which body region the live virtual-IMU window came from. "gait" carries a lower-leg (shank/ankle)
// signal, which is in-distribution for the Daphnet-trained FoG model; "reach" carries a forearm signal
// and the FoG readout is only a pipeline preview.
export type InferMode = "reach" | "gait";
export type Side = "left" | "right";

export interface ModelMeta {
  har_labels: string[];
  fog_labels: string[];
  placement_vocab: Record<string, number>;
  dataset_vocab: Record<string, number>;
  norm_stats: { mean: number[]; std: number[] };
}

export interface LivePrediction {
  har: { label: string; prob: number; top: { label: string; p: number }[] } | null;
  fog: { risk: number; valid: boolean } | null; // valid = window is lower-limb (in-distribution)
  mode: InferMode;
  latencyMs: number;
  at: number;
}

/**
 * Map a capture mode + tracked side onto the encoder's placement/dataset conditioning ids.
 * - gait: FoG ← ankle / Daphnet (the worn-sensor placement it was trained on), HAR ← that leg's calf /
 *   REALDISP (whose labels — walking, stairs, knee-bends — are lower-limb).
 * - reach: unchanged from the original forearm pipeline (HAR ← wrist / HHAR; FoG ← ankle preview).
 */
function routeIds(meta: ModelMeta, mode: InferMode, side: Side) {
  const pv = meta.placement_vocab;
  const dv = meta.dataset_vocab;
  if (mode === "gait") {
    const calf = side === "left" ? pv.l_calf : pv.r_calf;
    return {
      harPl: calf ?? pv.ankle ?? 0,
      harDs: dv.realdisp ?? 2,
      fogPl: pv.ankle ?? 0,
      fogDs: dv.daphnet_fog ?? 0,
      fogValid: true,
    };
  }
  return {
    harPl: pv.wrist ?? 0,
    harDs: dv.hhar ?? 1,
    fogPl: pv.ankle ?? 0,
    fogDs: dv.daphnet_fog ?? 0,
    fogValid: false,
  };
}

function softmax(logits: number[]): number[] {
  const m = Math.max(...logits);
  const ex = logits.map((v) => Math.exp(v - m));
  const s = ex.reduce((a, b) => a + b, 0) || 1;
  return ex.map((v) => v / s);
}

export function useLiveInference() {
  const fog = useOnnxModel("/models/fog.onnx");
  const har = useOnnxModel("/models/har.onnx");
  const metaRef = useRef<ModelMeta | null>(null);
  const [ready, setReady] = useState(false);
  const busyRef = useRef(false);

  const loadAll = useCallback(async () => {
    if (!metaRef.current) {
      const res = await fetch("/models/model_meta.json").catch(() => null);
      if (res?.ok) metaRef.current = (await res.json()) as ModelMeta;
    }
    await Promise.all([fog.load(), har.load()]);
    setReady(true);
  }, [fog, har]);

  /** Normalize a raw [200,6] window in place-ish and run both models. Skips if a run is in flight. */
  const infer = useCallback(
    async (raw: Float32Array, mode: InferMode = "reach", side: Side = "right"): Promise<LivePrediction | null> => {
      const meta = metaRef.current;
      if (busyRef.current || !meta) return null;
      busyRef.current = true;
      try {
        const { mean, std } = meta.norm_stats;
        const x = new Float32Array(raw.length);
        for (let k = 0; k < raw.length; k += 1) {
          const c = k % CH;
          const sd = std[c] < 1e-6 ? 1 : std[c];
          x[k] = (raw[k] - mean[c]) / sd;
        }
        const r = routeIds(meta, mode, side);

        const [harOut, fogOut] = await Promise.all([
          har.run(x, r.harPl, r.harDs),
          fog.run(x, r.fogPl, r.fogDs),
        ]);

        let harPred: LivePrediction["har"] = null;
        if (harOut) {
          const probs = softmax(harOut.logits);
          const ranked = probs
            .map((p, i) => ({ label: meta.har_labels[i] ?? `class_${i}`, p }))
            .sort((a, b) => b.p - a.p);
          harPred = { label: ranked[0].label, prob: ranked[0].p, top: ranked.slice(0, 3) };
        }
        let fogPred: LivePrediction["fog"] = null;
        if (fogOut) {
          const probs = softmax(fogOut.logits);
          fogPred = { risk: probs[1] ?? 0, valid: r.fogValid };
        }
        const latencyMs = Math.max(harOut?.latencyMs ?? 0, fogOut?.latencyMs ?? 0);
        return { har: harPred, fog: fogPred, mode, latencyMs, at: performance.now() };
      } finally {
        busyRef.current = false;
      }
    },
    [fog, har],
  );

  const status: OnnxStatus =
    fog.status === "ready" && har.status === "ready"
      ? "ready"
      : fog.status === "unavailable" || har.status === "unavailable"
        ? "unavailable"
        : fog.status === "loading" || har.status === "loading"
          ? "loading"
          : fog.status === "error" || har.status === "error"
            ? "error"
            : "idle";

  return { status, ready, loadAll, infer, meta: metaRef };
}
