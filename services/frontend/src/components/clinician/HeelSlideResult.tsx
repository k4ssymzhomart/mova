// One Heel Slide session for the clinician, inside the patient page after its header. Server-rendered from the
// view the loader built (lib/clinic/heelSlideResult.ts): reps recounted from the stored frames against the
// prescribed target (with several presses of «Начать», the sum and each start's own count), the device's own count
// only as a labelled aside, the proxy chart, the technical facts a hardware check needs (per-sensor frames and rates,
// the rate checks, battery at start and finish, reconnects, the skew between sensors kept apart from the recount's
// pairing tolerance, what the device confirmed sending), and the patient's check-in answers. No score and no knee
// angle: the proxy is shown only on the chart, under its honest label.

import Link from "next/link";

import LocalDateTime from "@/components/app/LocalDateTime";
import { bodyText, card, cardTitle, eyebrow, metricValue, sectionTitle, textLink, tileLabel } from "@/components/app/recipes";
import HeelSlideProxyChart from "@/components/clinician/HeelSlideProxyChart";
import type { HeelSlideSection } from "@/lib/clinic/heelSlideResult";
import {
  type BatteryValue,
  type CheckInAnswers,
  clockDuration,
  type DeviceIdentity,
  deviceCountNote,
  formatDecimal,
  hexCode,
  type HeelSlideView,
  type RateReadout,
  type ReviewSessionItem,
  type SessionStatus,
  type StartRecount,
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

  let problem: string | null = null;
  if (section.kind === "error") {
    problem = t(section.selectedId === null ? "clinician.heelSlide.listError" : "clinician.heelSlide.loadError");
  } else if (section.kind === "unavailable") {
    problem = t("clinician.heelSlide.unavailable");
  }

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
                {problem}
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
  const { locale } = getTranslation();
  const { recount, targetReps, deviceCount } = view;
  const counted = recount.count;
  const value =
    counted === null
      ? t("clinician.heelSlide.unknown")
      : targetReps === null
        ? String(counted)
        : t("clinician.heelSlide.reps.ofTarget", { n: counted, target: targetReps });

  const note = deviceCountNote(view);
  const deviceNote =
    note === "missing"
      ? t("clinician.heelSlide.reps.deviceMissing")
      : note === "last_start_only"
        ? t("clinician.heelSlide.reps.deviceLastStartOnly", { n: deviceCount ?? 0 })
        : note === "same"
          ? t("clinician.heelSlide.reps.deviceSame")
          : t("clinician.heelSlide.reps.deviceDiffers", { n: deviceCount ?? 0 });

  const windowEmpty = recount.baseline.source === "window" && !recount.baseline.zeroFound;
  const sessionStartMs = view.session.startedAt ? Date.parse(view.session.startedAt) : NaN;
  const startLine = (start: StartRecount) => {
    const vars = { i: start.number, time: sinceSessionStart(start.windowStartMs, sessionStartMs, t) };
    if (!start.zeroFound) return t("clinician.heelSlide.reps.perStartNoZero", vars);
    if (start.count === null) return t("clinician.heelSlide.reps.perStartTooFew", { ...vars, pairs: start.pairs });
    return t("clinician.heelSlide.reps.perStart", { ...vars, n: start.count });
  };

  return (
    <div>
      <h3 className={cardTitle}>{t("clinician.heelSlide.reps.title")}</h3>
      <p className={cn(bodyText, "mt-1")}>{t("clinician.heelSlide.reps.basis")}</p>
      <p className={cn(metricValue, "mt-3")}>{value}</p>
      {recount.starts.length > 1 && (
        <div className="mt-3">
          <p className="text-base font-medium leading-relaxed text-ink">{t("clinician.heelSlide.reps.perStartTitle")}</p>
          <ol className="mt-1 space-y-1 text-base leading-relaxed text-ink">
            {recount.starts.map((start) => (
              <li key={start.number} className="tnum">
                {startLine(start)}
              </li>
            ))}
          </ol>
        </div>
      )}
      <ul className="mt-3 space-y-1 text-base leading-relaxed text-ink-soft">
        {windowEmpty && <li>{t("clinician.heelSlide.reps.windowEmpty")}</li>}
        {counted === null && !windowEmpty && (
          <li>{t("clinician.heelSlide.reps.notCountable", { pairs: view.pairing.pairs })}</li>
        )}
        {recount.reason === "no_excursion_detected" && <li>{t("clinician.heelSlide.reps.noExcursion")}</li>}
        {recount.cancelled > 0 && (
          <li>
            {t("clinician.heelSlide.reps.cancelled", {
              n: recount.cancelled,
              ms: formatDecimal(recount.maxGapMs, locale, 0),
            })}
          </li>
        )}
        {recount.baseline.pairsBeforeWindow > 0 && (
          <li>{t("clinician.heelSlide.reps.beforeFirstStart", { n: recount.baseline.pairsBeforeWindow })}</li>
        )}
        {recount.baseline.source === "first_samples" && counted !== null && (
          <li>{t("clinician.heelSlide.reps.zeroFromFirstFrames")}</li>
        )}
        {view.restartedAfterReload === true && <li>{t("clinician.heelSlide.reps.restarted")}</li>}
        {targetReps === null && <li>{t("clinician.heelSlide.reps.noTarget")}</li>}
        <li>{deviceNote}</li>
      </ul>
    </div>
  );
}

