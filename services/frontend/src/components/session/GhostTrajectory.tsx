"use client";

// GhostTrajectory — the reference-trajectory guide: a live angle-vs-target arc, not a 2D skeletal ghost
// overlay. There's no live camera pose feeding this screen (BLE sensors replace MediaPipe as the ground
// truth), so a cosmetic 2D leg animation would need to keep MediaPipe running just for looks — reopening
// the "camera pose is unreliable for scoring" concern this whole rebuild exists to fix. This shows the
// same information (how far through the movement the patient is, relative to target) honestly, driven
// by the same real angle value the score is computed from.

import { SVGProps } from "react";

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export default function GhostTrajectory({
  currentAngleDeg,
  targetDeg,
  minValidExcursionDeg,
  ...svgProps
}: {
  currentAngleDeg: number;
  targetDeg: number | null;
  minValidExcursionDeg: number;
} & SVGProps<SVGSVGElement>) {
  const scaleMax = Math.max(targetDeg ?? 0, currentAngleDeg, minValidExcursionDeg, 30) * 1.15;
  const toX = (deg: number) => 8 + clamp01(deg / scaleMax) * 284;

  const reached = targetDeg !== null && currentAngleDeg >= targetDeg;

  return (
    <svg viewBox="0 0 300 56" className="w-full" {...svgProps}>
      {/* track */}
      <line x1={8} y1={28} x2={292} y2={28} className="stroke-line" strokeWidth={6} strokeLinecap="round" />
      {/* min-valid-excursion threshold tick */}
      <line
        x1={toX(minValidExcursionDeg)}
        y1={16}
        x2={toX(minValidExcursionDeg)}
        y2={40}
        stroke="currentColor"
        className="text-ink-faint/50"
        strokeWidth={2}
      />
      {/* live fill */}
      <line
        x1={8}
        y1={28}
        x2={toX(currentAngleDeg)}
        y2={28}
        stroke="currentColor"
        className={reached ? "text-signal" : "text-signal/70"}
        strokeWidth={6}
        strokeLinecap="round"
      />
      {/* ghost target marker */}
      {targetDeg !== null && (
        <g>
          <circle cx={toX(targetDeg)} cy={28} r={7} fill="none" stroke="currentColor" className="text-ink" strokeWidth={2} strokeDasharray="3 2" />
        </g>
      )}
      {/* live position marker */}
      <circle cx={toX(currentAngleDeg)} cy={28} r={6} className={reached ? "fill-signal" : "fill-ink"} />
    </svg>
  );
}
