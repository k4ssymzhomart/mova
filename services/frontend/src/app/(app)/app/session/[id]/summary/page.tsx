// Step 5 of the exercise flow (Итог). Shows what is recorded for this session (the exercise, when it started,
// how long it lasted once it has ended, and how it ended) plus, for a finished Heel Slide session, the score
// lib/scoring computed from its stored frames (lib/scoring/loadHeelSlideStoredScore.server.ts) — Correctness,
// Volume, Target and Execution Effectiveness in the plain words spec §12.1 asks for, never raw ROM/degrees/
// jerk. The camera-era numbers in session_metrics are deliberately not read: they do not describe a knee
// after TKA. Every value here is provisional: the underlying angle is a relative, uncalibrated sensor
// reading, not a validated knee angle (issue #17) — see lib/scoring/types.ts.

import { Hourglass, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import PageHeader from "@/components/app/PageHeader";
import { bodyText, card, cardTitle, primaryButton, tileLabel } from "@/components/app/recipes";
import { loadHeelSlideStoredScore } from "@/lib/scoring/loadHeelSlideStoredScore.server";
import { cn } from "@/lib/utils";
import { getTranslation } from "@/locales/server";

import FlowUnavailable from "../../_flow/FlowUnavailable";
import { loadFlowSession } from "../../_flow/load";
import LocalDateTime from "@/components/app/LocalDateTime";
// Status and duration come from Progress so this step and the history use one wording and one status icon.
import { formatDuration, SessionStatus } from "@/app/(app)/progress/sessionView";

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

  const { id, exerciseName, status, startedAt, endedAt } = session.value;
  // null while no end time is recorded (or the timestamps do not make a valid span): the row is then left out.
  const duration = formatDuration(startedAt, endedAt, t);
  const score = await loadHeelSlideStoredScore(id);

  return (
    <div className="space-y-8">
      <PageHeader eyebrow={t("flow.steps.summary")} title={exerciseName ?? t("flow.untitledExercise")} />

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

      <Scores score={score} t={t} />

      <Link href="/app" className={primaryButton}>
        {t("shell.home")}
      </Link>
    </div>
  );
}

type T = (key: string, vars?: Record<string, string | number>) => string;

function Scores({
  score,
  t,
}: {
  score: Awaited<ReturnType<typeof loadHeelSlideStoredScore>>;
  t: T;
}) {
  if (score.kind !== "ok") {
    return (
      <section aria-labelledby="session-scores" className={cn(card, "p-6 sm:p-8")}>
        <div className="flex items-center gap-3">
          <Hourglass className="size-6 shrink-0 text-ink-soft" strokeWidth={1.8} aria-hidden="true" />
          <h2 id="session-scores" className={cardTitle}>
            {t("flow.summary.scoresTitle")}
          </h2>
        </div>
        <p role={score.kind === "error" ? "status" : undefined} className={cn("mt-2 max-w-2xl", bodyText)}>
          {t(score.kind === "error" ? "flow.summary.scoresError" : "flow.summary.scoresNotYet")}
        </p>
      </section>
    );
  }

  const { result } = score;
  const validReps = result.reps.filter((r) => r.validForVolume).length;

  return (
    <section aria-labelledby="session-scores" className={cn(card, "p-6 sm:p-8")}>
      <h2 id="session-scores" className={cardTitle}>
        {t("flow.summary.scoresTitle")}
      </h2>
      {result.frozen && (
        <p className="mt-2 flex items-start gap-2 text-base font-medium leading-relaxed text-ink">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-700" strokeWidth={2} aria-hidden="true" />
          {t("flow.summary.scoresFrozen")}
        </p>
      )}
      <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ScoreTile label={t("flow.summary.score.technique")} value={result.correctnessScore} />
        <ScoreTile
          label={t("flow.summary.score.reps")}
          value={validReps}
          detail={t("flow.summary.scoreDetail.reps", { n: validReps, target: result.prescribedReps })}
        />
        <ScoreTile
          label={t("flow.summary.score.target")}
          value={result.targetScore}
          detail={t("flow.summary.scoreDetail.target", { n: result.targetReachedCount, total: validReps })}
        />
        <ScoreTile label={t("flow.summary.score.overall")} value={result.executionEffectiveness} />
      </ul>
      <p className={cn("mt-4 max-w-2xl text-sm", bodyText)}>{t("flow.summary.scoreDetail.provisional")}</p>
    </section>
  );
}

function ScoreTile({ label, value, detail }: { label: string; value: number; detail?: string }) {
  return (
    <li className="rounded-card border border-line p-4">
      <div className={tileLabel}>{label}</div>
      <div className="tnum mt-1 text-3xl font-semibold text-ink">{value}</div>
      {detail && <div className="mt-1 text-sm text-ink-soft">{detail}</div>}
    </li>
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
