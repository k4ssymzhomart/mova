// Progress: the patient's session history, read from the database so it is the same on every device. It
// replaced a per-device localStorage history of camera sessions. The page shows real counts and the list of
// sessions and nothing else: no streaks, no XP, and no scores. The camera-era session_metrics do not describe a
// knee after TKA and the IMU scoring engine (#23) does not exist yet, so a card says that plainly.

import { CalendarDays, ChevronRight, CircleCheck, History, Timer, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import EmptyState from "@/components/app/EmptyState";
import PageHeader from "@/components/app/PageHeader";
import SessionLogTable from "@/components/app/SessionLogTable";
import {
  card,
  focusRing,
  metricValue,
  pageFlow,
  primaryButton,
  sectionHead,
  sectionTitle,
  tileGrid,
  tileLabel,
} from "@/components/app/recipes";
import { cn } from "@/lib/utils";
import { getTranslation } from "@/locales/server";

import LocalDateTime from "@/components/app/LocalDateTime";
import {
  type CheckInEntry,
  formatDuration,
  readCheckIns,
  readSessionHistory,
  ScoresNotAvailableCard,
  type SessionEntry,
  SessionStatus,
  type Translate,
} from "./sessionView";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = getTranslation();
  return { title: `${t("progress.metaTitle")} · Mova` };
}

export default async function ProgressPage() {
  const { t } = getTranslation();
  const history = await readSessionHistory();
  // The patient's own answers for the sessions on screen. A failed read leaves those columns empty rather than
  // claiming nothing was answered.
  const checkIns =
    history.status === "ok" ? await readCheckIns(history.sessions.map((session) => session.id)) : new Map();

  if (history.status === "error") {
    return (
      <div className={pageFlow}>
        <PageHeader eyebrow={t("progress.eyebrow")} title={t("progress.title")} lead={t("progress.lead")} />
        <EmptyState icon={TriangleAlert} title={t("progress.error.title")} body={t("progress.error.body")} />
      </div>
    );
  }

  // lastFinished is a completed or reviewed session only. A scheduled one has not happened, and the in_progress
  // rows the old app opened on every visit say nothing about an exercise done, so the tile is hidden without one.
  const { sessions, total, finished, lastFinished } = history;

  return (
    <div className={pageFlow}>
      <PageHeader eyebrow={t("progress.eyebrow")} title={t("progress.title")} lead={t("progress.lead")} />

      {sessions.length > 0 && (
        <section aria-label={t("progress.summary.label")} className={tileGrid}>
          <div className={cn(card, "p-5")}>
            <p className={cn("flex items-center gap-2", tileLabel)}>
              <CircleCheck className="size-5 shrink-0 text-signal-deep" strokeWidth={2} aria-hidden="true" />
              {t("progress.summary.finished")}
            </p>
            <p className={cn("mt-2", metricValue)}>{finished}</p>
          </div>
          {lastFinished && (
            <div className={cn(card, "p-5")}>
              <p className={cn("flex items-center gap-2", tileLabel)}>
                <CalendarDays className="size-5 shrink-0 text-ink-soft" strokeWidth={2} aria-hidden="true" />
                {t("progress.summary.lastSession")}
              </p>
              <p className="mt-2 text-2xl font-semibold leading-tight text-ink">
                <LocalDateTime iso={lastFinished.startedAt} format="date" />
              </p>
            </div>
          )}
        </section>
      )}

      <ScoresNotAvailableCard />

      <section aria-labelledby="progress-history-title" className="space-y-4">
        <div className={sectionHead}>
          <h2 id="progress-history-title" className={sectionTitle}>
            {t("progress.history.title")}
          </h2>
          {total > sessions.length && (
            <p className="text-base text-ink-soft">
              {t("progress.history.showingLatest", { shown: sessions.length, total })}
            </p>
          )}
        </div>

        {sessions.length === 0 ? (
          <EmptyState
            icon={History}
            headingLevel={3}
            title={t("progress.empty.title")}
            body={t("progress.empty.body")}
            action={
              <Link href="/app" className={primaryButton}>
                {t("progress.empty.action")}
              </Link>
            }
          />
        ) : (
          <SessionLogTable sessions={sessions} checkIns={checkIns} t={t} />
        )}
      </section>
    </div>
  );
}

function SessionRow({ session, t }: { session: SessionEntry; t: Translate }) {
  const duration = formatDuration(session.startedAt, session.endedAt, t);
  return (
    <Link
      href={`/progress/${session.id}`}
      prefetch={false}
      className={cn(card, focusRing, "flex min-h-12 items-center gap-4 px-5 py-4 transition-colors hover:bg-paper-soft")}
    >
      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold text-ink">
          <LocalDateTime iso={session.startedAt} format="dateTime" />
        </p>
        <p className={cn("mt-1 text-base", session.exerciseName ? "text-ink" : "text-ink-soft")}>
          {session.exerciseName ?? t("progress.exerciseNotRecorded")}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1">
          <SessionStatus status={session.status} />
          {duration && (
            <span className="inline-flex items-center gap-2 text-base text-ink-soft">
              <Timer className="size-5 shrink-0" strokeWidth={2} aria-hidden="true" />
              <span className="sr-only">{t("progress.duration.label")}: </span>
              {duration}
            </span>
          )}
        </div>
      </div>
      <ChevronRight className="size-5 shrink-0 text-ink-soft" strokeWidth={2} aria-hidden="true" />
    </Link>
  );
}