function Technical({ view, t }: { view: HeelSlideView; t: T }) {
  const { locale } = getTranslation();
  const unknown = t("clinician.heelSlide.unknown");
  const whole = (value: number | null) => (value === null ? unknown : formatDecimal(value, locale, 0));
  const ms = (value: number | null) =>
    value === null ? unknown : t("clinician.heelSlide.tech.msValue", { n: formatDecimal(value, locale, 0) });
  const battery = (value: BatteryValue | null) => {
    if (value === null) return unknown;
    const volts = formatDecimal(value.volts, locale, 2);
    return value.vendorPercent === null
      ? t("clinician.heelSlide.tech.batteryVolts", { v: volts })
      : t("clinician.heelSlide.tech.batteryValue", { v: volts, pct: formatDecimal(value.vendorPercent, locale, 0) });
  };
  const device = (identity: DeviceIdentity) =>
    [identity.name ?? unknown, identity.idShort ? t("clinician.heelSlide.tech.deviceId", { id: identity.idShort }) : null]
      .filter(Boolean)
      .join(" · ");

  const sessionStartMs = view.session.startedAt ? Date.parse(view.session.startedAt) : NaN;
  const checkTime = (atMs: number | null) => sinceSessionStart(atMs, sessionStartMs, t);
  const { thresholds } = view.recount;
  const skew = view.interSensorSkew.thighShank;
  const th = cn(tileLabel, "py-2 pr-4");

  return (
    <div>
      <h3 className={cardTitle}>{t("clinician.heelSlide.tech.title")}</h3>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-base">
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className={th}>{t("clinician.heelSlide.tech.role")}</th>
              <th scope="col" className={th}>{t("clinician.heelSlide.tech.device")}</th>
              <th scope="col" className={cn(th, "text-right")}>{t("clinician.heelSlide.tech.frames")}</th>
              <th scope="col" className={cn(th, "text-right")}>{t("clinician.heelSlide.tech.deliveredHz")}</th>
              <th scope="col" className={cn(tileLabel, "py-2")}>{t("clinician.heelSlide.tech.rate")}</th>
            </tr>
          </thead>
          <tbody>
            {view.roles.map((row) => (
              <tr key={row.role} className="border-b border-line align-top">
                <th scope="row" className="py-2 pr-4 font-medium text-ink">{t(`sensors.role.${row.role}`)}</th>
                <td className="py-2 pr-4 text-ink-soft [overflow-wrap:anywhere]">
                  <span className="text-ink">{row.deviceSource === null ? unknown : device(row.device)}</span>
                  {row.deviceSource === "start" && (
                    <span className="block text-sm">{t("clinician.heelSlide.tech.fromStart")}</span>
                  )}
                  {row.deviceAtStartIfChanged && (
                    <span className="block text-sm">
                      {t("clinician.heelSlide.tech.deviceAtStart", { device: device(row.deviceAtStartIfChanged) })}
                    </span>
                  )}
                </td>
                <td className="tnum py-2 pr-4 text-right text-ink">{whole(row.storedFrames)}</td>
                <td className="tnum py-2 pr-4 text-right text-ink">
                  {row.deliveredHz === null
                    ? unknown
                    : t("clinician.heelSlide.tech.hzValue", { n: formatDecimal(row.deliveredHz, locale) })}
                </td>
                <td className="py-2 text-ink-soft">
                  <span className="text-ink">{rateLabel(row.rate, t)}</span>
                  {row.rateSource === "start" && row.rate.status !== "unknown" && (
                    <span className="block text-sm">{t("clinician.heelSlide.tech.fromStart")}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mt-3 space-y-1 text-sm leading-relaxed text-ink-soft">
        <li>{t("clinician.heelSlide.tech.hzBasis")}</li>
        <li>{t("clinician.heelSlide.tech.footHzUnavailable")}</li>
      </ul>

      <h4 className="mt-6 text-lg font-semibold text-ink">{t("clinician.heelSlide.tech.rateChecks")}</h4>
      <div className="mt-2 grid gap-4 sm:grid-cols-3">
        {view.roles.map((row) => (
          <div key={row.role}>
            <p className={tileLabel}>
              {t(`sensors.role.${row.role}`)}
              {row.requestedHz !== null && ` · ${t("clinician.heelSlide.tech.requestedHz", { hz: row.requestedHz })}`}
            </p>
            {row.rateChecks?.length ? (
              <ol className="mt-1 space-y-1 text-base leading-snug text-ink">
                {row.rateChecks.map((check, i) => (
                  <li key={i}>
                    <span className="tnum text-ink-soft">{checkTime(check.atMs)}</span>: {rateLabel(check.readout, t, false)}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-1 text-base text-ink-soft">{t("clinician.heelSlide.tech.rateChecksNone")}</p>
            )}
          </div>
        ))}
      </div>

      <h4 className="mt-6 text-lg font-semibold text-ink">{t("clinician.heelSlide.tech.linkTitle")}</h4>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-left text-base">
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className={th}>{t("clinician.heelSlide.tech.role")}</th>
              <th scope="col" className={th}>{t("clinician.heelSlide.tech.batteryStart")}</th>
              <th scope="col" className={th}>{t("clinician.heelSlide.tech.batteryEnd")}</th>
              <th scope="col" className={cn(tileLabel, "py-2 text-right")}>{t("clinician.heelSlide.tech.reconnects")}</th>
            </tr>
          </thead>
          <tbody>
            {view.roles.map((row) => (
              <tr key={row.role} className="border-b border-line align-top">
                <th scope="row" className="py-2 pr-4 font-medium text-ink">{t(`sensors.role.${row.role}`)}</th>
                <td className="tnum py-2 pr-4 text-ink">{battery(row.batteryStart)}</td>
                <td className="tnum py-2 pr-4 text-ink">{battery(row.batteryEnd)}</td>
                <td className="tnum py-2 text-right text-ink">{whole(row.reconnects)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mt-3 space-y-1 text-sm leading-relaxed text-ink-soft">
        <li>{t("clinician.heelSlide.tech.batteryBasis")}</li>
        <li>{t("clinician.heelSlide.tech.reconnectsBasis")}</li>
      </ul>

      <h4 className="mt-6 text-lg font-semibold text-ink">{t("clinician.heelSlide.tech.skewTitle")}</h4>
      <dl className="mt-2 grid gap-x-8 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
        <Fact label={t("clinician.heelSlide.tech.skewMedian")} value={ms(skew ? skew.medianMs : null)} />
        <Fact label={t("clinician.heelSlide.tech.skewP95")} value={ms(skew ? skew.p95Ms : null)} />
        <Fact label={t("clinician.heelSlide.tech.skewMax")} value={ms(skew ? skew.maxMs : null)} />
        <Fact label={t("clinician.heelSlide.tech.skewFrames")} value={whole(skew ? skew.frames : null)} />
      </dl>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">{t("clinician.heelSlide.tech.skewBasis")}</p>

      <h4 className="mt-6 text-lg font-semibold text-ink">{t("clinician.heelSlide.tech.pairingTitle")}</h4>
      <dl className="mt-2 grid gap-x-8 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
        <Fact label={t("clinician.heelSlide.tech.pairs")} value={whole(view.pairing.pairs)} />
        <Fact label={t("clinician.heelSlide.tech.unpairedShank")} value={whole(view.pairing.unpairedShank)} />
        <Fact label={t("clinician.heelSlide.tech.medianSkew")} value={ms(view.pairing.medianSkewMs)} />
        <Fact label={t("clinician.heelSlide.tech.maxSkew")} value={ms(view.pairing.maxSkewMs)} />
      </dl>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">
        {t("clinician.heelSlide.tech.pairingBasis", { ms: formatDecimal(view.pairingToleranceMs, locale, 0) })}
      </p>

      <dl className="mt-6 grid gap-x-8 gap-y-3 sm:grid-cols-2">
        <Fact label={t("clinician.heelSlide.tech.framesConfirmed")} value={whole(view.telemetry.framesConfirmed)} />
        <Fact label={t("clinician.heelSlide.tech.pendingAtFinish")} value={whole(view.telemetry.pendingAtFinish)} />
        <Fact label={t("clinician.heelSlide.tech.sendErrors")} value={whole(view.telemetry.errors)} />
        <Fact label={t("clinician.heelSlide.tech.framesDropped")} value={whole(view.telemetry.dropped)} />
        <Fact
          label={t("clinician.heelSlide.tech.thresholds")}
          value={t("clinician.heelSlide.tech.thresholdsValue", {
            enter: formatDecimal(thresholds.enterDeg, locale),
            exit: formatDecimal(thresholds.exitDeg, locale),
            ms: formatDecimal(thresholds.minRepMs, locale, 0),
          })}
        />
        <Fact label={t("clinician.heelSlide.tech.maxGap")} value={ms(view.recount.maxGapMs)} />
      </dl>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">{t("clinician.heelSlide.tech.telemetryBasis")}</p>
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
  const backLink = (
    <Link href="/clinician" className={cn(textLink, "mt-4 inline-block text-base")}>
      {t("common.backToCaseload")}
    </Link>
  );

  // The list did not load: there is nothing to switch between, only the way back.
  if (!sessions.length) return backLink;

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
      {backLink}
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

/** A device-clock time against the session's start, e.g. «через 1:05 после начала». */
function sinceSessionStart(atMs: number | null, sessionStartMs: number, t: T): string {
  if (atMs === null || !Number.isFinite(sessionStartMs)) return t("clinician.heelSlide.unknown");
  return atMs < sessionStartMs
    ? t("clinician.heelSlide.tech.checkBeforeStart", { time: clockDuration(sessionStartMs - atMs) })
    : t("clinician.heelSlide.tech.checkAfterStart", { time: clockDuration(atMs - sessionStartMs) });
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

function rateLabel(rate: RateReadout, t: T, withRequested = true): string {
  if (rate.status === "unknown") return t("clinician.heelSlide.unknown");
  const requested =
    !withRequested || rate.requestedHz === null
      ? ""
      : ` · ${t("clinician.heelSlide.tech.requestedHz", { hz: rate.requestedHz })}`;
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
