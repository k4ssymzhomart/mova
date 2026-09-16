"use client";

// Shown on every step of the exercise flow while the development simulation stands in for the sensors
// (lib/ble/simulation.ts: `next dev` with NEXT_PUBLIC_SENSOR_SIMULATION=1). It cannot be dismissed: the movement and
// the reps on screen are made by the program, and nobody watching may take them for sensor data. It keys on the flag
// rather than the snapshot source, so it also shows before anything is connected and when the mock, which takes over
// the source, is on as well.

import { TriangleAlert } from "lucide-react";

import { SIMULATION_ENABLED } from "@/lib/ble/simulation";
import { useTranslation } from "@/locales/client";

export default function SimulatedSensorBanner() {
  const { t } = useTranslation();
  if (!SIMULATION_ENABLED) return null;

  return (
    <div role="note" className="rounded-card border-2 border-amber-700 bg-amber-50 px-4 py-3">
      <p className="flex items-center gap-2 text-base font-semibold text-ink">
        <TriangleAlert className="size-5 shrink-0 text-amber-700" strokeWidth={2} aria-hidden="true" />
        {t("sensors.simulatedBanner")}
      </p>
    </div>
  );
}
