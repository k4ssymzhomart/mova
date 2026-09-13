"use client";

// Shown whenever the sensor snapshot comes from the mock. It cannot be dismissed: a simulated sensor must never
// look like a real one. The buttons step each role through its states so reviewers can see every status.

import { TriangleAlert } from "lucide-react";

import { focusRing } from "@/components/app/recipes";
import { cycleMockSensor, useSensorStatus } from "@/lib/sensors/useSensorStatus";
import { SENSOR_ROLES } from "@/lib/sensors/types";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/locales/client";

export default function MockSensorBanner() {
  const snapshot = useSensorStatus();
  const { t } = useTranslation();
  if (snapshot.source !== "mock") return null;

  return (
    <div role="note" className="rounded-card border-2 border-amber-700 bg-amber-50 px-4 py-3">
      <p className="flex items-center gap-2 text-base font-semibold text-ink">
        <TriangleAlert className="size-5 shrink-0 text-amber-700" strokeWidth={2} aria-hidden="true" />
        {t("sensors.mockBanner")}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-sm text-ink-soft">{t("sensors.mockControls")}</span>
        {SENSOR_ROLES.map((role) => (
          <button
            key={role}
            type="button"
            onClick={() => cycleMockSensor(role)}
            className={cn(
              "min-h-12 rounded-pill border border-ink/30 bg-card px-3 text-sm font-medium text-ink hover:bg-paper-soft",
              focusRing,
            )}
          >
            {t(`sensors.role.${role}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
