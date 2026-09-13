"use client";

// Active precautions (НТЗ §4.3). Recorded wording is shown verbatim and never derived from the post-operative
// day or protocol phase. With no record, the card says precautions are not in the app, and never "no
// precautions": a missing field is not a clearance.

import { Info, ShieldAlert } from "lucide-react";
import { useId } from "react";

import type { Precautions } from "@/lib/patient/context";
import { useTranslation } from "@/locales/client";

import { bodyText, card, cardTitle } from "./recipes";

export default function PrecautionsCard({ precautions }: { precautions: Precautions }) {
  const { t } = useTranslation();
  const titleId = useId();

  if (precautions.status === "unavailable") {
    return (
      <section aria-labelledby={titleId} className={`${card} p-5 sm:p-6`}>
        <div className="flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-paper-soft text-ink-soft ring-1 ring-line">
            <Info className="size-5" strokeWidth={1.9} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className={cardTitle}>
              {t("precautions.title")}
            </h2>
            <p className="mt-2 text-base font-medium text-ink">{t("precautions.unavailable")}</p>
            <p className={`mt-1 ${bodyText}`}>{t("precautions.unavailableBody")}</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby={titleId} className={`${card} border-ink/30 p-5 sm:p-6`}>
      <div className="flex items-start gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-amber-50 text-amber-700 ring-1 ring-amber-700/30">
          <ShieldAlert className="size-5" strokeWidth={1.9} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 id={titleId} className={cardTitle}>
            {t("precautions.title")}
          </h2>
          {precautions.weightBearing && (
            <p className="mt-2 text-base text-ink">
              <span className="font-semibold">{t("precautions.weightBearing")}:</span> {precautions.weightBearing}
            </p>
          )}
          {precautions.items.length > 0 && (
            <>
              <p className="mt-3 text-base font-semibold text-ink">{t("precautions.individual")}</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-base text-ink">
                {precautions.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
