"use client";

import type { LivePrediction } from "@/lib/onnx/useLiveInference";

import { Bar, LivePill, Panel } from "./ui";

interface Props {
  status: "idle" | "loading" | "ready" | "unavailable" | "error";
  prediction: LivePrediction | null;
  fill: number; // buffer 0..1
  inferences: number;
}

const HAR_PRETTY = (s: string) => s.replace(/_/g, " ");

/** Live engineering telemetry — real on-device ONNX output over the pose-derived virtual IMU. */
export default function SessionTelemetry({ status, prediction, fill, inferences }: Props) {
  const live = status === "ready" && inferences > 0;
  return (
    <Panel label="Edge inference · onnxruntime-web" right={<LivePill live={live} />}>
      <div className="space-y-5">
        {/* HAR */}
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-ink-faint">
              Activity · HAR
            </span>
            {prediction?.har && (
              <span className="font-mono text-xs tabular-nums text-ink-faint">
                {Math.round(prediction.har.prob * 100)}%
              </span>
            )}
          </div>
          {prediction?.har ? (
            <>
              <div className="font-serif text-2xl italic leading-none text-ink">
                {HAR_PRETTY(prediction.har.label)}
              </div>
              <div className="mt-3 space-y-2">
                {prediction.har.top.map((t) => (
                  <div key={t.label} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 truncate font-mono text-[11px] text-ink-soft">
                      {HAR_PRETTY(t.label)}
                    </span>
                    <Bar value={t.p} />
                    <span className="w-9 shrink-0 text-right font-mono text-[11px] tabular-nums text-ink-faint">
                      {Math.round(t.p * 100)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="font-mono text-sm text-ink-faint">—</div>
          )}
        </div>

        {/* FoG */}
        <div className="border-t border-line pt-4">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-ink-faint">
              Freeze risk · FoG
            </span>
            {prediction?.fog && (
              <span className="font-mono text-xs tabular-nums text-ink-faint">
                {Math.round(prediction.fog.risk * 100)}%
              </span>
            )}
          </div>
          <Bar value={prediction?.fog?.risk ?? 0} tone={(prediction?.fog?.risk ?? 0) > 0.5 ? "ink" : "signal"} />
          <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
            Arm-derived preview of the on-device FoG model — a live pipeline demonstration, not a clinical reading.
          </p>
        </div>

        {/* engine stats */}
        <dl className="grid grid-cols-3 gap-3 border-t border-line pt-4 font-mono text-[11px] tabular-nums">
          <Stat k="buffer" v={`${Math.round(fill * 100)}%`} />
          <Stat k="latency" v={prediction ? `${prediction.latencyMs.toFixed(0)}ms` : "—"} />
          <Stat k="runs" v={String(inferences)} />
        </dl>
        {status === "unavailable" && (
          <p className="text-[11px] text-ink-faint">
            Models not found in /public/models — run <code>npm run models:sync</code>.
          </p>
        )}
      </div>
    </Panel>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="uppercase tracking-[0.14em] text-ink-faint">{k}</dt>
      <dd className="mt-1 text-base text-ink">{v}</dd>
    </div>
  );
}
