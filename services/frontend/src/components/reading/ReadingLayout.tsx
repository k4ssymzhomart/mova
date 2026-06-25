import type { ReactNode } from "react";

import Footer from "@/components/site/Footer";

import ReadingHeader from "./ReadingHeader";
import TocRail, { type TocItem } from "./TocRail";

/**
 * ReadingLayout — the dense-content wrapper for the credibility surfaces.
 * A single centered reading column with a sticky table-of-contents rail on the
 * desktop, editorial typography (Instrument Serif headers, Inter body), and
 * generous whitespace on a high-contrast ink/paper palette.
 */
export default function ReadingLayout({
  eyebrow,
  title,
  lede,
  meta,
  toc,
  intro,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  lede: ReactNode;
  meta?: ReactNode;
  toc: TocItem[];
  /** Optional content rendered under the lede (e.g. a headline stat row). */
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-paper text-ink">
      <ReadingHeader />

      <main>
        {/* Hero / intro */}
        <div className="mx-auto max-w-shell px-5 pb-10 pt-14 sm:px-8 sm:pt-20">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-signal">
              {eyebrow}
            </span>
            {meta && (
              <>
                <span className="h-px w-8 bg-line" />
                <span className="font-mono text-[11px] text-ink-faint">
                  {meta}
                </span>
              </>
            )}
          </div>
          <h1 className="mt-5 max-w-4xl text-[clamp(2.4rem,6vw,4.4rem)] leading-[1.02] tracking-[-0.01em] text-ink">
            {title}
          </h1>
          <p className="mt-6 max-w-2xl text-[1.15rem] leading-relaxed text-ink-soft">
            {lede}
          </p>
          {intro && <div className="mt-10">{intro}</div>}
        </div>

        {/* TOC rail + reading column */}
        <div className="mx-auto grid max-w-shell gap-x-12 px-5 pb-28 sm:px-8 lg:grid-cols-[210px_minmax(0,46rem)] lg:justify-center">
          <TocRail items={toc} />
          <article className="min-w-0 divide-y divide-transparent">
            {children}
          </article>
        </div>
      </main>

      <Footer />
    </div>
  );
}
