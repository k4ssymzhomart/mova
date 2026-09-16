"use client";

// HeelSlideGuide — a side view of the patient lying on their back, with a leg that bends as they slide the heel.
// Ported from Phoenix's LiveLegGuide: the same figure and the same requestAnimationFrame + refs mechanism.
//
// The drawing angle is the relative sensor-orientation proxy (lib/motion/flexion), clamped to 0–120 for drawing
// only (lib/motion/legGuide). That makes it a picture that follows the sensors, not a knee-angle measurement, and
// the caption says so. Phoenix's goal pose, degree readout, scale and "reached" state presented the proxy as knee
// flexion and are not ported.
//
// `readProxy` is polled once per animation frame and everything that moves is written straight onto the SVG
// through refs, so nothing re-renders at the sensors' rate. The motion is the patient's own leg, so it keeps
// moving under prefers-reduced-motion; the smoothing only takes out sensor jitter.

import { useEffect, useRef } from "react";

import { card } from "@/components/app/recipes";
import { createSmoother, drawAngleDeg, heelSlidePose } from "@/lib/motion/legGuide";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/locales/client";

// Figure geometry, in the SVG's own units. The view box is cropped to the figure: at the 120-degree drawing limit
// the knee rises to about y=89, and the foot never passes x=210.
const HIP = { x: 104, y: 140 };
const THIGH_LENGTH = 50;
const SHANK_LENGTH = 45;
const BED_Y = 152;
const BED_X1 = 2;
const BED_X2 = 230;
const FOOT_DX = 7;
const FOOT_DY = -20;
const VIEW_BOX = "0 84 232 74";

const REST_POSE = heelSlidePose(0, HIP, THIGH_LENGTH, SHANK_LENGTH);

export default function HeelSlideGuide({ readProxy }: { readProxy: () => number | null }) {
  const { t } = useTranslation();
  const thighRef = useRef<SVGLineElement>(null);
  const shankRef = useRef<SVGLineElement>(null);
  const footRef = useRef<SVGLineElement>(null);
  const kneeRef = useRef<SVGCircleElement>(null);

  useEffect(() => {
    const draw = (deg: number) => {
      const { knee, foot } = heelSlidePose(deg, HIP, THIGH_LENGTH, SHANK_LENGTH);
      setLine(thighRef.current, HIP.x, HIP.y, knee.x, knee.y);
      setLine(shankRef.current, knee.x, knee.y, foot.x, foot.y);
      // On their back, the foot stands up off the heel.
      setLine(footRef.current, foot.x, foot.y, foot.x + FOOT_DX, foot.y + FOOT_DY);
      kneeRef.current?.setAttribute("cx", String(knee.x));
      kneeRef.current?.setAttribute("cy", String(knee.y));
    };

    const smooth = createSmoother();
    let drawn: number | null = null;
    let handle = 0;
    const tick = (now: number) => {
      // Unknown (no signal yet, baseline still filling) draws the leg straight.
      const deg = smooth(drawAngleDeg(readProxy()), now);
      if (Number.isFinite(deg) && (drawn === null || Math.abs(deg - drawn) >= 0.05)) {
        draw(deg);
        drawn = deg;
      }
      handle = window.requestAnimationFrame(tick);
    };
    handle = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(handle);
  }, [readProxy]);

  return (
    <figure className={cn(card, "flex flex-col justify-center px-5 py-5")}>
      {/* The figure redraws continuously; hidden from assistive technology, which gets the caption and the
          repetition count instead. */}
      <svg viewBox={VIEW_BOX} className="mx-auto block h-auto w-full max-w-xl" aria-hidden="true" focusable="false">
        <line
          x1={BED_X1}
          y1={BED_Y}
          x2={BED_X2}
          y2={BED_Y}
          className="stroke-ink/20"
          strokeWidth={3}
          strokeLinecap="round"
        />
        <circle cx={18} cy={130} r={11} className="fill-ink/10" />
        <rect x={28} y={124} width={80} height={24} rx={12} className="fill-ink/10" />
        <line
          ref={thighRef}
          x1={HIP.x}
          y1={HIP.y}
          x2={REST_POSE.knee.x}
          y2={REST_POSE.knee.y}
          className="stroke-signal"
          strokeWidth={18}
          strokeLinecap="round"
        />
        <line
          ref={shankRef}
          x1={REST_POSE.knee.x}
          y1={REST_POSE.knee.y}
          x2={REST_POSE.foot.x}
          y2={REST_POSE.foot.y}
          className="stroke-signal"
          strokeWidth={15}
          strokeLinecap="round"
        />
        <line
          ref={footRef}
          x1={REST_POSE.foot.x}
          y1={REST_POSE.foot.y}
          x2={REST_POSE.foot.x + FOOT_DX}
          y2={REST_POSE.foot.y + FOOT_DY}
          className="stroke-signal"
          strokeWidth={11}
          strokeLinecap="round"
        />
        <circle
          ref={kneeRef}
          cx={REST_POSE.knee.x}
          cy={REST_POSE.knee.y}
          r={8}
          className="fill-card stroke-signal-deep"
          strokeWidth={4}
        />
        <circle cx={HIP.x} cy={HIP.y} r={7} className="fill-card stroke-ink-faint" strokeWidth={3} />
      </svg>
      <figcaption className="mt-4 text-sm leading-relaxed text-ink-soft">{t("flow.exercise.guideCaption")}</figcaption>
    </figure>
  );
}

function setLine(line: SVGLineElement | null, x1: number, y1: number, x2: number, y2: number): void {
  if (!line) return;
  line.setAttribute("x1", String(x1));
  line.setAttribute("y1", String(y1));
  line.setAttribute("x2", String(x2));
  line.setAttribute("y2", String(y2));
}
