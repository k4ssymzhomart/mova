import type { Metadata } from "next";
import { ArrowUpRight } from "lucide-react";

import ReadingLayout from "@/components/reading/ReadingLayout";
import { Badge, P, Section } from "@/components/reading/ui";
import { references } from "@/lib/evidence";
import { RESEARCH, RESEARCH_INTRO } from "@/lib/research-data";

export const metadata: Metadata = {
  title: "Research — Mova",
  description:
    "The evidence base behind Mova: inertial sensing, motion foundation models and movement rehabilitation. We summarise and link out — we never host PDFs.",
};

const totalPapers = RESEARCH.reduce((n, c) => n + c.papers.length, 0);

const TOC = [
  ...RESEARCH.map((c) => ({ id: c.id, label: c.label })),
  { id: "sources", label: "Primary sources" },
];

/** "First Last and X and Y" -> "First Last et al." for long author lists. */
function shortAuthors(authors: string): string {
  const list = authors.split(/\s+and\s+/).filter(Boolean);
  if (list.length <= 2) return list.join(" & ");
  return `${list[0]} et al.`;
}

export default function ResearchPage() {
  return (
    <ReadingLayout
      eyebrow={RESEARCH_INTRO.kicker}
      meta={`${totalPapers} papers · ${RESEARCH.length} areas · ${references.citations.length} cited`}
      title="The evidence base behind Mova"
      lede={RESEARCH_INTRO.body}
      toc={TOC}
      intro={
        <p className="max-w-2xl text-sm text-ink-faint">{RESEARCH_INTRO.note}</p>
      }
    >
      {RESEARCH.map((cat) => (
        <Section key={cat.id} id={cat.id} title={cat.title} kicker={cat.label}>
          <P>{cat.blurb}</P>
          <ul className="divide-y divide-line">
            {cat.papers.map((p) => (
              <li key={p.title}>
                <a
                  href={p.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-start justify-between gap-5 py-5"
                >
                  <div className="min-w-0">
                    <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-faint">
                      {p.meta}
                    </div>
                    <h3 className="mt-1.5 text-[1.05rem] font-medium leading-snug text-ink transition-colors group-hover:text-signal-deep">
                      {p.title}
                    </h3>
                    <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">
                      {p.summary}
                    </p>
                  </div>
                  <span className="mt-1 shrink-0 text-ink-faint transition-all duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-signal">
                    <ArrowUpRight className="h-5 w-5" strokeWidth={1.6} />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </Section>
      ))}

      {/* Machine-cited primary sources, parsed from references.bib */}
      <Section id="sources" title="Primary sources" kicker="references.bib">
        <P>
          These are the datasets and methods cited directly in the Phase 2 data
          platform and Phase 3 ML core, parsed from the repository&rsquo;s{" "}
          <code className="rounded bg-paper-soft px-1 py-0.5 font-mono text-[0.85em]">
            references.bib
          </code>
          . We render the citation and link out to the publisher, DOI or project
          page — never a hosted PDF.
        </P>
        <ul className="divide-y divide-line">
          {references.citations.map((c) => (
            <li key={c.key} className="py-5">
              <div className="flex items-start justify-between gap-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{c.type}</Badge>
                    <span className="font-mono text-[11px] text-ink-faint">
                      {c.key}
                    </span>
                  </div>
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group mt-2 block"
                  >
                    <h3 className="text-[1.05rem] font-medium leading-snug text-ink transition-colors group-hover:text-signal-deep">
                      {c.title}
                    </h3>
                  </a>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
                    {shortAuthors(c.authors)}
                    {c.venue ? ` · ${c.venue}` : ""}
                    {c.year ? ` · ${c.year}` : ""}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <SourceLink href={c.url} label={c.linkLabel} />
                    {c.doi && (
                      <SourceLink
                        href={`https://doi.org/${c.doi}`}
                        label={`DOI ${c.doi}`}
                      />
                    )}
                    {c.arxiv && (
                      <SourceLink
                        href={`https://arxiv.org/abs/${c.arxiv}`}
                        label={`arXiv:${c.arxiv}`}
                      />
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Section>
    </ReadingLayout>
  );
}

function SourceLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-card px-3 py-1.5 font-mono text-[11px] text-ink-soft transition-colors hover:border-signal/40 hover:text-signal-deep"
    >
      {label}
      <ArrowUpRight className="h-3 w-3" strokeWidth={1.8} />
    </a>
  );
}
