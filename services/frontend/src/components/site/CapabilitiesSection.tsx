"use client";

import {
  AnimatePresence,
  motion,
  useScroll,
  useTransform,
  useMotionValueEvent,
} from "framer-motion";
import { useRef, useState } from "react";

import { CAPABILITIES, CAPABILITIES_INTRO } from "@/lib/site-data";
import { ArrowButton, EASE, Kicker, RevealWords } from "./primitives";

const N = CAPABILITIES.length;

export default function CapabilitiesSection() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });
  const [active, setActive] = useState(0);

  useMotionValueEvent(scrollYProgress, "change", (p) => {
    const i = Math.min(N - 1, Math.max(0, Math.floor(p * N)));
    if (i !== active) setActive(i);
  });

  const railFill = useTransform(scrollYProgress, [0, 1], ["0%", "100%"]);
  const cap = CAPABILITIES[active];

  return (
    <section id="capabilities" className="relative bg-paper">
      {/* Intro */}
      <div className="mx-auto max-w-shell px-5 pb-4 pt-24 sm:px-8 sm:pt-32">
        <Kicker>Capabilities · the arc of recovery</Kicker>
        <h2 className="heading-xl balance mt-5 max-w-4xl text-[clamp(2rem,4.6vw,3.7rem)]">
          <RevealWords text={CAPABILITIES_INTRO.heading} />
        </h2>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-soft">
          From the first unsteady step to the last rep at home, Mova reads the
          whole story of movement — one capability at a time.
        </p>
      </div>

      {/* Sticky scroll-narrative stepper */}
      <div ref={ref} style={{ height: `${N * 62 + 40}vh` }}>
        <div className="sticky top-0 flex h-[100svh] items-center overflow-hidden">
          <div className="mx-auto grid w-full max-w-shell items-center gap-10 px-5 sm:px-8 lg:grid-cols-[0.95fr_1.05fr]">
            {/* Left — the narration */}
            <div className="relative flex gap-6">
              {/* vertical progress rail */}
              <div className="relative hidden w-[2px] shrink-0 bg-line sm:block">
                <motion.div
                  style={{ height: railFill }}
                  className="absolute left-0 top-0 w-full bg-signal"
                />
                {CAPABILITIES.map((c, i) => (
                  <button
                    key={c.title}
                    aria-label={c.title}
                    onClick={() => {
                      const el = ref.current;
                      if (!el) return;
                      const top =
                        el.offsetTop + (el.offsetHeight - window.innerHeight) * (i / N) + 8;
                      window.scrollTo({ top, behavior: "smooth" });
                    }}
                    className="absolute -left-[5px] flex h-3 w-3 items-center justify-center"
                    style={{ top: `${(i / (N - 1)) * 100}%` }}
                  >
                    <span
                      className={`h-3 w-3 rounded-full border-2 transition-colors duration-300 ${
                        i <= active
                          ? "border-signal bg-signal"
                          : "border-line bg-paper"
                      }`}
                    />
                  </button>
                ))}
              </div>

              <div className="min-h-[340px] flex-1">
                <div className="flex items-center gap-3 font-mono text-sm text-signal">
                  <span>{String(active + 1).padStart(2, "0")}</span>
                  <span className="h-px w-8 bg-signal/40" />
                  <span className="text-ink-faint">{String(N).padStart(2, "0")}</span>
                </div>

                <AnimatePresence mode="wait">
                  <motion.div
                    key={cap.title}
                    initial={{ opacity: 0, y: 22, filter: "blur(6px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    exit={{ opacity: 0, y: -16, filter: "blur(6px)" }}
                    transition={{ duration: 0.5, ease: EASE }}
                  >
                    <h3 className="mt-5 text-[clamp(1.9rem,3.4vw,3rem)] font-medium tracking-tight">
                      {cap.title}
                    </h3>
                    <span className="mt-3 inline-block rounded-pill bg-signal/10 px-3 py-1 text-xs font-medium text-signal-deep">
                      {cap.units}
                    </span>
                    <p className="mt-5 max-w-md text-lg leading-relaxed text-ink-soft">
                      {cap.overview}
                    </p>
                  </motion.div>
                </AnimatePresence>

                <div className="mt-9 max-w-xs">
                  <ArrowButton href="/signin" variant="signal" block>
                    {CAPABILITIES_INTRO.cta}
                  </ArrowButton>
                </div>
              </div>
            </div>

            {/* Right — the crossfading visual */}
            <div className="relative aspect-[5/6] w-full overflow-hidden rounded-card bg-night shadow-card sm:aspect-[4/3] lg:aspect-[5/6]">
              {CAPABILITIES.map((c, i) => (
                <motion.div
                  key={c.title}
                  className="absolute inset-0"
                  initial={false}
                  animate={{
                    opacity: i === active ? 1 : 0,
                    scale: i === active ? 1 : 1.06,
                  }}
                  transition={{ duration: 0.7, ease: EASE }}
                >
                  <img
                    src={c.image}
                    alt={c.title}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </motion.div>
              ))}
              <div className="absolute inset-0 bg-gradient-to-t from-night/70 via-transparent to-transparent" />
              <div className="absolute inset-x-5 bottom-5">
                <div className="text-sm uppercase tracking-[0.2em] text-white/60">
                  Capability {String(active + 1).padStart(2, "0")}
                </div>
                <div className="text-2xl font-medium text-white">{cap.title}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
