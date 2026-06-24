"use client";

import {
  motion,
  useScroll,
  useTransform,
  useMotionValueEvent,
  type MotionValue,
} from "framer-motion";
import { useRef } from "react";

import { EMOTION } from "@/lib/site-data";
import FluidCanvas from "./FluidCanvas";

/* Opening-sentence word: rises + brightens over its slice. */
function OpeningWord({
  word,
  progress,
  start,
  end,
}: {
  word: string;
  progress: MotionValue<number>;
  start: number;
  end: number;
}) {
  const opacity = useTransform(progress, [start, end], [0.1, 1]);
  const y = useTransform(progress, [start, end], [16, 0]);
  return (
    <motion.span style={{ opacity, y }} className="mr-[0.26em] inline-block">
      {word}
    </motion.span>
  );
}

/* Descriptor word: scrubs fully in, holds, then out — one at a time. */
function DescriptorWord({
  word,
  progress,
  start,
  end,
}: {
  word: string;
  progress: MotionValue<number>;
  start: number;
  end: number;
}) {
  const span = end - start;
  const inEnd = start + span * 0.26;
  const outStart = end - span * 0.22;
  const opacity = useTransform(
    progress,
    [start, inEnd, outStart, end],
    [0, 1, 1, 0]
  );
  const y = useTransform(
    progress,
    [start, inEnd, outStart, end],
    [40, 0, 0, -40]
  );
  const scale = useTransform(
    progress,
    [start, inEnd, outStart, end],
    [1.22, 1, 1, 0.94]
  );
  const blur = useTransform(
    progress,
    [start, inEnd, outStart, end],
    [18, 0, 0, 18]
  );
  const filter = useTransform(blur, (b) => `blur(${b}px)`);
  return (
    <motion.span
      style={{ opacity, y, scale, filter }}
      className="absolute inset-0 flex items-center justify-center text-center text-[clamp(3rem,12vw,9rem)] font-medium tracking-tight text-white"
    >
      {word}
    </motion.span>
  );
}

/* Generic phrase fade-in/out tied to a progress window. */
function Phrase({
  progress,
  range,
  className,
  children,
}: {
  progress: MotionValue<number>;
  range: [number, number, number, number];
  className?: string;
  children: React.ReactNode;
}) {
  const opacity = useTransform(progress, range, [0, 1, 1, 0]);
  const y = useTransform(progress, range, [26, 0, 0, -22]);
  return (
    <motion.div style={{ opacity, y }} className={className}>
      {children}
    </motion.div>
  );
}

export default function EmotionSection() {
  const ref = useRef<HTMLDivElement>(null);
  const progressRef = useRef(0);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });
  useMotionValueEvent(scrollYProgress, "change", (p) => {
    progressRef.current = p;
  });

  // Opening sentence words
  const openWords = [
    ...EMOTION.line1.split(" "),
    EMOTION.emphasis,
    ...EMOTION.line2.split(" "),
  ];
  const oStart = 0.02;
  const oEnd = 0.22;
  const oStep = (oEnd - oStart) / openWords.length;
  const openingOpacity = useTransform(
    scrollYProgress,
    [0, 0.03, 0.24, 0.29],
    [0, 1, 1, 0]
  );

  // Descriptor phase (wide window so each word lingers on slow scroll)
  const dStart = 0.3;
  const dEnd = 0.68;
  const dStep = (dEnd - dStart) / EMOTION.descriptors.length;
  const descLeadOpacity = useTransform(
    scrollYProgress,
    [0.28, 0.32, 0.66, 0.7],
    [0, 1, 1, 0]
  );

  return (
    <section ref={ref} data-nav-dark className="relative h-[440vh] bg-night">
      <div className="sticky top-0 flex h-[100svh] items-center justify-center overflow-hidden">
        <FluidCanvas progressRef={progressRef} />

        {/* Phase A — opening sentence */}
        <motion.h2
          style={{ opacity: openingOpacity }}
          className="display absolute z-10 max-w-4xl px-6 text-center text-[clamp(2rem,5.4vw,4.4rem)] leading-[1.06] text-white/95"
        >
          {openWords.map((w, i) => {
            const s = oStart + i * oStep;
            const e = Math.min(s + oStep * 1.8, oEnd);
            return (
              <OpeningWord key={i} word={w} progress={scrollYProgress} start={s} end={e} />
            );
          })}
        </motion.h2>

        {/* Phase B — descriptor words, one at a time */}
        <motion.p
          style={{ opacity: descLeadOpacity }}
          className="absolute top-[24%] z-10 px-6 text-center text-sm uppercase tracking-[0.28em] text-white/55"
        >
          {EMOTION.descriptorsLead}
        </motion.p>
        <div className="absolute inset-x-0 top-1/2 z-10 mx-auto h-[1px] max-w-5xl -translate-y-1/2">
          {EMOTION.descriptors.map((d, i) => {
            const s = dStart + i * dStep;
            const e = s + dStep;
            return (
              <DescriptorWord
                key={d}
                word={d}
                progress={scrollYProgress}
                start={s}
                end={e}
              />
            );
          })}
        </div>

        {/* Phase C — the turn */}
        <Phrase
          progress={scrollYProgress}
          range={[0.7, 0.77, 0.82, 0.87]}
          className="display absolute z-10 max-w-3xl px-6 text-center text-[clamp(1.9rem,4.6vw,3.6rem)] leading-[1.1] text-white"
        >
          {EMOTION.transition}
        </Phrase>

        {/* Phase D — green resolution */}
        <Phrase
          progress={scrollYProgress}
          range={[0.88, 0.93, 1, 1]}
          className="absolute z-10 flex max-w-3xl flex-col items-center px-6 text-center"
        >
          <span className="text-sm uppercase tracking-[0.28em] text-white/60">
            {EMOTION.resolveLead}
          </span>
          <span className="display mt-4 text-[clamp(2.4rem,6.5vw,5.5rem)] leading-[1.02] text-white">
            {EMOTION.resolve}
          </span>
          <span className="mt-6 max-w-md text-base leading-relaxed text-white/75">
            {EMOTION.resolveSub}
          </span>
        </Phrase>
      </div>
    </section>
  );
}
