"use client";

import { ArrowUpRight, ChevronLeft } from "lucide-react";
import { usePathname } from "next/navigation";

import { EVIDENCE_NAV } from "@/lib/site-data";

/**
 * Shared chrome for the evidence / reading surfaces: brand mark, a sibling
 * sub-nav across the five credibility pages (with active state), and the
 * back-to-site + request-access actions. Sticky, paper-on-ink, editorial.
 */
export default function ReadingHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-paper/85 backdrop-blur-md">
      <div className="mx-auto max-w-shell px-5 sm:px-8">
        <div className="flex items-center justify-between py-4">
          <div className="flex items-center gap-6">
            <a href="/" className="flex items-center">
              <img src="/logo-mova.png" alt="Mova" className="h-7 w-auto" />
            </a>
            <span className="hidden h-5 w-px bg-line sm:block" />
            <span className="hidden font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint sm:block">
              Evidence
            </span>
          </div>

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

        {/* Sibling sub-nav across the five credibility surfaces */}
        <nav className="-mb-px flex gap-1 overflow-x-auto no-scrollbar">
          {EVIDENCE_NAV.map((l) => {
            const on = pathname === l.href;
            return (
              <a
                key={l.href}
                href={l.href}
                aria-current={on ? "page" : undefined}
                className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors ${
                  on
                    ? "border-signal font-medium text-ink"
                    : "border-transparent text-ink-soft hover:text-ink"
                }`}
              >
                {l.label}
              </a>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
