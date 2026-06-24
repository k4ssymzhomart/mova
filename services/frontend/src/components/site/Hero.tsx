"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";

import { HERO, HERO_STATS } from "@/lib/site-data";
import { CountUp, EASE } from "./primitives";

export default function Hero() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });

  // Parallax + cinematic fade as you scroll past the hero.
  const mediaY = useTransform(scrollYProgress, [0, 1], ["0%", "20%"]);
  const mediaScale = useTransform(scrollYProgress, [0, 1], [1, 1.14]);
  const contentY = useTransform(scrollYProgress, [0, 1], ["0%", "-14%"]);
  const contentOpacity = useTransform(scrollYProgress, [0, 0.8], [1, 0]);

  return (
    <section
      ref={ref}
      id="top"
      data-nav-dark
      className="relative h-[100svh] min-h-[680px] w-full overflow-hidden bg-night"
    >
      {/* Footage layer — drop a real loop at /public/hero.mp4 and it takes over. */}
      <motion.div
        style={{ y: mediaY, scale: mediaScale }}
        className="absolute inset-0 will-change-transform"
      >
        <div className="grain absolute inset-0 h-full w-full">
          <img
            src="https://picsum.photos/seed/mova-hero-motion/2000/1400"
            alt=""
            className="kenburns h-full w-full object-cover"
          />
        </div>
        <video
          className="absolute inset-0 h-full w-full object-cover"
          autoPlay
          muted
          loop
          playsInline
        >
          <source src="/hero.webm" type="video/webm" />
          <source src="/hero.mp4" type="video/mp4" />
        </video>
      </motion.div>

      {/* Cinematic dark wash for legibility */}
      <div className="absolute inset-0 bg-night/55" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(11,15,12,0.85),transparent_60%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(11,15,12,0.9),transparent_55%)]" />

      {/* Content */}
      <motion.div
        style={{ y: contentY, opacity: contentOpacity }}
        className="relative z-10 mx-auto flex h-full max-w-shell flex-col justify-end px-5 pb-20 sm:px-8 sm:pb-24"
      >
        <div className="grid items-end gap-10 lg:grid-cols-[1.5fr_0.8fr]">
          {/* Headline */}
          <div className="max-w-2xl">
            <h1 className="display text-[clamp(2.6rem,7vw,6rem)] text-white">
              {HERO.heading.map((line, i) => (
                <span key={i} className="block overflow-hidden">
                  <motion.span
                    className={`block ${
                      i === HERO.heading.length - 1 ? "text-signal-bright" : ""
                    }`}
                    initial={{ y: "110%" }}
                    animate={{ y: 0 }}
                    transition={{ duration: 1, ease: EASE, delay: 0.3 + i * 0.12 }}
                  >
                    {line}
                  </motion.span>
                </span>
              ))}
            </h1>
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, ease: EASE, delay: 0.75 }}
              className="mt-6 max-w-md text-base leading-relaxed text-white/80 sm:text-lg"
            >
              {HERO.sub}
            </motion.p>
          </div>

          {/* Right column — stats */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, ease: EASE, delay: 0.55 }}
            className="w-full"
          >
            <div className="flex flex-col gap-4">
              {HERO_STATS.map((s) => (
                <div key={s.label} className="border-t border-line-light pt-3">
                  <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/55">
                    {s.label}
                  </div>
                  <div className="mt-1 flex items-end justify-between">
                    <CountUp
                      value={s.value}
                      suffix={s.suffix}
                      className="text-3xl font-medium tracking-tight text-white sm:text-4xl"
                    />
                    <span className="pb-1 text-signal-bright/70">›</span>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </motion.div>

      {/* Scroll hint */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.4, duration: 1 }}
        className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2"
      >
        <div className="h-10 w-[1px] bg-white/25">
          <motion.div
            className="h-3 w-[1px] bg-signal-bright"
            animate={{ y: [0, 28, 0] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>
      </motion.div>
    </section>
  );
}
