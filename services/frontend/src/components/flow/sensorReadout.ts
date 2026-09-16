// Formatting for what the sensor panel and the technical readout show about a sensor. Pure, so the node tests pin
// it. Only types come from the BLE store.

import type { BatteryReading, LiveRoleState } from "@/lib/ble/liveSensors";
import type { SampleRateResult } from "@/lib/ble/sampleRate";
import type { Locale } from "@/locales";

const INTL_LOCALE: Record<Locale, string> = { ru: "ru-RU", kk: "kk-KZ", en: "en-GB" };

/** A number in the patient's locale, at most `fractionDigits` decimals. */
export function formatNumber(locale: Locale, value: number, fractionDigits = 0): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale], { maximumFractionDigits: fractionDigits }).format(value);
}

/** A clock time with seconds, e.g. 14:05:09. `timeZone` is for tests; the browser's own zone otherwise. */
export function formatClockTime(locale: Locale, atMs: number, timeZone?: string): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(atMs);
}

/** The locale key for a role's link: a link being brought back on its own reads as reconnecting, not connecting. */
export function linkLabelKey(state: Pick<LiveRoleState, "link" | "reconnect">): string {
  return state.reconnect.state === "reconnecting" ? "flow.sensors.reconnecting" : `sensors.link.${state.link}`;
}

const BATTERY_REASONS = new Set(["no_reply", "write_failed", "implausible_value"]);

/** The locale key naming why a battery read failed. */
export function batteryReasonKey(reason: string): string {
  return `flow.readout.batteryReason.${BATTERY_REASONS.has(reason) ? reason : "unknown"}`;
}

/** A register code the way the protocol writes it, e.g. 0x08. */
export function hexCode(code: number): string {
  return `0x${code.toString(16).toUpperCase().padStart(2, "0")}`;
}

/** Whole seconds in a duration, never negative. */
export function wholeSeconds(ms: number): number {
  return Math.max(0, Math.floor(ms / 1000));
}

/** Seconds until `atMs`, rounded up; null when nothing is planned. */
export function secondsUntil(atMs: number | null, nowMs: number): number | null {
  return atMs === null ? null : Math.max(0, Math.ceil((atMs - nowMs) / 1000));
}

/**
 * - reading: the latest read succeeded.
 * - failed: the latest read failed, so the level is unknown; the last successful reading, if any, is kept with its
 *   time so it is never shown as current.
 * - unread: nothing has been read yet.
 */
export type BatteryView =
  | { kind: "reading"; reading: BatteryReading }
  | { kind: "failed"; reason: string; lastReading: BatteryReading | null }
  | { kind: "unread" };

export function batteryView(state: Pick<LiveRoleState, "battery" | "batteryError">): BatteryView {
  if (state.batteryError !== null) return { kind: "failed", reason: state.batteryError, lastReading: state.battery };
  if (state.battery) return { kind: "reading", reading: state.battery };
  return { kind: "unread" };
}

/**
 * What can be said about a role's sample rate right now.
 *  - configuring: a write and readback is running.
 *  - current: the latest readback, while the sensor is streaming on the link it was read on.
 *  - last: the latest readback while the sensor is not streaming (reconnecting, lost, or not sending yet). The rate
 *    is held in the sensor's RAM only, so a unit that restarted meanwhile is back on its default rate: the result is
 *    shown as a past check with its time, never as a current confirmation.
 *  - none: nothing was read back, or the time of the last check is not known.
 */
export type RateView =
  | { kind: "none" }
  | { kind: "configuring"; requestedHz: number }
  | { kind: "current"; result: SampleRateResult }
  | { kind: "last"; result: SampleRateResult; atMs: number };

export function rateView(state: Pick<LiveRoleState, "link" | "rate" | "rateHistory">): RateView {
  const { rate } = state;
  if (rate.status === "configuring") return { kind: "configuring", requestedHz: rate.requestedHz };
  if (rate.status !== "done") return { kind: "none" };
  if (state.link === "streaming") return { kind: "current", result: rate.result };
  const atMs = state.rateHistory[state.rateHistory.length - 1]?.atMs;
  return typeof atMs === "number" ? { kind: "last", result: rate.result, atMs } : { kind: "none" };
}

/** The table percent shown next to a role: only while the latest read succeeded, whole percent. */
export function shortBatteryPercent(state: Pick<LiveRoleState, "battery" | "batteryError">): number | null {
  const view = batteryView(state);
  return view.kind === "reading" ? Math.round(view.reading.vendorPercent) : null;
}
