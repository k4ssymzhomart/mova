"use client";

import { ArrowUpRight, ChevronLeft } from "lucide-react";

import Footer from "@/components/site/Footer";
import { Reveal } from "@/components/site/primitives";
import { RESEARCH, RESEARCH_INTRO } from "@/lib/research-data";

export default function ResearchPage() {
  const total = RESEARCH.reduce((n, c) => n + c.papers.length, 0);

  return (
    <div className="min-h-screen bg-paper">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-line bg-paper/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-shell items-center justify-between px-5 py-4 sm:px-8">
          <a href="/" className="flex items-center">
            <img src="/logo-mova.png" alt="Mova" className="h-7 w-auto" />
          </a>
          <div className="flex items-center gap-5">
            <a
              href="/"
              className="hidden items-center gap-1 text-sm text-ink-soft transition-colors hover:text-ink sm:flex"
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={1.6} />
              Back to site
            </a>
            <a
              href="/signin"
              className="inline-flex items-center gap-2 rounded-pill bg-signal px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-signal-bright"
            >
              <ArrowUpRight className="h-4 w-4" strokeWidth={1.6} />
              Request Access
            </a>
          </div>
        </div>
      </header>

      {/* Intro */}
      <section className="mx-auto max-w-shell px-5 pb-12 pt-16 sm:px-8 sm:pt-24">
        <Reveal>
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-medium uppercase tracking-[0.22em] text-signal">
              {RESEARCH_INTRO.kicker}
            </span>
            <span className="h-px w-8 bg-line" />
            <span className="font-mono text-xs text-ink-faint">
              {total} papers · {RESEARCH.length} areas
            </span>
          </div>
        </Reveal>
        <Reveal delay={0.05}>
          <h1 className="heading-xl balance mt-5 max-w-3xl text-[clamp(2.2rem,5vw,4rem)]">
            {RESEARCH_INTRO.title}
          </h1>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-soft">
            {RESEARCH_INTRO.body}
          </p>
          <p className="mt-3 text-sm text-ink-faint">{RESEARCH_INTRO.note}</p>
        </Reveal>
      </section>

      {/* Body: sticky index + entries */}
      <section className="mx-auto grid max-w-shell gap-12 px-5 pb-24 sm:px-8 lg:grid-cols-[220px_1fr]">
        {/* Category index */}
        <nav className="hidden lg:block">
          <div className="sticky top-28 space-y-1">
            <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">
              Areas
            </div>
            {RESEARCH.map((c) => (
              <a
                key={c.id}
                href={`#${c.id}`}
                className="flex items-center justify-between border-l-2 border-line py-2 pl-3 text-sm text-ink-soft transition-colors hover:border-signal hover:text-ink"
              >
                <span>{c.label}</span>
                <span className="font-mono text-xs text-ink-faint">
                  {c.papers.length}
                </span>
              </a>
            ))}
          </div>
        </nav>

        {/* Entries */}
        <div className="space-y-20">
          {RESEARCH.map((cat) => (
            <div key={cat.id} id={cat.id} className="scroll-mt-28">
              <Reveal>
                <div className="border-b border-line pb-5">
                  <div className="flex items-baseline gap-3">
                    <span className="font-mono text-sm text-signal">
                      {cat.label}
                    </span>
                  </div>
                  <h2 className="mt-2 text-2xl font-medium tracking-tight sm:text-3xl">
                    {cat.title}
                  </h2>
                  <p className="mt-3 max-w-2xl text-base leading-relaxed text-ink-soft">
                    {cat.blurb}
                  </p>
                </div>
              </Reveal>

              <ul className="mt-2 divide-y divide-line">
                {cat.papers.map((p) => (
                  <li key={p.title}>
                    <a
                      href={p.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-start justify-between gap-6 py-6 transition-colors"
                    >
                      <div className="max-w-3xl">
                        <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
                          {p.meta}
                        </div>
                        <h3 className="mt-2 text-lg font-medium leading-snug text-ink transition-colors group-hover:text-signal-deep">
                          {p.title}
                        </h3>
                        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                          {p.summary}
                        </p>
                      </div>
                      <span className="mt-1 shrink-0 text-ink-faint transition-all duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-signal">
                        <ArrowUpRight className="h-5 w-5" strokeWidth={1.6} />
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <Footer />
    </div>
  );
}
