"use client";

// The three sensor statuses shown before an exercise can start (НТЗ AC-03): one row per role, each with an
// icon and a status word, never colour alone. Also exports the compact strip used on later steps, where each role
// says «Симуляция» while the sensors are the development simulation.

import {
  BluetoothOff,
  CircleCheck,
  CircleDashed,
  CircleX,
  LoaderCircle,
  type LucideIcon,
} from "lucide-react";

import { card } from "@/components/app/recipes";
import { SENSOR_ROLES, type SensorLink, type SensorStatusSnapshot } from "@/lib/sensors/types";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/locales/client";

const LINK_ICON: Record<SensorLink, { icon: LucideIcon; className: string }> = {
  streaming: { icon: CircleCheck, className: "text-signal-deep" },
  connecting: { icon: LoaderCircle, className: "animate-spin text-ink-soft motion-reduce:animate-none" },
  disconnected: { icon: CircleDashed, className: "text-ink-soft" },
  lost: { icon: CircleX, className: "text-red-700" },
  unsupported: { icon: BluetoothOff, className: "text-amber-700" },
};

/** The per-role mark for a simulated sensor: a word in an amber outline, not colour alone. */
export function SimulatedMark() {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center rounded-pill border-2 border-amber-700 bg-amber-50 px-2 text-sm font-semibold text-ink">
      {t("sensors.simulatedRow")}
    </span>
  );
}

export function SensorLinkIcon({ link, className }: { link: SensorLink; className?: string }) {
  const { icon: Icon, className: tone } = LINK_ICON[link];
  return <Icon className={cn("shrink-0", tone, className)} strokeWidth={2} aria-hidden="true" />;
}

export default function SensorStatusRows({ snapshot }: { snapshot: SensorStatusSnapshot }) {
  const { t } = useTranslation();
  return (
    <div className={card}>
      <ul className="divide-y divide-line">
        {SENSOR_ROLES.map((role) => {
          const sensor = snapshot.sensors[role];
          return (
            <li key={role} className="flex items-center gap-4 px-5 py-4">
              <SensorLinkIcon link={sensor.link} className="size-7" />
              <div className="min-w-0 flex-1">
                <div className="text-lg font-semibold text-ink">{t(`sensors.role.${role}`)}</div>
                <div className="text-base text-ink-soft">{t(`sensors.link.${sensor.link}`)}</div>
              </div>
              {sensor.batteryPct != null && (
                <div className="tnum text-base text-ink-soft">{t("sensors.battery", { n: sensor.batteryPct })}</div>
              )}
            </li>
          );
        })}
      </ul>
      <p role="status" className="border-t border-line px-5 py-4 text-base font-semibold text-ink">
        {snapshot.allStreaming ? t("sensors.allReady") : t("sensors.notReady")}
      </p>
    </div>
  );
}

export function SensorStatusStrip({ snapshot }: { snapshot: SensorStatusSnapshot }) {
  const { t } = useTranslation();
  return (
    <ul aria-label={t("sensors.title")} className="flex flex-wrap gap-2">
      {SENSOR_ROLES.map((role) => {
        const sensor = snapshot.sensors[role];
        return (
          <li
            key={role}
            className="inline-flex min-h-10 items-center gap-2 rounded-pill border border-line bg-card px-3 text-sm"
          >
            <SensorLinkIcon link={sensor.link} className="size-4" />
            <span className="font-semibold text-ink">{t(`sensors.role.${role}`)}</span>
            <span className="text-ink-soft">{t(`sensors.link.${sensor.link}`)}</span>
            {snapshot.source === "simulated" && <SimulatedMark />}
          </li>
        );
      })}
    </ul>
  );
}
