"use client";

// RU / KZ / EN switch. Persists via cookie + refreshes Server Components (see LocaleProvider).
// Variants:
//  - "patient": the patient app's rail and drawer. 48px targets, and the selected language is marked by a dark
//    fill and a check mark, not by a colour shift alone.
//  - "app": the compact pill on light surfaces (light landing nav, sign-in, clinician header).
//  - "landing": subtle, for the dark landing nav.
// `locales` narrows the choice where the copy has no Kazakh translation yet (landing, clinician portal), so
// nobody picks KZ there and gets Russian. Each button's accessible name starts with its visible code, then the
// language's own name, spoken in that language.

import { Check } from "lucide-react";

import { focusRing } from "@/components/app/recipes";
import { LOCALES, type Locale } from "@/locales";
import { useLocale, useTranslation } from "@/locales/client";
import { cn } from "@/lib/utils";

const CODE: Record<Locale, string> = { ru: "RU", kk: "KZ", en: "EN" };

export default function LanguageToggle({
  variant = "app",
  locales = LOCALES,
  className,
}: {
  variant?: "app" | "landing" | "patient";
  locales?: readonly Locale[];
  className?: string;
}) {
  const { locale, setLocale } = useLocale();
  const { t } = useTranslation();

  return (
    <div
      role="group"
      aria-label={t("language.label")}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-pill p-0.5",
        variant === "landing" && "border border-white/15 bg-white/5",
        variant === "app" && "border border-line bg-paper-soft",
        variant === "patient" && "gap-1 border border-line bg-paper-soft p-1",
        className,
      )}
    >
      {locales.map((loc) => {
        const active = loc === locale;
        return (
          <button
            key={loc}
            type="button"
            lang={loc}
            onClick={() => setLocale(loc)}
            aria-pressed={active}
            aria-label={`${CODE[loc]} — ${t(`language.${loc}`)}`}
            className={cn(
              variant === "landing" &&
                cn(
                  "rounded-pill px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
                  active ? "bg-white text-night" : "text-white/60 hover:text-white",
                ),
              variant === "app" &&
                cn(
                  "rounded-pill px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
                  active ? "bg-card text-ink shadow-soft" : "text-ink-faint hover:text-ink",
                ),
              variant === "patient" &&
                cn(
                  "inline-flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-pill px-3 text-sm font-medium tracking-[0.08em] transition-colors",
                  focusRing,
                  active ? "bg-ink text-paper" : "text-ink-soft hover:bg-card hover:text-ink",
                ),
            )}
          >
            {variant === "patient" && active && <Check className="size-4" strokeWidth={2.4} aria-hidden="true" />}
            {CODE[loc]}
          </button>
        );
      })}
    </div>
  );
}
