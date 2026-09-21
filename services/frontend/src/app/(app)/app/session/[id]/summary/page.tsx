// Step 5 of the exercise flow (Итог). Shows only what is recorded for this session: the exercise, when it started,
// how long it lasted once it has ended, and how it ended. Scores are not available yet and the page says so. The
// camera-era numbers in session_metrics are deliberately not read: they do not describe a knee after TKA.

import { Hourglass } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import PageHeader from "@/components/app/PageHeader";
import { bodyText, card, cardTitle, primaryButton, tileLabel } from "@/components/app/recipes";
import { cn } from "@/lib/utils";
import { getTranslation } from "@/locales/server";

import FlowUnavailable from "../../_flow/FlowUnavailable";
import { loadFlowSession } from "../../_flow/load";
import LocalDateTime from "@/components/app/LocalDateTime";
// Status and duration come from Progress so this step and the history use one wording and one status icon.
import { formatDuration, SessionStatus } from "@/app/(app)/progress/sessionView";

// Patient words for the scores the TKA scoring engine will produce. Never "ROM", "quality" or "jerk".
const SCORES = ["technique", "reps", "target", "overall"] as const;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = getTranslation();
  return { title: `${t("flow.steps.summary")} · Mova` };
}

export default async function SummaryStep({ params }: { params: { id: string } }) {
  const { t } = getTranslation();
  const session = await loadFlowSession(params.id);
  if (session.kind !== "ok") {
    return (
      <FlowUnavailable
        eyebrow={t("flow.steps.summary")}
        reason={session.kind === "error" ? "loadError" : "sessionNotFound"}
      />
    );
  }

  const { exerciseName, status, startedAt, endedAt } = session.value;
  // null while no end time is recorded (or the timestamps do not make a valid span): the row is then left out.
  const duration = formatDuration(startedAt, endedAt, t);

  return (
    <div className="space-y-8">
      <PageHeader stacked eyebrow={t("flow.steps.summary")} title={exerciseName ?? t("flow.untitledExercise")} />

      <section aria-labelledby="session-details" className={cn(card, "p-6 sm:p-8")}>
        <h2 id="session-details" className={cardTitle}>
          {t("flow.summary.detailsTitle")}
        </h2>
        <dl className="mt-4 divide-y divide-line">
          <Detail label={t("flow.summary.started")}>
            <LocalDateTime iso={startedAt} format="dateTime" />
          </Detail>
          {duration && <Detail label={t("flow.summary.duration")}>{duration}</Detail>}
          <Detail label={t("flow.summary.status")}>
            <SessionStatus status={status} />
          </Detail>
        </dl>
      </section>

      {/* TODO(#23): the scoring engine fills these in. Until it exists nothing is estimated here, and nothing is
          carried over from session_metrics. */}
      <section aria-labelledby="session-scores" className={cn(card, "p-6 sm:p-8")}>
        <div className="flex items-center gap-3">
          <Hourglass className="size-6 shrink-0 text-ink-soft" strokeWidth={1.8} aria-hidden="true" />
          <h2 id="session-scores" className={cardTitle}>
            {t("flow.summary.scoresTitle")}
          </h2>
        </div>
        <p className={cn("mt-2 max-w-2xl", bodyText)}>{t("flow.summary.scoresBody")}</p>
        <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {SCORES.map((score) => (
            <li key={score} className="rounded-card border border-dashed border-ink/25 p-4">
              <div className="text-base font-semibold text-ink">{t(`flow.summary.score.${score}`)}</div>
              <div className="mt-1 text-base text-ink-soft">{t("flow.summary.scoreUnavailable")}</div>
            </li>
          ))}
        </ul>
      </section>

      <Link href="/app" className={primaryButton}>
        {t("shell.home")}
      </Link>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3">
      <dt className={tileLabel}>{label}</dt>
      <dd className="text-base font-medium text-ink">{children}</dd>
    </div>
  );
}
