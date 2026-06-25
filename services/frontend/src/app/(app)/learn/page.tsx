import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen, Clock, Play } from "lucide-react";

import { ARTICLES } from "@/lib/learn/articles";

export const metadata: Metadata = { title: "Learn · Mova" };

export default function LearnPage() {
  const [featured, ...rest] = ARTICLES;
  const videos = ARTICLES.filter((a) => a.hasVideo);

  return (
    <div className="space-y-10">
      <header>
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-signal">Learn</div>
        <h1 className="mt-2 max-w-2xl font-serif text-4xl leading-[1.05] text-ink sm:text-5xl">
          Understand your recovery.
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-soft">
          Short, evidence-based reads on the conditions and methods behind your program. Educational only —
          never a substitute for your clinician&apos;s advice.
        </p>
      </header>

      {/* featured */}
      <Link
        href={`/learn/${featured.slug}`}
        className="group block overflow-hidden rounded-3xl border border-line bg-card transition-colors hover:border-ink/20"
      >
        <div className="grid lg:grid-cols-[1.1fr_1fr]">
          <div className="flex flex-col justify-center p-7 sm:p-10">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-signal-deep">
              {featured.category} · Featured
            </span>
            <h2 className="mt-3 font-serif text-3xl leading-tight text-ink sm:text-4xl">{featured.title}</h2>
            <p className="mt-3 max-w-md text-[15px] leading-relaxed text-ink-soft">{featured.dek}</p>
            <div className="mt-6 flex items-center gap-4 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-faint">
              <span className="inline-flex items-center gap-1.5">
                <Clock className="size-3.5" strokeWidth={1.8} /> {featured.readMinutes} min read
              </span>
              <span className="inline-flex items-center gap-1.5 text-signal-deep">
                Read <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
              </span>
            </div>
          </div>
          {/* editorial placeholder panel (no imagery dependency) */}
          <div className="relative hidden min-h-[15rem] bg-night lg:block">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(110%_110%_at_80%_-10%,rgba(22,163,91,0.30),transparent_60%)]" />
            <div className="absolute inset-0 grid place-items-center">
              <BookOpen className="size-12 text-signal-bright/80" strokeWidth={1.2} />
            </div>
          </div>
        </div>
      </Link>

      {/* library */}
      <section>
        <h3 className="mb-4 font-serif text-2xl text-ink">Library</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rest.map((a) => (
            <Link
              key={a.slug}
              href={`/learn/${a.slug}`}
              className="group flex flex-col rounded-2xl border border-line bg-card p-5 transition-all hover:-translate-y-0.5 hover:shadow-card"
            >
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-signal-deep">{a.category}</span>
              <h4 className="mt-2 font-serif text-xl leading-snug text-ink">{a.title}</h4>
              <p className="mt-2 flex-1 text-[13px] leading-relaxed text-ink-soft">{a.dek}</p>
              <div className="mt-4 flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.12em] text-ink-faint">
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="size-3.5" strokeWidth={1.8} /> {a.readMinutes} min
                </span>
                <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* watch */}
      {videos.length > 0 && (
        <section>
          <h3 className="mb-4 font-serif text-2xl text-ink">Watch</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {videos.map((a) => (
              <Link
                key={a.slug}
                href={`/learn/${a.slug}`}
                className="group relative flex items-end overflow-hidden rounded-2xl border border-line bg-night p-6 transition-colors hover:border-signal/40"
              >
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_120%_at_15%_-20%,rgba(22,163,91,0.22),transparent_55%)]" />
                <span className="relative z-10 grid size-12 shrink-0 place-items-center rounded-full bg-paper/10 ring-1 ring-paper/20 transition-colors group-hover:bg-signal">
                  <Play className="size-5 text-paper" strokeWidth={1.8} />
                </span>
                <div className="relative z-10 ml-4">
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-signal-bright">
                    {a.readMinutes}-min explainer
                  </div>
                  <div className="mt-1 font-serif text-xl text-paper">{a.title}</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
