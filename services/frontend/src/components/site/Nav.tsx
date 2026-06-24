"use client";

import { useMotionValueEvent, useScroll } from "framer-motion";
import { ArrowUpRight, ChevronDown, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";

import { EVIDENCE_NAV, NAV_LINKS, NAV_SECONDARY } from "@/lib/site-data";

function computeDark() {
  if (typeof document === "undefined") return true;
  const probe = 36;
  let isDark = false;
  document.querySelectorAll("[data-nav-dark]").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.top <= probe && r.bottom >= probe) isDark = true;
  });
  return isDark;
}

export default function Nav() {
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  const [dark, setDark] = useState(true);
  const [open, setOpen] = useState(false);
  const [evidence, setEvidence] = useState(false);

  useMotionValueEvent(scrollY, "change", (v) => {
    setScrolled(v > 40);
    setDark(computeDark());
  });

  useEffect(() => {
    setScrolled(window.scrollY > 40);
    setDark(computeDark());
  }, []);

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50">
        <div
          className={`mx-auto flex max-w-shell items-center justify-between px-5 transition-all duration-500 ease-editorial sm:px-8 ${
            scrolled ? "py-3" : "py-5"
          }`}
        >
          <a href="#top" className="flex items-center">
            <img
              src="/logo-mova.png"
              alt="Mova"
              className={`h-7 w-auto transition-[filter] duration-300 ${
                dark ? "[filter:brightness(0)_invert(1)]" : ""
              }`}
            />
          </a>

          <nav
            className={`hidden items-center gap-7 rounded-pill px-6 py-2.5 text-sm transition-colors duration-300 lg:flex ${
              scrolled
                ? dark
                  ? "bg-white/10 text-white backdrop-blur-md"
                  : "bg-card/80 text-ink shadow-soft backdrop-blur-md"
                : dark
                  ? "text-white"
                  : "text-ink"
            }`}
          >
            {NAV_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="transition-opacity duration-300 hover:opacity-60"
              >
                {l.label}
              </a>
            ))}

            {/* Evidence cluster — the five Phase 8 credibility surfaces */}
            <div
              className="relative"
              onMouseEnter={() => setEvidence(true)}
              onMouseLeave={() => setEvidence(false)}
            >
              <button
                type="button"
                onClick={() => setEvidence((v) => !v)}
                className="flex items-center gap-1 transition-opacity duration-300 hover:opacity-60"
                aria-expanded={evidence}
              >
                Evidence
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform duration-300 ${
                    evidence ? "rotate-180" : ""
                  }`}
                  strokeWidth={1.8}
                />
              </button>
              {evidence && (
                <div className="absolute left-1/2 top-full z-50 -translate-x-1/2 pt-4">
                  <div className="w-72 rounded-card border border-line bg-card p-2 shadow-card">
                    {EVIDENCE_NAV.map((e) => (
                      <a
                        key={e.href}
                        href={e.href}
                        className="block rounded-pill px-3 py-2 transition-colors hover:bg-paper-soft"
                      >
                        <div className="text-sm font-medium text-ink">
                          {e.label}
                        </div>
                        <div className="text-xs text-ink-faint">{e.blurb}</div>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </nav>

          <div className="hidden items-center gap-6 lg:flex">
            {NAV_SECONDARY.map((l) => (
              <a
                key={l.label}
                href={l.href}
                className={`text-sm transition-opacity duration-300 hover:opacity-60 ${
                  dark ? "text-white" : "text-ink"
                }`}
              >
                {l.label}
              </a>
            ))}
            <a
              href="/signin"
              className="inline-flex items-center gap-2 rounded-pill bg-signal px-4 py-2.5 text-sm font-medium text-white transition-colors duration-300 hover:bg-signal-bright"
            >
              <ArrowUpRight className="h-4 w-4" strokeWidth={1.6} />
              Request Access
            </a>
          </div>

          <button
            aria-label="Open menu"
            onClick={() => setOpen(true)}
            className={`lg:hidden ${dark ? "text-white" : "text-ink"}`}
          >
            <Menu className="h-6 w-6" strokeWidth={1.5} />
          </button>
        </div>
      </header>

      {/* Mobile sheet */}
      {open && (
        <div className="fixed inset-0 z-[60] bg-night/95 backdrop-blur-xl lg:hidden">
          <div className="flex items-center justify-between px-5 py-5">
            <img
              src="/logo-mova.png"
              alt="Mova"
              className="h-7 w-auto [filter:brightness(0)_invert(1)]"
            />
            <button aria-label="Close menu" onClick={() => setOpen(false)}>
              <X className="h-6 w-6 text-white" strokeWidth={1.5} />
            </button>
          </div>
          <nav className="mt-6 flex flex-col gap-1 px-5">
            {[...NAV_LINKS, ...NAV_SECONDARY].map((l) => (
              <a
                key={l.label}
                href={l.href}
                onClick={() => setOpen(false)}
                className="border-b border-white/10 py-4 text-2xl text-white/90"
              >
                {l.label}
              </a>
            ))}

            <div className="mt-6 text-[11px] font-medium uppercase tracking-[0.2em] text-white/40">
              Evidence
            </div>
            {EVIDENCE_NAV.map((e) => (
              <a
                key={e.href}
                href={e.href}
                onClick={() => setOpen(false)}
                className="border-b border-white/10 py-3 text-lg text-white/80"
              >
                {e.label}
              </a>
            ))}

            <a
              href="/signin"
              onClick={() => setOpen(false)}
              className="mt-6 inline-flex items-center justify-center gap-2 rounded-pill bg-signal px-4 py-4 text-white"
            >
              Request Access
            </a>
          </nav>
        </div>
      )}
    </>
  );
}
