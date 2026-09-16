"use client";

// SensorTechnicalReadout — the numbers the hardware test protocol is read from (docs/heel-slide-path.md), per
// sensor: advertised name and short device id, the requested rate and every readback with the code the sensor
// reported, the delivered rate, frames over the last 30 and 60 s, total frames and time connected, battery, and
// reconnects. It sits in a <details> block that stays closed unless someone opens it, so a patient is not shown it.
// Used on the sensors step and on the exercise screen.
//
// Every value is what the live store measured (lib/ble/liveSensors). "—" means not known yet: a rolling count before
// its window has fully passed since the first frame, a delivered rate before one window. The battery percent is
// WitMotion's interpolation table for the voltage and is labelled so; a failed read is shown as unknown, with the
// last good reading dated rather than passed off as current. The rate readback is dated the same way while the
// sensor is not streaming: the rate lives in the sensor's RAM, so a past confirmation is shown as the last check.
//
// With the development simulation on (lib/ble/simulation.ts) the block says first that the frames and the rate
// readback come from the simulation, labels the readback as the simulation's, and gives the battery as unknown
// because the simulation reports none.

import { ChevronRight } from "lucide-react";
import { Fragment, useId, type ReactNode } from "react";

import { card, focusRing } from "@/components/app/recipes";
import { useLiveSensors, type LiveRoleState, type RateHistoryEntry } from "@/lib/ble/liveSensors";
import { SENSOR_ROLE_ORDER } from "@/lib/ble/roles";
import type { SampleRateResult } from "@/lib/ble/sampleRate";
import { SIMULATION_ENABLED } from "@/lib/ble/simulation";
import { cn } from "@/lib/utils";
import type { Locale } from "@/locales";
import { useTranslation } from "@/locales/client";

import {
  batteryReasonKey,
  batteryView,
  formatClockTime,
  formatNumber,
  hexCode,
  linkLabelKey,
  rateView,
  secondsUntil,
  wholeSeconds,
} from "./sensorReadout";

type Translate = ReturnType<typeof useTranslation>["t"];

const UNKNOWN = "—";

export default function SensorTechnicalReadout() {
  const live = useLiveSensors();
  const { t, locale } = useTranslation();
  // The store republishes a few times a second while connected, which keeps the "seconds ago" values current.
  const nowMs = Date.now();

  return (
    <details className={cn(card, "group")}>
      <summary
        className={cn(
          "flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-card px-5 py-3 text-base font-semibold text-ink [&::-webkit-details-marker]:hidden",
          focusRing,
        )}
      >
        <ChevronRight
          className="size-5 shrink-0 text-ink-soft transition-transform group-open:rotate-90 motion-reduce:transition-none"
          strokeWidth={2}
          aria-hidden="true"
        />
        {t("flow.readout.title")}
      </summary>
      <div className="space-y-6 border-t border-line px-5 py-5">
        {SIMULATION_ENABLED && (
          <p className="text-sm font-semibold leading-relaxed text-ink">{t("flow.readout.simulatedHint")}</p>
        )}
        <p className="text-sm leading-relaxed text-ink-soft">{t("flow.readout.hint")}</p>
        {SENSOR_ROLE_ORDER.map((role) => (
          <RoleReadout key={role} state={live.roles[role]} t={t} locale={locale} nowMs={nowMs} />
        ))}
      </div>
    </details>
  );
}

