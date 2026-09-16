"use client";

// SensorConnectPanel — connecting the three sensors over Web Bluetooth, one row per role, each with its own
// «Подключить»: the browser opens the device chooser only from a click, and one device per click. Binding is
// explicit. The patient picks the thigh sensor on the thigh row, and a device already bound to another role is
// refused (lib/ble/liveSensors), never moved over silently.
//
// Each row reports what the transport knows and nothing more: the link (a dropped link the store is bringing back on
// its own reads «Переподключение…», with the attempts so far), the advertised device name, whether the sensor
// confirmed the requested rate when it was read back, the rate actually delivered, measured from received frames,
// and a short battery percent from WitMotion's voltage table, only while the latest battery read succeeded. The full
// numbers are in SensorTechnicalReadout. Used on the sensors step and, when a sensor stops streaming, in place on the
// exercise step.
//
// The rate confirmation is current only while the sensor streams. The rate lives in the sensor's RAM, so while the
// link is down or silent the row shows the last check with its time and says it may have changed (sensorReadout
// rateView), and the store checks again after a reconnect.
//
// With the development simulation on (lib/ble/simulation.ts), each row is marked «Симуляция», a press connects the
// role's simulated sensor without the chooser, and the rate lines say the readback came from the simulation, not from
// a sensor.
//
// A row's errors (a refused device, a failed or dropped connection) appear after the chooser has closed, so each row
// keeps a live region that announces them, and the row's button is described by the error while it shows. A press
// on a dropped sensor first tries the same sensor again, taking over an automatic attempt that may be running; the
// row says so in its own status region while that try runs, and the button stays disabled until the press settles.
//
// What a session stores about its sensors (device_info, the summary) is in heelSlideRecords.ts.

import { RefreshCw, TriangleAlert } from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";

import { bodyText, card, cardTitle, primaryButton, secondaryButton } from "@/components/app/recipes";
import {
  bindingsFromDeviceRows,
  connectRole,
  reconfigureRate,
  useLiveSensors,
  type LiveRoleState,
  type LiveSensorErrorInfo,
} from "@/lib/ble/liveSensors";
import { SENSOR_ROLE_ORDER } from "@/lib/ble/roles";
import { SIMULATION_ENABLED } from "@/lib/ble/simulation";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/locales/client";

import { formatClockTime, formatNumber, linkLabelKey, rateView, shortBatteryPercent } from "./sensorReadout";
import { SensorLinkIcon, SimulatedMark } from "./SensorStatusRows";

type Translate = ReturnType<typeof useTranslation>["t"];

/** A patient_ble_devices row as the page loaded it. `role` is the lateralized body site (r_thigh, …). */
export interface SavedDeviceRow {
  role: string;
  device_id: string;
  device_name: string | null;
}

