"use client";

import { useState } from "react";

import { type InferenceResult, useOnnxModel } from "@/lib/onnx/useOnnxModel";

import { GhostButton, MonoLabel } from "./mono";

const MODELS = {
  fog: { url: "/models/fog.onnx", label: "FoG", classes: ["no-freeze", "freeze"] },
  har: { url: "/models/har.onnx", label: "HAR", classes: null as string[] | null },
} as const;
type ModelKey = keyof typeof MODELS;

function softmaxArgmax(logits: number[]): { idx: number; p: number } {
  const m = Math.max(...logits);
  const ex = logits.map((v) => Math.exp(v - m));
  const sum = ex.reduce((a, b) => a + b, 0);
  let idx = 0;
  for (let i = 1; i < ex.length; i += 1) if (ex[i] > ex[idx]) idx = i;
  return { idx, p: ex[idx] / sum };
}

/**
 * Phase-3 ONNX integration (prep/stub). The onnxruntime-web WASM backend is fully wired and reads the
 * real exported graph from /public/models; inputs are mocked for now so the focus stays on the CV/game
 * loop. If a model file is absent the panel says so instead of failing.
 */
export default function OnnxPanel() {
  const [key, setKey] = useState<ModelKey>("fog");
  const model = useOnnxModel(MODELS[key].url);
  const [result, setResult] = useState<InferenceResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setResult(await model.runMock());
    setBusy(false);
  };

  const pred =
    result && MODELS[key].classes
      ? (() => {
          const { idx, p } = softmaxArgmax(result.logits.slice(0, MODELS[key].classes!.length));
          return `${MODELS[key].classes![idx]} · p=${p.toFixed(2)}`;
        })()
      : null;

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {(Object.keys(MODELS) as ModelKey[]).map((k) => (
          <GhostButton
            key={k}
            active={key === k}
            onClick={() => {
              setKey(k);
              setResult(null);
            }}
          >
            {MODELS[k].label}
          </GhostButton>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <GhostButton onClick={model.load} disabled={model.status === "loading"}>
          {model.status === "loading" ? "Loading…" : "Load model"}
        </GhostButton>
        <GhostButton onClick={run} disabled={model.status !== "ready" || busy}>
          Run inference
        </GhostButton>
      </div>

      <dl className="space-y-1 font-mono text-[11px] text-black/70">
        <Row k="runtime" v="onnxruntime-web · wasm" />
        <Row k="artifact" v={MODELS[key].url} />
        <Row
          k="status"
          v={
            model.status === "unavailable"
              ? "not in /public/models (run copy script)"
              : model.status
          }
        />
        {model.error && <Row k="error" v={model.error} />}
        {model.io && <Row k="inputs" v={model.io.inputs.join(", ")} />}
        {result && <Row k="output" v={`[${result.outputDims.join("×")}] · ${result.latencyMs.toFixed(1)} ms`} />}
        {pred && <Row k="argmax" v={pred} />}
      </dl>

      <p className="border-t border-black/10 pt-2">
        <MonoLabel>Inputs are mocked this phase — the loader executes the real graph.</MonoLabel>
      </p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="uppercase tracking-[0.12em] text-black/45">{k}</dt>
      <dd className="text-right text-black">{v}</dd>
    </div>
  );
}
