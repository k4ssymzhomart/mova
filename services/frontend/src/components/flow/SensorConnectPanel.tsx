"use client";

// SensorConnectPanel — connecting the three sensors over Web Bluetooth, one row per role, each with its own
// «Подключить»: the browser opens the device chooser only from a click, and one device per click. Binding is
// explicit. The patient picks the thigh sensor on the thigh row, and a device already bound to another role is
// refused (lib/ble/liveSensors), never moved over silently.
//
// Each row reports what the transport knows and nothing more: the link, the advertised device name, whether the
// sensor confirmed the 50 Hz rate when it was read back, and the rate actually delivered, measured from received
// frames. There is no battery reading, because the data frame carries none. Used on the sensors step and, after a
// reload dropped the connections, in place on the exercise step.
//
// Also exports the descriptors a session stores about its sensors (device_info, and the rate part of the
// summary), so both steps write them in one shape.

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
  type LiveSensorsSnapshot,
  type RateState,
} from "@/lib/ble/liveSensors";
import { SENSOR_ROLE_ORDER, type SensorRole } from "@/lib/ble/roles";
import { cn } from "@/lib/utils";
import type { Locale } from "@/locales";
import { useTranslation } from "@/locales/client";

import { SensorLinkIcon } from "./SensorStatusRows";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** A patient_ble_devices row as the page loaded it. `role` is the lateralized body site (r_thigh, …). */
export interface SavedDeviceRow {
  role: string;
  device_id: string;
  device_name: string | null;
}

// — what a session stores about its sensors ——————————————————————————————————————

/** The model printed on the sensors has not been checked against the datasheet yet (hardware checklist). */
export const SENSOR_MODEL_LABEL = "WT901BLE68 (unverified)";

/** One role's rate write and readback, as stored in sessions.device_info and the session summary. */
export interface RateRecord {
  status: "not_started" | "configuring" | "done";
  requested_hz: number | null;
  requested_code: number | null;
  /** What the sensor reported from its rate register; null when it never answered or was not asked yet. */
  readback_code: number | null;
  /** null while unknown (not configured yet, or still configuring). */
  confirmed: boolean | null;
  attempts: number | null;
  failure: "no_reply" | "mismatch" | "write_failed" | null;
}

export function rateRecord(rate: RateState): RateRecord {
  if (rate.status === "done") {
    const result = rate.result;
    return {
      status: "done",
      requested_hz: result.requestedHz,
      requested_code: result.requestedCode,
      readback_code: result.readbackCode,
      confirmed: result.confirmed,
      attempts: result.attempts,
      failure: result.failure,
    };
  }
  return {
    status: rate.status === "configuring" ? "configuring" : "not_started",
    requested_hz: rate.status === "configuring" ? rate.requestedHz : null,
    requested_code: null,
    readback_code: null,
    confirmed: null,
    attempts: null,
    failure: null,
  };
}

export interface SensorRoleRecord {
  device_id: string | null;
  device_name: string | null;
  rate: RateRecord;
  /** Measured from received frames when the record was taken; null while unknown. */
  delivered_hz: number | null;
}

export interface SensorDeviceInfo {
  transport: "web-bluetooth";
  model_label: string;
  roles: Record<SensorRole, SensorRoleRecord>;
}

/** sessions.device_info for a session opened with the sensors in this snapshot. Hardware descriptors only. */
export function sensorDeviceInfo(snapshot: LiveSensorsSnapshot): SensorDeviceInfo {
  const roles = {} as Record<SensorRole, SensorRoleRecord>;
  for (const role of SENSOR_ROLE_ORDER) {
    const state = snapshot.roles[role];
    roles[role] = {
      device_id: state.deviceId,
      device_name: state.deviceName,
      rate: rateRecord(state.rate),
      delivered_hz: state.deliveredHz,
    };
  }
  return { transport: "web-bluetooth", model_label: SENSOR_MODEL_LABEL, roles };
}

const INTL_LOCALE: Record<Locale, string> = { ru: "ru-RU", kk: "kk-KZ", en: "en-GB" };

/** A number in the patient's locale, at most `fractionDigits` decimals. */
export function formatNumber(locale: Locale, value: number, fractionDigits = 0): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale], { maximumFractionDigits: fractionDigits }).format(value);
}

// — the panel ————————————————————————————————————————————————————————————————————

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
  // Covers the chooser and the GATT connection. After that the link state takes over, and the button is open
  // again so a sensor that connected but never sends data can be picked afresh.
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

  const { role, link, rate } = state;
  const hz = (value: number) => formatNumber(locale, value, 1);
  const attached = state.deviceId !== null && link !== "disconnected" && link !== "unsupported";
  const rateUnconfirmed = rate.status === "done" && !rate.result.confirmed;
  const error = state.lastError ? errorText(t, state.lastError) : null;

  let device: string | null = null;
  if (state.deviceId !== null) {
    device = state.deviceName ? t("flow.sensors.device", { name: state.deviceName }) : t("flow.sensors.deviceUnnamed");
  } else if (savedName) {
    device = t("flow.sensors.lastDevice", { name: savedName });
  }

  let rateLine: string | null = null;
  if (attached && rate.status === "configuring") {
    rateLine = t("flow.sensors.rateConfiguring", { hz: hz(rate.requestedHz) });
  } else if (attached && rate.status === "done") {
    rateLine = rate.result.confirmed
      ? t("flow.sensors.rateConfirmed", { hz: hz(rate.result.requestedHz) })
      : t("flow.sensors.rateNotConfirmed", {
          hz: hz(rate.result.requestedHz),
          reason: t(`flow.sensors.rateReason.${rate.result.failure ?? "unknown"}`),
        });
  }

  let delivered: string | null = null;
  if (state.deliveredHz !== null) delivered = t("flow.sensors.delivered", { hz: hz(state.deliveredHz) });
  else if (link === "streaming") delivered = t("flow.sensors.deliveredMeasuring");

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
          <div id={titleId} className="text-lg font-semibold text-ink">
            {t(`sensors.role.${role}`)}
          </div>
          <div className="text-base text-ink-soft">{t(`sensors.link.${link}`)}</div>
          {device && <Detail>{device}</Detail>}
          {rateLine && <Detail>{rateLine}</Detail>}
          {delivered && <Detail>{delivered}</Detail>}
          {persistence && <Detail>{persistence}</Detail>}
          {error && (
            <p className="flex items-start gap-2 pt-1 text-base text-red-800">
              <TriangleAlert className="mt-0.5 size-5 shrink-0" strokeWidth={2} aria-hidden="true" />
              {error}
            </p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-2 sm:items-end">
        <button
          id={connectId}
          type="button"
          onClick={connect}
          disabled={pending || link === "unsupported"}
          aria-labelledby={`${connectId} ${titleId}`}
          className={cn(link === "streaming" ? secondaryButton : primaryButton, "w-full sm:w-auto")}
        >
          {pending
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

/** Patient wording for the errors a row can carry. Codes that need no message (busy, cancelled) return null. */
function errorText(t: Translate, error: LiveSensorErrorInfo): string | null {
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
      return t("flow.sensors.error.connectionDropped");
    default:
      return null;
  }
}
