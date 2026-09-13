// One session from the patient's own history: exercise, date, start and end time, duration and status, with
// the same note that scores are not available yet (#23). A session that does not exist and one that belongs to
// someone else get the same honest empty state instead of notFound(), so the page never reveals which session
// ids exist and the patient always has a way back.

import { ArrowLeft, SearchX, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import EmptyState from "@/components/app/EmptyState";
import PageHeader from "@/components/app/PageHeader";
import { card, cardTitle, secondaryButton, textLink } from "@/components/app/recipes";
import { cn } from "@/lib/utils";
import { getTranslation } from "@/locales/server";

import LocalDateTime from "@/components/app/LocalDateTime";
import { formatDuration, readSession, ScoresNotAvailableCard, SessionStatus } from "../sessionView";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = getTranslation();
  return { title: `${t("progress.detail.metaTitle")} · Mova` };
}

export default async function ProgressSessionPage({ params }: { params: { sessionId: string } }) {
  const { t } = getTranslation();
  const result = await readSession(params.sessionId);

  const backLink = (
    <Link href="/progress" className={cn(textLink, "inline-flex min-h-12 items-center gap-2 text-base font-medium")}>
      <ArrowLeft className="size-5 shrink-0" strokeWidth={2} aria-hidden="true" />
      {t("progress.detail.back")}
    </Link>
  );

  if (result.status !== "ok") {
    const notFound = result.status === "not-found";
    return (
      <div className="space-y-8">
        <div className="space-y-4">
          {backLink}
          <PageHeader eyebrow={t("progress.eyebrow")} title={t("progress.detail.title")} />
        </div>
        <EmptyState
          icon={notFound ? SearchX : TriangleAlert}
          title={t(notFound ? "progress.notFound.title" : "progress.detail.errorTitle")}
          body={t(notFound ? "progress.notFound.body" : "progress.error.body")}
          action={
            <Link href="/progress" className={secondaryButton}>
              {t("progress.detail.back")}
            </Link>
          }
        />
      </div>
    );
  }

  const { session } = result;
  const duration = formatDuration(session.startedAt, session.endedAt, t);

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        {backLink}
        <PageHeader
          eyebrow={t("progress.eyebrow")}
          title={session.exerciseName ?? t("progress.detail.title")}
          lead={session.exerciseName ? undefined : t("progress.exerciseNotRecorded")}
        />
      </div>

      <section aria-labelledby="progress-session-details" className={cn(card, "p-5 sm:p-6")}>
        <h2 id="progress-session-details" className={cardTitle}>
          {t("progress.detail.detailsTitle")}
        </h2>
        <dl className="mt-3 divide-y divide-line">
          <DetailRow label={t("progress.detail.date")}>
            <LocalDateTime iso={session.startedAt} format="date" />
          </DetailRow>
          <DetailRow label={t("progress.detail.start")}>
            <LocalDateTime iso={session.startedAt} format="time" />
          </DetailRow>
          <DetailRow label={t("progress.detail.end")}>
            {session.endedAt ? (
              <LocalDateTime iso={session.endedAt} format="time" sameDayAs={session.startedAt} />
            ) : (
              <span className="text-ink-soft">{t("progress.detail.endNotRecorded")}</span>
            )}
          </DetailRow>
          <DetailRow label={t("progress.duration.label")}>
            {duration ?? <span className="text-ink-soft">{t("progress.duration.unknown")}</span>}
          </DetailRow>
          <DetailRow label={t("progress.detail.status")}>
            <SessionStatus status={session.status} />
          </DetailRow>
        </dl>
      </section>

      <ScoresNotAvailableCard />
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[12rem_1fr] sm:items-center sm:gap-4">
      <dt className="text-base font-medium text-ink-soft">{label}</dt>
      <dd className="text-base text-ink">{children}</dd>
    </div>
  );
}