function RoleReadout({
  state,
  t,
  locale,
  nowMs,
}: {
  state: LiveRoleState;
  t: Translate;
  locale: Locale;
  nowMs: number;
}) {
  const titleId = useId();
  const hz = (value: number) => t("flow.readout.hz", { hz: formatNumber(locale, value, 1) });
  const count = (value: number | null) => (value === null ? UNKNOWN : formatNumber(locale, value));
  const outcome = (result: SampleRateResult) => rateOutcome(t, result);

  let readback: ReactNode = UNKNOWN;
  const rate = rateView(state);
  if (rate.kind === "configuring") {
    readback = t("flow.readout.readbackConfiguring", { hz: hz(rate.requestedHz) });
  } else if (rate.kind === "current") {
    readback = outcome(rate.result);
  } else if (rate.kind === "last") {
    readback = t("flow.readout.readbackLast", {
      time: formatClockTime(locale, rate.atMs),
      result: outcome(rate.result),
    });
  }

  const history: ReactNode =
    state.rateHistory.length === 0 ? (
      UNKNOWN
    ) : (
      <ol className="space-y-0.5">
        {state.rateHistory.map((entry: RateHistoryEntry, index) => (
          <li key={`${entry.atMs}-${index}`}>
            {t("flow.readout.historyEntry", {
              time: formatClockTime(locale, entry.atMs),
              hz: hz(entry.requestedHz),
              result: outcome(entry),
            })}
          </li>
        ))}
      </ol>
    );

  const battery = batteryView(state);
  let batteryValue: ReactNode;
  if (battery.kind === "reading") {
    batteryValue = t("flow.readout.batteryValue", {
      volts: formatNumber(locale, battery.reading.volts, 2),
      percent: formatNumber(locale, battery.reading.vendorPercent),
    });
  } else if (battery.kind === "failed") {
    const last = battery.lastReading;
    batteryValue = (
      <>
        <span className="block">{t("flow.readout.batteryUnknown", { reason: t(batteryReasonKey(battery.reason)) })}</span>
        {last && (
          <span className="block text-ink-soft">
            {t("flow.readout.batteryLast", {
              s: formatNumber(locale, wholeSeconds(nowMs - last.atMs)),
              volts: formatNumber(locale, last.volts, 2),
              percent: formatNumber(locale, last.vendorPercent),
            })}
          </span>
        )}
      </>
    );
  } else {
    batteryValue = t("flow.readout.batteryUnread");
  }
  if (SIMULATION_ENABLED && state.deviceId !== null) batteryValue = t("flow.readout.batterySimulated");

  const { reconnect } = state;
  const nextIn = secondsUntil(reconnect.nextAttemptAtMs, nowMs);
  let reconnectState: string | null = null;
  if (reconnect.state === "reconnecting") {
    reconnectState =
      nextIn === null
        ? t("flow.readout.reconnectRunning")
        : t("flow.readout.reconnectNext", { s: formatNumber(locale, nextIn) });
  } else if (reconnect.state === "gave_up") {
    reconnectState = t("flow.readout.reconnectGaveUp");
  }

  const rows: { label: string; value: ReactNode }[] = [
    {
      label: t("flow.readout.device"),
      value:
        state.deviceId === null
          ? t("flow.readout.notConnected")
          : t("flow.readout.deviceValue", {
              name: state.deviceName ?? t("flow.readout.deviceUnnamed"),
              id: state.deviceIdShort ?? UNKNOWN,
            }),
    },
    { label: t("flow.readout.link"), value: t(linkLabelKey(state)) },
    { label: t("flow.readout.requested"), value: hz(state.requestedHz) },
    { label: t(SIMULATION_ENABLED ? "flow.readout.readbackSimulated" : "flow.readout.readback"), value: readback },
    { label: t("flow.readout.history"), value: history },
    { label: t("flow.readout.delivered"), value: state.deliveredHz === null ? UNKNOWN : hz(state.deliveredHz) },
    { label: t("flow.readout.frames30"), value: count(state.framesLast30s) },
    { label: t("flow.readout.frames60"), value: count(state.framesLast60s) },
    {
      label: t("flow.readout.framesTotal"),
      value: t("flow.readout.framesTotalValue", {
        n: formatNumber(locale, state.framesTotal),
        s: formatNumber(locale, wholeSeconds(state.connectedForMs)),
      }),
    },
    { label: t("flow.readout.battery"), value: batteryValue },
    {
      label: t("flow.readout.reconnects"),
      value: (
        <>
          <span className="block">
            {t("flow.readout.reconnectsValue", {
              attempts: formatNumber(locale, reconnect.attempts),
              succeeded: formatNumber(locale, reconnect.succeeded),
            })}
          </span>
          {reconnectState && <span className="block text-ink-soft">{reconnectState}</span>}
        </>
      ),
    },
  ];

  return (
    <section aria-labelledby={titleId}>
      <h3 id={titleId} className="text-base font-semibold text-ink">
        {t(`sensors.role.${state.role}`)}
      </h3>
      <dl className="mt-2 grid gap-x-6 text-sm leading-relaxed sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
        {rows.map((row) => (
          <Fragment key={row.label}>
            <dt className="pt-1.5 text-ink-soft sm:pt-1">{row.label}</dt>
            <dd className="tnum text-ink [overflow-wrap:anywhere] sm:pt-1">{row.value}</dd>
          </Fragment>
        ))}
      </dl>
    </section>
  );
}

/** One rate write + readback in words, with the code the sensor reported. */
function rateOutcome(t: Translate, result: SampleRateResult): string {
  const attempts = result.attempts;
  if (result.confirmed && result.readbackCode !== null) {
    return t("flow.readout.readbackConfirmed", { code: hexCode(result.readbackCode), attempts });
  }
  return t("flow.readout.readbackNotConfirmed", {
    reason: t(`flow.sensors.rateReason.${result.failure ?? "unknown"}`),
    code: result.readbackCode === null ? t("flow.readout.codeNone") : hexCode(result.readbackCode),
    attempts,
  });
}
