// One Heel Slide session for the clinician, at the top of the patient page. Server-rendered from the view the
// loader built (lib/clinic/heelSlideResult.ts): reps recounted from the stored frames against the prescribed
// target, the device's own count only as a labelled aside, the proxy chart, the technical facts a hardware check
// needs, and the patient's check-in answers. No score and no knee angle: the proxy is shown only on the chart,
// under its honest label.

import Link from "next/link";

import LocalDateTime from "@/components/app/LocalDateTime";
import { bodyText, card, cardTitle, eyebrow, metricValue, sectionTitle, textLink, tileLabel } from "@/components/app/recipes";
import HeelSlideProxyChart from "@/components/clinician/HeelSlideProxyChart";
import type { HeelSlideSection } from "@/lib/clinic/heelSlideResult";
import {
  type CheckInAnswers,
  formatDecimal,
  hexCode,
  type HeelSlideView,
  type RateReadout,
  type ReviewSessionItem,
  type SessionStatus,
} from "@/lib/clinic/heelSlideView";
import { cn } from "@/lib/utils";
import { getTranslation } from "@/locales/server";

type T = (key: string, vars?: Record<string, string | number>) => string;
type Visible = Exclude<HeelSlideSection, { kind: "none" }>;

/** Sessions listed for switching; the one on screen is always included. */
const SESSION_LINKS = 10;

export default function HeelSlideResult({ section }: { section: Visible }) {
  const { t } = getTranslation();
  const selectedId =
    section.kind === "ok" ? section.view.session.id : section.kind === "error" ? section.selectedId : null;

  return (
    <section aria-labelledby="heel-slide-result-title" className={cn(card, "p-5 shadow-soft sm:p-6")}>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-8">
          {section.kind === "ok" ? (
            <SessionResult view={section.view} t={t} />
          ) : (
            <header>
              <h2 id="heel-slide-result-title" className={sectionTitle}>
                {t("clinician.heelSlide.title")}
              </h2>
              <p role="status" className={cn(bodyText, "mt-3")}>
                {section.kind === "error" ? t("clinician.heelSlide.loadError") : t("clinician.heelSlide.unavailable")}
              </p>
            </header>
          )}
        </div>

        <aside className="space-y-8">
          {section.kind === "ok" && <CheckIn answers={section.view.checkIn} t={t} />}
          <SessionLinks patientId={section.patientId} sessions={section.sessions} selectedId={selectedId} t={t} />
        </aside>
      </div>
    </section>
  );
}

function SessionResult({ view, t }: { view: HeelSlideView; t: T }) {
  const { session } = view;
  return (
    <>
      <header>
        <p className={eyebrow}>{view.exerciseName ?? t("clinician.heelSlide.exerciseUnknown")}</p>
        <h2 id="heel-slide-result-title" className={cn(sectionTitle, "mt-2")}>
          {t("clinician.heelSlide.title")}
        </h2>
        <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
          <Fact label={t("clinician.heelSlide.statusLabel")} value={statusLabel(session.status, t)} />
          <Fact
            label={t("clinician.heelSlide.started")}
            value={session.startedAt ? <LocalDateTime iso={session.startedAt} format="dateTime" /> : t("clinician.heelSlide.unknown")}
          />
          <Fact
            label={t("clinician.heelSlide.ended")}
            value={
              session.endedAt ? (
                <LocalDateTime iso={session.endedAt} format="time" sameDayAs={session.startedAt ?? undefined} />
              ) : (
                t("clinician.heelSlide.notEnded")
              )
            }
          />
          <Fact label={t("clinician.heelSlide.duration")} value={durationLabel(session.durationMs, t)} />
        </dl>
      </header>

      <Reps view={view} t={t} />

      <div>
        <h3 className={cardTitle}>{t("clinician.heelSlide.chart.title")}</h3>
        <div className="mt-4">
          <HeelSlideProxyChart chart={view.chart} />
        </div>
      </div>

      <Technical view={view} t={t} />
    </>
  );
}

function Reps({ view, t }: { view: HeelSlideView; t: T }) {
  const { recount, targetReps, deviceCount } = view;
  const counted = recount.count;
  const value =
    counted === null
      ? t("clinician.heelSlide.unknown")
      : targetReps === null
        ? String(counted)
        : t("clinician.heelSlide.reps.ofTarget", { n: counted, target: targetReps });

  let deviceNote: string;
  if (deviceCount === null) deviceNote = t("clinician.heelSlide.reps.deviceMissing");
  else if (counted !== null && deviceCount === counted) deviceNote = t("clinician.heelSlide.reps.deviceSame");
  else deviceNote = t("clinician.heelSlide.reps.deviceDiffers", { n: deviceCount });

  return (
    <div>
      <h3 className={cardTitle}>{t("clinician.heelSlide.reps.title")}</h3>
      <p className={cn(bodyText, "mt-1")}>{t("clinician.heelSlide.reps.basis")}</p>
      <p className={cn(metricValue, "mt-3")}>{value}</p>
      <ul className="mt-3 space-y-1 text-base leading-relaxed text-ink-soft">
        {counted === null && (
          <li>{t("clinician.heelSlide.reps.notCountable", { pairs: view.pairing.pairs })}</li>
        )}
        {recount.reason === "no_excursion_detected" && <li>{t("clinician.heelSlide.reps.noExcursion")}</li>}
        {targetReps === null && <li>{t("clinician.heelSlide.reps.noTarget")}</li>}
        <li>{deviceNote}</li>
      </ul>
    </div>
  );
}

