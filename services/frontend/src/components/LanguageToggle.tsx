"use client";

// Compact RU ⇄ EN switch. Persists via cookie + refreshes Server Components (see LocaleProvider).
// Two visual variants: "app" (flat pill on the soft canvas) and "landing" (subtle, for the dark nav).

import { useLocale } from "@/locales/client";
import { LOCALES, type Locale } from "@/locales";
import { cn } from "@/lib/utils";

const LABEL: Record<Locale, string> = { ru: "RU", en: "EN" };

export default function LanguageToggle({
  variant = "app",
  className,
}: {
  variant?: "app" | "landing";
  className?: string;
}) {
  const { locale, setLocale } = useLocale();

  return (
    <div
      role="group"
      aria-label="Language"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-pill p-0.5",
        variant === "landing" ? "border border-white/15 bg-white/5" : "border border-line bg-paper-soft",
        className,
      )}
    >
      {LOCALES.map((loc) => {
        const active = loc === locale;
        return (
          <button
            key={loc}
            type="button"
            onClick={() => setLocale(loc)}
            aria-pressed={active}
            className={cn(
              "rounded-pill px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
              variant === "landing"
                ? active
                  ? "bg-white text-night"
                  : "text-white/60 hover:text-white"
                : active
                  ? "bg-card text-ink shadow-soft"
                  : "text-ink-faint hover:text-ink",
            )}
          >
            {LABEL[loc]}
          </button>
        );
      })}
    </div>
  );
}
