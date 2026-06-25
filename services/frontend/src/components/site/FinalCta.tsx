"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";

import { useTranslation } from "@/locales/client";
import { ArrowButton, Kicker, RevealWords } from "./primitives";

export default function FinalCta() {
  const { t } = useTranslation();
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
        <Kicker light>{t("landing.finalCta.subtitle")}</Kicker>
        <h2 className="display mt-6 max-w-4xl text-[clamp(2.1rem,5vw,4.4rem)]">
          <RevealWords text={t("landing.finalCta.title")} />
        </h2>
        <div className="mt-12 max-w-sm">
          <ArrowButton variant="light" href="/signin" block>
            {t("landing.finalCta.cta")}
          </ArrowButton>
        </div>
      </div>
    </section>
  );
}