export default function SensorConnectPanel({
  patientId,
  side,
  savedDevices,
}: {
  patientId: string | null;
  side: "left" | "right" | null;
  savedDevices: readonly SavedDeviceRow[];
}) {
  const live = useLiveSensors();
  const { t } = useTranslation();
  const savedBindings = useMemo(() => bindingsFromDeviceRows(savedDevices), [savedDevices]);

  if (live.supported === false) {
    return (
      <div role="note" className={cn(card, "flex items-start gap-4 px-5 py-5")}>
        <SensorLinkIcon link="unsupported" className="mt-0.5 size-7" />
        <div className="min-w-0">
          <h2 className={cardTitle}>{t("flow.sensors.unsupportedTitle")}</h2>
          <p className={cn("mt-2", bodyText)}>{t("flow.sensors.unsupportedBody")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={card}>
      <ul className="divide-y divide-line">
        {SENSOR_ROLE_ORDER.map((role) => (
          <SensorRow
            key={role}
            state={live.roles[role]}
            // The device this role was saved with on this leg, as a hint for picking it in the chooser.
            savedName={
              savedBindings.find((binding) => binding.role === role && binding.side === side)?.deviceName ?? null
            }
            // Errors land on the role's state and show in its row; a closed chooser is not an error.
            onConnect={() => connectRole(role, { patientId, side, savedBindings }).then(noop, noop)}
          />
        ))}
      </ul>
      <p role="status" className="border-t border-line px-5 py-4 text-base font-semibold text-ink">
        {live.allStreaming ? t("sensors.allReady") : t("sensors.notReady")}
      </p>
    </div>
  );
}

function noop(): void {}

function SensorRow({
  state,
  savedName,
  onConnect,
}: {
  state: LiveRoleState;
  savedName: string | null;
  onConnect: () => Promise<void>;
}) {
  const { t, locale } = useTranslation();
  const titleId = useId();
  const connectId = useId();
  const retryId = useId();
  const errorId = useId();
  const pressId = useId();
  // Covers the chooser and the GATT connection (or a pressed same-device reconnect). After that the link state
  // takes over, and the button is open again so a sensor that connected but never sends data can be picked afresh.
  const [pending, setPending] = useState(false);

  async function connect() {
    if (pending) return;
    setPending(true);
    try {
      await onConnect();
    } finally {
      setPending(false);
    }
  }

  const { role, link, rate, reconnect } = state;
  const hz = (value: number) => formatNumber(locale, value, 1);
  const attached = state.deviceId !== null && link !== "disconnected" && link !== "unsupported";
  const rateUnconfirmed = rate.status === "done" && !rate.result.confirmed;
  const error = state.lastError ? errorText(t, state.lastError, reconnect.state === "reconnecting") : null;
  const batteryPercent = attached ? shortBatteryPercent(state) : null;
  // The store's press outlives this row when the exercise screen closes and reopens the panel mid-press.
  const pressing = pending || state.press !== null;
  const sameDeviceTry = state.press === "same_device";
  // Lines about what the sensor reported name the simulation instead when it stands in for the sensors.
  const says = SIMULATION_ENABLED ? "flow.sensors.simulated" : "flow.sensors";

  let device: string | null = null;
  if (state.deviceId !== null) {
    device = state.deviceName ? t("flow.sensors.device", { name: state.deviceName }) : t("flow.sensors.deviceUnnamed");
  } else if (savedName) {
    device = t("flow.sensors.lastDevice", { name: savedName });
  }

  let rateLine: string | null = null;
  const rateNow = attached ? rateView(state) : null;
  if (rateNow?.kind === "configuring") {
    rateLine = t("flow.sensors.rateConfiguring", { hz: hz(rateNow.requestedHz) });
  } else if (rateNow?.kind === "current" || rateNow?.kind === "last") {
    const { result } = rateNow;
    const reason = t(`flow.sensors.rateReason.${result.failure ?? "unknown"}`);
    if (rateNow.kind === "current") {
      rateLine = result.confirmed
        ? t(`${says}.rateConfirmed`, { hz: hz(result.requestedHz) })
        : t(`${says}.rateNotConfirmed`, { hz: hz(result.requestedHz), reason });
    } else {
      const time = formatClockTime(locale, rateNow.atMs);
      rateLine = result.confirmed
        ? t(`${says}.rateLastConfirmed`, { time, hz: hz(result.requestedHz) })
        : t(`${says}.rateLastNotConfirmed`, { time, hz: hz(result.requestedHz), reason });
    }
  }

  let delivered: string | null = null;
  if (state.deliveredHz !== null) delivered = t(`${says}.delivered`, { hz: hz(state.deliveredHz) });
  else if (link === "streaming") delivered = t("flow.sensors.deliveredMeasuring");

  let reconnectLine: string | null = null;
  if (reconnect.state === "reconnecting" && reconnect.attempts > 0) {
    reconnectLine = t("flow.sensors.reconnectAttempts", { n: formatNumber(locale, reconnect.attempts) });
  } else if (reconnect.state === "gave_up" && link === "lost") {
    reconnectLine = t("flow.sensors.reconnectGaveUp");
  }

  let persistence: string | null = null;
  if (attached) {
    const saved = state.persistence;
    if (saved.status === "saved") persistence = t("flow.sensors.persistence.saved");
    else if (saved.status === "session_only") persistence = t(`flow.sensors.persistence.${saved.reason}`);
    else if (saved.status === "failed") persistence = t("flow.sensors.persistence.failed");
  }

  return (
    <li className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-4">
        <SensorLinkIcon link={link} className="mt-0.5 size-7" />
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <div id={titleId} className="text-lg font-semibold text-ink">
              {t(`sensors.role.${role}`)}
            </div>
            {SIMULATION_ENABLED && <SimulatedMark />}
            {batteryPercent !== null && (
              <span className="tnum text-base text-ink-soft">
                <span aria-hidden="true">{t("flow.sensors.batteryShort", { n: formatNumber(locale, batteryPercent) })}</span>
                <span className="sr-only">
                  {t("flow.sensors.batteryShortSr", { n: formatNumber(locale, batteryPercent) })}
                </span>
              </span>
            )}
          </div>
          <div className="text-base text-ink-soft">{t(linkLabelKey(state))}</div>
          {device && <Detail>{device}</Detail>}
          {reconnectLine && <Detail>{reconnectLine}</Detail>}
          {rateLine && <Detail>{rateLine}</Detail>}
          {delivered && <Detail>{delivered}</Detail>}
          {persistence && <Detail>{persistence}</Detail>}
          {/* Always in the DOM, so a press that takes over a running reconnect attempt is announced. */}
          <div id={pressId} role="status" aria-atomic="true">
            {sameDeviceTry && <Detail>{t("flow.sensors.pressSameDevice")}</Detail>}
          </div>
          {/* Always in the DOM, so a message that appears after the chooser closes is announced. */}
          <div id={errorId} role="alert" aria-atomic="true">
            {error && (
              <p key={state.lastError?.at} className="flex items-start gap-2 pt-1 text-base text-red-800">
                <TriangleAlert className="mt-0.5 size-5 shrink-0" strokeWidth={2} aria-hidden="true" />
                {error}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-2 sm:items-end">
        <button
          id={connectId}
          type="button"
          onClick={connect}
          disabled={pressing || link === "unsupported"}
          aria-labelledby={`${connectId} ${titleId}`}
          aria-describedby={sameDeviceTry ? pressId : error ? errorId : undefined}
          className={cn(link === "streaming" ? secondaryButton : primaryButton, "w-full sm:w-auto")}
        >
          {sameDeviceTry
            ? t("flow.sensors.connectPendingSameDevice")
            : pressing
              ? t("flow.sensors.connectPending")
              : state.deviceId !== null
                ? t("flow.sensors.reconnect")
                : t("flow.sensors.connect")}
        </button>
        {rateUnconfirmed && link === "streaming" && (
          <button
            id={retryId}
            type="button"
            onClick={() => void reconfigureRate(role)}
            aria-labelledby={`${retryId} ${titleId}`}
            className={cn(secondaryButton, "w-full sm:w-auto")}
          >
            <RefreshCw className="size-5" strokeWidth={2} aria-hidden="true" />
            {t("flow.sensors.rateRetry")}
          </button>
        )}
      </div>
    </li>
  );
}

function Detail({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-relaxed text-ink-soft [overflow-wrap:anywhere]">{children}</p>;
}

/**
 * Patient wording for the errors a row can carry. Codes that need no message (busy, cancelled) return null. A drop
 * the store is still bringing back says so instead of asking the patient to reconnect.
 */
function errorText(t: Translate, error: LiveSensorErrorInfo, reconnecting: boolean): string | null {
  const otherRole = error.otherRole ? t(`sensors.role.${error.otherRole}`) : "";
  switch (error.code) {
    case "request_failed":
      return t("flow.sensors.error.requestFailed");
    case "device_bound_to_other_role":
      return t("flow.sensors.error.boundToOtherRole", { role: otherRole });
    case "device_saved_for_other_role":
      return t("flow.sensors.error.savedForOtherRole", { role: otherRole });
    case "connect_failed":
      return t("flow.sensors.error.connectFailed");
    case "connection_dropped":
      return reconnecting ? t("flow.sensors.error.droppedReconnecting") : t("flow.sensors.error.connectionDropped");
    default:
      return null;
  }
}
