"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Plus } from "lucide-react";
import { useState } from "react";

import { FAQ } from "@/lib/site-data";
import { ArrowButton, EASE, Reveal } from "./primitives";

export default function FaqSection() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="relative border-t border-line bg-paper py-24 sm:py-32">
      <div className="mx-auto grid max-w-shell gap-12 px-5 sm:px-8 lg:grid-cols-[0.8fr_1.2fr]">
        {/* Left rail */}
        <div className="lg:sticky lg:top-28 lg:self-start">
          <h2 className="heading-xl balance max-w-sm text-[clamp(1.8rem,3.4vw,2.8rem)]">
            {FAQ.heading}
          </h2>
          <p className="mt-6 text-ink-soft">{FAQ.prompt}</p>
          <div className="mt-6 max-w-xs">
            <ArrowButton href="#cta" block>
              {FAQ.cta}
            </ArrowButton>
          </div>
        </div>

        {/* Accordion */}
        <div className="divide-y divide-line border-y border-line">
          {FAQ.items.map((item, i) => {
            const isOpen = open === i;
            return (
              <Reveal key={item.q} delay={i * 0.04} y={12}>
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-start justify-between gap-6 py-6 text-left"
                >
                  <span className="text-lg font-medium text-ink sm:text-xl">{item.q}</span>
                  <motion.span
                    animate={{ rotate: isOpen ? 45 : 0 }}
                    transition={{ duration: 0.3, ease: EASE }}
                    className={`mt-1 shrink-0 transition-colors ${
                      isOpen ? "text-signal" : "text-ink-soft"
                    }`}
                  >
                    <Plus className="h-5 w-5" strokeWidth={1.6} />
                  </motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.4, ease: EASE }}
                      className="overflow-hidden"
                    >
                      <p className="max-w-xl pb-7 text-base leading-relaxed text-ink-soft">
                        {item.a}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
