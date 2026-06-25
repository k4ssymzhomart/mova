import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Clock, Play } from "lucide-react";

import { ARTICLES, getArticle } from "@/lib/learn/articles";

export function generateStaticParams() {
  return ARTICLES.map((a) => ({ slug: a.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const a = getArticle(params.slug);
  return { title: a ? `${a.title} · Mova` : "Article · Mova" };
}

export default function ArticlePage({ params }: { params: { slug: string } }) {
  const article = getArticle(params.slug);
  if (!article) notFound();

  return (
    <article className="mx-auto max-w-2xl">
      <Link
        href="/learn"
        className="inline-flex items-center gap-1 text-sm text-ink-soft transition-colors hover:text-ink"
      >
        <ChevronLeft className="size-4" strokeWidth={1.6} />
        Learn
      </Link>

      <header className="mt-6 border-b border-line pb-8">
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-signal-deep">{article.category}</div>
        <h1 className="mt-3 text-4xl leading-[1.08] text-ink sm:text-5xl">{article.title}</h1>
        <p className="mt-4 text-lg leading-relaxed text-ink-soft">{article.dek}</p>
        <div className="mt-5 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-faint">
          <Clock className="size-3.5" strokeWidth={1.8} /> {article.readMinutes} min read
        </div>
      </header>

      {article.hasVideo && (
        <div className="relative mt-8 grid aspect-video place-items-center overflow-hidden rounded-lg border border-line bg-paper-soft">
          <button
            type="button"
            className="group relative z-10 grid size-16 place-items-center rounded-full border border-line bg-card transition-colors hover:bg-signal"
            aria-label="Play explainer (placeholder)"
          >
            <Play className="size-6 text-signal transition-colors group-hover:text-white" strokeWidth={1.6} />
          </button>
          <span className="absolute bottom-4 left-5 z-10 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
            Explainer · {article.readMinutes} min
          </span>
        </div>
      )}

      <div className="mt-8 space-y-8">
        {article.sections.map((s, i) => (
          <section key={i}>
            {s.heading && <h2 className="mb-3 text-2xl text-ink">{s.heading}</h2>}
            <div className="space-y-4">
              {s.paragraphs.map((p, j) => (
                <p key={j} className="text-[15px] leading-[1.75] text-ink-soft">
                  {p}
                </p>
              ))}
            </div>

            {/* drop the pullquote in after the first section */}
            {i === 0 && article.pullquote && (
              <blockquote className="mt-8 border-l-2 border-signal pl-5 text-2xl leading-snug text-ink">
                {article.pullquote}
              </blockquote>
            )}
          </section>
        ))}
      </div>

      <footer className="mt-12 border-t border-line pt-6">
        <p className="text-[12px] leading-relaxed text-ink-faint">
          This article is for education only and is not medical advice. Always follow the guidance of your
          own care team.
        </p>
        <Link
          href="/learn"
          className="mt-4 inline-flex items-center gap-1 text-sm text-signal-deep transition-colors hover:underline"
        >
          <ChevronLeft className="size-4" strokeWidth={1.6} />
          Back to Learn
        </Link>
      </footer>
    </article>
  );
}