function Technical({ view, t }: { view: HeelSlideView; t: T }) {
  const { locale } = getTranslation();
  const unknown = t("clinician.heelSlide.unknown");
  const ms = (value: number | null) =>
    value === null ? unknown : t("clinician.heelSlide.tech.msValue", { n: formatDecimal(value, locale, 0) });
  const { thresholds } = view.recount;

  return (
    <div>
      <h3 className={cardTitle}>{t("clinician.heelSlide.tech.title")}</h3>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-left text-base">
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className={cn(tileLabel, "py-2 pr-4")}>{t("clinician.heelSlide.tech.role")}</th>
              <th scope="col" className={cn(tileLabel, "py-2 pr-4")}>{t("clinician.heelSlide.tech.device")}</th>
              <th scope="col" className={cn(tileLabel, "py-2 pr-4 text-right")}>{t("clinician.heelSlide.tech.frames")}</th>
              <th scope="col" className={cn(tileLabel, "py-2 pr-4 text-right")}>{t("clinician.heelSlide.tech.deliveredHz")}</th>
              <th scope="col" className={cn(tileLabel, "py-2")}>{t("clinician.heelSlide.tech.rate")}</th>
            </tr>
          </thead>
          <tbody>
            {view.roles.map((row) => (
              <tr key={row.role} className="border-b border-line align-top">
                <th scope="row" className="py-2 pr-4 font-medium text-ink">{t(`sensors.role.${row.role}`)}</th>
                <td className="py-2 pr-4 text-ink-soft [overflow-wrap:anywhere]">{row.deviceName ?? unknown}</td>
                <td className="tnum py-2 pr-4 text-right text-ink">
                  {row.storedFrames === null ? unknown : formatDecimal(row.storedFrames, locale, 0)}
                </td>
                <td className="tnum py-2 pr-4 text-right text-ink">
                  {row.deliveredHz === null
                    ? unknown
                    : t("clinician.heelSlide.tech.hzValue", { n: formatDecimal(row.deliveredHz, locale) })}
                </td>
                <td className="py-2 text-ink-soft">{rateLabel(row.rate, t)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mt-3 space-y-1 text-sm leading-relaxed text-ink-soft">
        <li>{t("clinician.heelSlide.tech.hzBasis")}</li>
        <li>{t("clinician.heelSlide.tech.footHzUnavailable")}</li>
      </ul>

      <dl className="mt-6 grid gap-x-8 gap-y-3 sm:grid-cols-2">
        <Fact label={t("clinician.heelSlide.tech.pairs")} value={formatDecimal(view.pairing.pairs, locale, 0)} />
        <Fact
          label={t("clinician.heelSlide.tech.unpairedShank")}
          value={formatDecimal(view.pairing.unpairedShank, locale, 0)}
        />
        <Fact label={t("clinician.heelSlide.tech.medianSkew")} value={ms(view.pairing.medianSkewMs)} />
        <Fact label={t("clinician.heelSlide.tech.maxSkew")} value={ms(view.pairing.maxSkewMs)} />
        <Fact
          label={t("clinician.heelSlide.tech.pendingAtFinish")}
          value={view.pendingAtFinish === null ? unknown : formatDecimal(view.pendingAtFinish, locale, 0)}
        />
        <Fact
          label={t("clinician.heelSlide.tech.thresholds")}
          value={t("clinician.heelSlide.tech.thresholdsValue", {
            enter: formatDecimal(thresholds.enterDeg, locale),
            exit: formatDecimal(thresholds.exitDeg, locale),
            ms: formatDecimal(thresholds.minRepMs, locale, 0),
          })}
        />
      </dl>
    </div>
  );
}

function CheckIn({ answers, t }: { answers: CheckInAnswers | null; t: T }) {
  const unknown = t("clinician.heelSlide.unknown");
  const scale = (value: number | null) =>
    value === null ? unknown : t("clinician.heelSlide.checkIn.scale", { n: value });

  return (
    <div>
      <h3 className={cardTitle}>{t("clinician.heelSlide.checkIn.title")}</h3>
      {answers === null ? (
        <p className={cn(bodyText, "mt-3")}>{t("clinician.heelSlide.checkIn.none")}</p>
      ) : (
        <dl className="mt-4 space-y-3">
          <Fact label={t("clinician.heelSlide.checkIn.painBefore")} value={scale(answers.painBefore)} />
          <Fact label={t("clinician.heelSlide.checkIn.painAfter")} value={scale(answers.painAfter)} />
          <Fact label={t("clinician.heelSlide.checkIn.difficulty")} value={scale(answers.difficulty)} />
          <Fact
            label={t("clinician.heelSlide.checkIn.kneeFeels")}
            value={answers.kneeFeels ? t(`clinician.heelSlide.checkIn.knee.${answers.kneeFeels}`) : unknown}
          />
          <Fact
            label={t("clinician.heelSlide.checkIn.symptoms")}
            value={
              answers.symptoms.length
                ? answers.symptoms.map((symptom) => t(`clinician.heelSlide.checkIn.symptom.${symptom}`)).join(", ")
                : t("clinician.heelSlide.checkIn.symptomsNone")
            }
          />
          {answers.otherNote && (
            <Fact
              label={t("clinician.heelSlide.checkIn.otherNote")}
              value={<span className="whitespace-pre-line [overflow-wrap:anywhere]">{answers.otherNote}</span>}
            />
          )}
          <Fact
            label={t("clinician.heelSlide.checkIn.submittedAt")}
            value={answers.submittedAt ? <LocalDateTime iso={answers.submittedAt} format="dateTime" /> : unknown}
          />
          <Fact
            label={t("clinician.heelSlide.checkIn.language")}
            value={answers.language ? t(`clinician.heelSlide.checkIn.languageName.${answers.language}`) : unknown}
          />
        </dl>
      )}
    </div>
  );
}

function SessionLinks({
  patientId,
  sessions,
  selectedId,
  t,
}: {
  patientId: string;
  sessions: ReviewSessionItem[];
  selectedId: string | null;
  t: T;
}) {
  const shown = sessions.slice(0, SESSION_LINKS);
  const selected = sessions.find((item) => item.id === selectedId);
  if (selected && !shown.includes(selected)) shown.push(selected);

  return (
    <nav aria-labelledby="heel-slide-sessions-title">
      <h3 id="heel-slide-sessions-title" className={cardTitle}>
        {t("clinician.heelSlide.sessions.title")}
      </h3>
      <ul className="mt-3 divide-y divide-line border-y border-line">
        {shown.map((item) => {
          const current = item.id === selectedId;
          return (
            <li key={item.id}>
              <Link
                href={`/clinician/patient/${patientId}?session=${item.id}`}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex min-h-12 flex-col justify-center gap-0.5 rounded-sm px-2 py-2 text-base transition-colors hover:bg-paper-soft",
                  current && "bg-paper-soft",
                )}
              >
                <span className={cn("text-ink", current && "font-semibold")}>
                  {item.startedAt ? <LocalDateTime iso={item.startedAt} format="dateTime" /> : t("clinician.heelSlide.unknown")}
                </span>
                <span className="text-sm text-ink-soft">
                  {statusLabel(item.status, t)} ·{" "}
                  {item.hasCheckIn ? t("clinician.heelSlide.sessions.hasCheckIn") : t("clinician.heelSlide.sessions.noCheckIn")}
                  {current && ` · ${t("clinician.heelSlide.sessions.current")}`}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {sessions.length > shown.length && (
        <p className="mt-2 text-sm text-ink-soft">
          {t("clinician.heelSlide.sessions.more", { n: sessions.length - shown.length })}
        </p>
      )}
      <Link href="/clinician" className={cn(textLink, "mt-4 inline-block text-base")}>
        {t("common.backToCaseload")}
      </Link>
    </nav>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className={tileLabel}>{label}</dt>
      <dd className="tnum mt-0.5 text-base text-ink">{value}</dd>
    </div>
  );
}

function statusLabel(status: SessionStatus | null, t: T): string {
  return t(`clinician.heelSlide.status.${status ?? "unknown"}`);
}

function durationLabel(durationMs: number | null, t: T): string {
  if (durationMs === null) return t("clinician.heelSlide.unknown");
  const totalS = Math.round(durationMs / 1000);
  const m = Math.floor(totalS / 60);
  const s = totalS % 60;
  return m > 0
    ? t("clinician.heelSlide.durationMinutes", { m, s })
    : t("clinician.heelSlide.durationSeconds", { s });
}

function rateLabel(rate: RateReadout, t: T): string {
  if (rate.status === "unknown") return t("clinician.heelSlide.unknown");
  const requested =
    rate.requestedHz === null ? "" : ` · ${t("clinician.heelSlide.tech.requestedHz", { hz: rate.requestedHz })}`;
  if (rate.status === "confirmed") return `${t("clinician.heelSlide.tech.rateConfirmed")}${requested}`;
  if (rate.status === "pending") return `${t("clinician.heelSlide.tech.ratePending")}${requested}`;
  const reason =
    rate.failure === null
      ? ""
      : `: ${t(`clinician.heelSlide.tech.rateFailure.${rate.failure}`, {
          code: rate.readbackCode === null ? t("clinician.heelSlide.unknown") : hexCode(rate.readbackCode),
        })}`;
  return `${t("clinician.heelSlide.tech.rateUnconfirmed")}${reason}${requested}`;
}
