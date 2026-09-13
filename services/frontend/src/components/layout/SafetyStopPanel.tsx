"use client";

// SafetyStopPanel — what the patient sees while the НТЗ §15 RED state is raised. It replaces the page, takes
// focus, and shows the approved instruction for the trigger. It must never name a diagnosis (§15.2).
//
// There is no approved instruction text yet; the pending key says exactly that. Nothing raises RED today.

import { OctagonAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef } from "react";

import { secondaryButton } from "@/components/app/recipes";
import { PENDING_INSTRUCTION_KEY, useSafety } from "@/lib/safety/SafetyProvider";
import { useTranslation } from "@/locales/client";

export default function SafetyStopPanel() {
  const { state, clear } = useSafety();
  const { t } = useTranslation();
  const router = useRouter();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const key = state.level === "red" ? state.instructionKey : PENDING_INSTRUCTION_KEY;
  const translated = t(key);
  // A missing key would otherwise print the key itself where a safety instruction belongs.
  const instruction = translated === key ? t(PENDING_INSTRUCTION_KEY) : translated;

  return (
    <section aria-labelledby={titleId} className="mx-auto max-w-2xl rounded-card border-2 border-red-700 bg-card p-6 sm:p-10">
      <OctagonAlert className="size-12 text-red-700" strokeWidth={1.8} aria-hidden="true" />
      <p className="mt-4 text-sm font-medium uppercase tracking-[0.14em] text-red-800">{t("safety.red.eyebrow")}</p>
      <h1
        id={titleId}
        ref={headingRef}
        tabIndex={-1}
        className="mt-2 text-3xl font-semibold leading-tight text-ink focus:outline-none sm:text-4xl"
      >
        {t("safety.red.title")}
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-ink">{instruction}</p>
      <button
        type="button"
        onClick={() => {
          clear();
          router.push("/app");
        }}
        className={`mt-8 ${secondaryButton}`}
      >
        {t("safety.red.toHome")}
      </button>
    </section>
  );
}
