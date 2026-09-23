// What the patient has done, for the clinician: the two-week comparison first, then every finished session.
//
// The comparison is arithmetic on stored rows and nothing else — how many sessions, mean repetitions, mean pain
// after — with the previous week beside it so the direction is visible rather than asserted. Where a week holds no
// number, the cell says so instead of showing a zero. There is no traffic light and no verdict: a doctor reads the
// numbers, and the app does not tell them whether a patient is doing well.

import LocalDateTime from "@/components/app/LocalDateTime";
import { card, cardTitle, sectionTitle, tileLabel } from "@/components/app/recipes";
import type { ProgressSession, ProgressTrend } from "@/lib/clinic/patientProgress";
import { cn } from "@/lib/utils";
import { getTranslation } from "@/locales/server";

const DASH = "—";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

function Delta({ now, before, betterIsUp, t }: { now: number | null; before: number | null; betterIsUp: boolean; t: Translate }) {
  if (now === null || before === null) return <span className="text-ink-faint">{DASH}</span>;
  const diff = Math.round((now - before) * 10) / 10;
  if (diff === 0) return <span className="text-ink-soft">{t("clinician.progress.same")}</span>;
  const better = betterIsUp ? diff > 0 : diff < 0;
  return (
    <span className={better ? "text-signal-deep" : "text-ink"}>
      {diff > 0 ? "+" : ""}
      {diff}
    </span>
  );
}

function TrendTiles({ trend, t }: { trend: ProgressTrend; t: Translate }) {
  const tiles: { label: string; now: number | null; before: number | null; betterIsUp: boolean }[] = [
    {
      label: t("clinician.progress.sessions"),
      now: trend.sessionsThisWeek,
      before: trend.sessionsWeekBefore,
      betterIsUp: true,
    },
    { label: t("clinician.progress.reps"), now: trend.repsThisWeek, before: trend.repsWeekBefore, betterIsUp: true },
    { label: t("clinician.progress.pain"), now: trend.painThisWeek, before: trend.painWeekBefore, betterIsUp: false },
  ];
  return (
    <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))]">
      {tiles.map((tile) => (
        <div key={tile.label} className={cn(card, "p-5")}>
          <p className={tileLabel}>{tile.label}</p>
          <p className="mt-2 flex items-baseline gap-3">
            <span className="tnum text-3xl font-semibold text-ink">{tile.now ?? DASH}</span>
            <span className="tnum text-base">
              <Delta now={tile.now} before={tile.before} betterIsUp={tile.betterIsUp} t={t} />
            </span>
          </p>
          <p className="mt-1 text-[15px] text-ink-soft">
            {t("clinician.progress.weekBefore", { n: tile.before ?? DASH })}
          </p>
        </div>
      ))}
      <div className={cn(card, "p-5")}>
        <p className={tileLabel}>{t("clinician.progress.symptoms")}</p>
        <p className={cn("mt-2 tnum text-3xl font-semibold", trend.symptomReports > 0 ? "text-ink" : "text-ink")}>
          {trend.symptomReports}
        </p>
        <p className="mt-1 text-[15px] text-ink-soft">{t("clinician.progress.symptomsHint")}</p>
      </div>
    </div>
  );
}

function feels(value: string | null, t: Translate): string {
  if (!value) return DASH;
  const known = ["better", "same", "slightly_worse", "much_worse"];
  return known.includes(value) ? t(`flow.checkIn.kneeOpt.${value}`) : value;
}

export default function PatientProgressPanel({
  sessions,
  trend,
}: {
  sessions: ProgressSession[];
  trend: ProgressTrend | null;
}) {
  const { t } = getTranslation();

  return (
    <section aria-labelledby="progress-title" className="space-y-4">
      <h2 id="progress-title" className={sectionTitle}>
        {t("clinician.progress.title")}
      </h2>

      {trend ? (
        <TrendTiles trend={trend} t={t} />
      ) : (
        <p className="max-w-measure text-base leading-relaxed text-ink-soft">{t("clinician.progress.noTrend")}</p>
      )}

      {sessions.length === 0 ? (
        <div className={cn(card, "p-8 text-center")}>
          <h3 className={cardTitle}>{t("clinician.progress.emptyTitle")}</h3>
          <p className="mx-auto mt-2 max-w-measure text-base leading-relaxed text-ink-soft">
            {t("clinician.progress.emptyBody")}
          </p>
        </div>
      ) : (
        <div className={cn(card, "overflow-x-auto")}>
          <table className="w-full min-w-[56rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-paper-soft">
                {[
                  t("clinician.progress.date"),
                  t("clinician.progress.exercise"),
                  t("clinician.progress.repsColumn"),
                  t("clinician.progress.score"),
                  t("clinician.progress.painColumn"),
                  t("clinician.progress.difficulty"),
                  t("clinician.progress.feels"),
                  t("clinician.progress.symptomsColumn"),
                ].map((column) => (
                  <th key={column} scope="col" className={cn("px-4 py-3 font-medium", tileLabel)}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-4 align-middle text-ink">
                    <LocalDateTime iso={session.startedAt} format="dateTime" />
                    {session.simulated && (
                      <span className="ms-2 rounded-pill border border-line px-2 py-0.5 text-[13px] text-ink-soft">
                        {t("clinician.progress.simulated")}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-4 align-middle text-ink">{session.exerciseName ?? DASH}</td>
                  <td className="tnum px-4 py-4 align-middle text-ink">
                    {session.reps === null
                      ? DASH
                      : session.targetReps === null
                        ? session.reps
                        : t("clinician.progress.repsOf", { done: session.reps, target: session.targetReps })}
                  </td>
                  <td className="tnum px-4 py-4 align-middle text-ink">
                    {session.execution === null ? (
                      <span className="text-ink-soft">{t("clinician.progress.notScored")}</span>
                    ) : (
                      <>
                        {session.execution}
                        {session.partialScore && (
                          <span className="ms-2 text-[13px] text-ink-soft">{t("clinician.progress.partial")}</span>
                        )}
                      </>
                    )}
                  </td>
                  <td className="tnum px-4 py-4 align-middle text-ink">
                    {session.painBefore === null && session.painAfter === null
                      ? DASH
                      : `${session.painBefore ?? DASH} → ${session.painAfter ?? DASH}`}
                  </td>
                  <td className="tnum px-4 py-4 align-middle text-ink">{session.difficulty ?? DASH}</td>
                  <td className="px-4 py-4 align-middle text-ink">{feels(session.kneeFeels, t)}</td>
                  <td className="px-4 py-4 align-middle text-ink">
                    {session.symptoms.length === 0
                      ? DASH
                      : session.symptoms.map((symptom) => t(`flow.checkIn.symptomOpt.${symptom}`)).join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
