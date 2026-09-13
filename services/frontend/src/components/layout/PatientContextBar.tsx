"use client";

// The clinical context that sits above every patient screen: post-operative day and operated side (НТЗ PAT-01,
// §4.3). This is the only component that renders the POD, so there is never a second number to disagree
// with. The value is computed on the server (lib/patient) and passed in.
//
// - POD is written in words ("День 12 после операции"), never as "POD".
// - Side is a full word in a bordered badge ("Левое колено"): never Л/П, never colour alone.
// - Unknown values say so plainly and are never estimated.

import { CalendarDays, CalendarX2, TriangleAlert } from "lucide-react";

import { formatDate } from "@/lib/i18n/formatDate";
import type { PatientContext, SideContext } from "@/lib/patient/context";
import type { PostOpDay } from "@/lib/patient/pod";
import { cn } from "@/lib/utils";
import type { Locale } from "@/locales";
import { useTranslation } from "@/locales/client";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

export default function PatientContextBar({
  context,
  layout,
  className,
}: {
  context: PatientContext;
  layout: "inline" | "stacked";
  className?: string;
}) {
  const { t, locale } = useTranslation();
  const compact = layout === "stacked";
  return (
    <div
      role="group"
      aria-label={t("shell.patientContext")}
      className={cn(
        compact ? "flex flex-col items-start gap-1.5" : "flex flex-wrap items-center gap-x-6 gap-y-2",
        className,
      )}
    >
      <PostOp postOp={context.postOp} t={t} locale={locale} compact={compact} />
      <Side side={context.side} t={t} compact={compact} />
    </div>
  );
}

function PostOp({
  postOp,
  t,
  locale,
  compact,
}: {
  postOp: PostOpDay;
  t: Translate;
  locale: Locale;
  compact: boolean;
}) {
  if (postOp.status === "unknown") {
    // Each reason says what is actually true: no date, a date we will not count from yet, or a broken date.
    const invalid = postOp.reason === "invalid-date";
    const key = invalid
      ? "postOp.invalidDate"
      : postOp.reason === "convention-pending"
        ? "postOp.conventionPending"
        : "postOp.unknown";
    return (
      <p className={cn("flex items-center gap-2", invalid ? "text-ink" : "text-ink-soft", compact ? "text-sm" : "text-base")}>
        {invalid ? (
          <TriangleAlert className="size-5 shrink-0 text-amber-700" strokeWidth={2} aria-hidden="true" />
        ) : (
          <CalendarX2 className="size-5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
        )}
        {t(key)}
      </p>
    );
  }

  const text =
    postOp.status === "scheduled"
      ? t("postOp.scheduled", {
          date: formatDate(new Date(`${postOp.surgeryDate}T00:00:00Z`), locale, "dayMonth", "UTC"),
        })
      : postOp.isSurgeryDay
        ? t("postOp.dayOfSurgery")
        : t("postOp.day", { n: postOp.day });

  return (
    <p className={cn("flex items-center gap-2 font-semibold text-ink", compact ? "text-base" : "text-lg")}>
      <CalendarDays className="size-5 shrink-0 text-signal-deep" strokeWidth={2} aria-hidden="true" />
      <span className="tnum">{text}</span>
    </p>
  );
}

function Side({ side, t, compact }: { side: SideContext; t: Translate; compact: boolean }) {
  const size = compact ? "py-0.5 text-sm" : "py-1 text-base";
  if (side.status === "known") {
    return (
      <p className={cn("inline-flex items-center rounded-pill border-2 border-ink px-3 font-semibold text-ink", size)}>
        <span className="sr-only">{t("side.label")}: </span>
        {t(side.side === "left" ? "side.left" : "side.right")}
      </p>
    );
  }
  return (
    <p
      className={cn(
        "inline-flex items-center gap-2 rounded-pill border border-dashed border-ink/40 px-3 text-ink",
        size,
      )}
    >
      <TriangleAlert className="size-4 shrink-0 text-amber-700" strokeWidth={2} aria-hidden="true" />
      {t("side.unknown")}
    </p>
  );
}
