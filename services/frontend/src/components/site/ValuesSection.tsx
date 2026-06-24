"use client";

import { VALUES } from "@/lib/site-data";
import { ArrowButton, Reveal, RevealWords } from "./primitives";

export default function ValuesSection() {
  return (
    <section id="values" className="relative border-t border-line bg-paper py-24 sm:py-32">
      <div className="mx-auto max-w-shell px-5 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-2">
          {/* Left */}
          <div className="flex flex-col justify-between">
            <h2 className="heading-xl balance max-w-md text-[clamp(2rem,4vw,3.4rem)]">
              <RevealWords text={VALUES.heading} />
            </h2>
            <Reveal delay={0.15}>
              <div className="mt-12 flex flex-wrap gap-3">
                {VALUES.pills.map((p) => (
                  <span
                    key={p}
                    className="rounded-pill bg-paper-soft px-4 py-2.5 text-sm text-ink-soft shadow-soft transition-colors duration-300 hover:bg-signal/10 hover:text-signal-deep"
                  >
                    <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-signal align-middle" />
                    {p}
                  </span>
                ))}
              </div>
            </Reveal>
          </div>

          {/* Right */}
          <div className="flex flex-col justify-between border-t border-line pt-8 lg:border-l lg:border-t-0 lg:pl-12 lg:pt-0">
            <Reveal delay={0.1}>
              <p className="max-w-md text-xl leading-relaxed text-ink sm:text-2xl">
                {VALUES.body}
              </p>
            </Reveal>
            <Reveal delay={0.2}>
              <div className="mt-12 max-w-xs">
                <ArrowButton href="#cta" block>
                  {VALUES.cta}
                </ArrowButton>
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
