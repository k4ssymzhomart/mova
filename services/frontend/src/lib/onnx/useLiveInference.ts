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
  simulated?: boolean; // true when produced by the offline fallback, not the real ONNX graph
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

// — Simulated fallback ————————————————————————————————————————————————————————
// When the .onnx binaries aren't deployed, we still want a live, plausible, clearly-labelled readout
// so the session never bricks. This produces a smoothly-drifting FoG risk + a mode-appropriate HAR
// distribution from the (git-tracked) label vocab. It is explicitly flagged `simulated: true`.
const MOCK_HAR: Record<InferMode, string[]> = {
  gait: ["walking", "stairs_up", "stairs_down", "standing", "knees_bending_crouching"],
  reach: ["frontal_elevation_arms", "lateral_elevation_arms", "arms_inner_rotation", "shoulders_high_rotation", "frontal_crossing_arms"],
};

function mockPredict(meta: ModelMeta, mode: InferMode, side: Side, tick: number): LivePrediction {
  // FoG risk: slow sine drift + light jitter; gait sits in a higher, in-distribution band.
  const base = mode === "gait" ? 0.32 : 0.16;
  const wave = (Math.sin(tick / 9) + 1) / 2; // 0..1, ~slow
  const jitter = (Math.random() - 0.5) * 0.07;
  const risk = Math.min(0.96, Math.max(0.02, base + wave * 0.4 + jitter));

  const pool = MOCK_HAR[mode].filter((l) => meta.har_labels.includes(l));
  const labels = pool.length ? pool : meta.har_labels.slice(0, 5);
  const lead = Math.floor(((Math.sin(tick / 17) + 1) / 2) * labels.length) % labels.length;
  const ranked = labels
    .map((label, i) => ({ label, p: i === lead ? 1.6 : Math.random() * 0.5 }))
    .sort((a, b) => b.p - a.p);
  const probs = softmax(ranked.map((r) => r.p));
  const top = ranked.map((r, i) => ({ label: r.label, p: probs[i] })).slice(0, 3);

  return {
    har: { label: top[0].label, prob: top[0].p, top },
    fog: { risk, valid: mode === "gait" },
    mode,
    latencyMs: 0,
    at: performance.now(),
    simulated: true,
  };
}

export function useLiveInference() {
  const fog = useOnnxModel("/models/fog.onnx");
  const har = useOnnxModel("/models/har.onnx");
  const metaRef = useRef<ModelMeta | null>(null);
  const [ready, setReady] = useState(false);
  const [simulated, setSimulated] = useState(false);
  const simulatedRef = useRef(false);
  const tickRef = useRef(0);
  const busyRef = useRef(false);

  const loadAll = useCallback(async () => {
    if (!metaRef.current) {
      const res = await fetch("/models/model_meta.json").catch(() => null);
      if (res?.ok) metaRef.current = (await res.json()) as ModelMeta;
    }
    const [fogStatus, harStatus] = await Promise.all([fog.load(), har.load()]);
    // If either real graph is missing/broken, fall back to simulated scoring (labels come from the
    // git-tracked model_meta.json, so this works even with zero .onnx binaries on the server).
    const realReady = fogStatus === "ready" && harStatus === "ready";
    const sim = !realReady && !!metaRef.current;
    simulatedRef.current = sim;
    setSimulated(sim);
    setReady(true);
  }, [fog, har]);

  /** Normalize a raw [200,6] window in place-ish and run both models. Skips if a run is in flight. */
  const infer = useCallback(
    async (raw: Float32Array, mode: InferMode = "reach", side: Side = "right"): Promise<LivePrediction | null> => {
      const meta = metaRef.current;
      if (!meta) return null;
      // Offline fallback: synthesize a plausible, clearly-flagged readout (no real graph available).
      if (simulatedRef.current) return mockPredict(meta, mode, side, ++tickRef.current);
      if (busyRef.current) return null;
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

  const realReady = fog.status === "ready" && har.status === "ready";
  const status: OnnxStatus =
    realReady || simulated
      ? "ready" // simulated mode is "ready" too — the live loop runs and produces flagged readouts
      : fog.status === "loading" || har.status === "loading"
        ? "loading"
        : fog.status === "unavailable" || har.status === "unavailable"
          ? "unavailable"
          : fog.status === "error" || har.status === "error"
            ? "error"
            : "idle";

  return { status, ready, simulated, loadAll, infer, meta: metaRef };
}
