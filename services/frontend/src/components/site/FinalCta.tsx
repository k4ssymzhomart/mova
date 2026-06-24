"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";

import { FINAL_CTA } from "@/lib/site-data";
import { ArrowButton, Kicker, RevealWords } from "./primitives";

export default function FinalCta() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const y = useTransform(scrollYProgress, [0, 1], ["12%", "-12%"]);

  return (
    <section
      id="cta"
      ref={ref}
      data-nav-dark
      className="relative flex min-h-[90svh] items-center overflow-hidden bg-night text-white"
    >
      {/* parallax footage */}
      <motion.div style={{ y }} className="absolute inset-0 will-change-transform">
        <div className="grain absolute inset-0">
          <img
            src="https://picsum.photos/seed/mova-cta/2000/1400"
            alt=""
            className="h-full w-full scale-110 object-cover opacity-40"
          />
        </div>
        <div className="absolute inset-0 bg-gradient-to-b from-night/80 via-night/60 to-night" />
      </motion.div>

      <div className="relative z-10 mx-auto w-full max-w-shell px-5 sm:px-8">
        <Kicker light>{FINAL_CTA.kicker}</Kicker>
        <h2 className="display mt-6 max-w-4xl text-[clamp(2.1rem,5vw,4.4rem)]">
          <RevealWords text={FINAL_CTA.heading} />
        </h2>
        <div className="mt-12 max-w-sm">
          <ArrowButton variant="light" href="mailto:hello@mova.health" block>
            {FINAL_CTA.cta}
          </ArrowButton>
        </div>
      </div>
    </section>
  );
}
