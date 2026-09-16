"use client";

// SessionFlowFrame — the chrome around every step of the exercise flow:
// sensors → calibration → exercise → check-in → summary. It shows where the patient is, keeps a Stop control
// in reach on every step, and on the calibration and exercise steps shows the compact three-sensor strip.
// The steps' contents belong to their owners (#21 sensors, #17 calibration, #22 exercise and check-in,
// #23 scoring); this frame only holds their place. Earlier steps are shown as numbers, never as done: the frame
// only knows the URL, not whether calibration or the check-in actually happened.
//
// The frame lives in the /app/session layout, so it stays mounted from the sensors step to the summary and unmounts
// only when the patient leaves the flow (Stop, the app navigation, Back past the first step). Leaving disconnects
// the sensors: nothing outside the flow uses them, and left connected they would keep streaming and draining
// batteries on every other page.

import { OctagonX } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { card, focusRing } from "@/components/app/recipes";
import { disconnectAll } from "@/lib/ble/liveSensors";
import { useSensorStatus } from "@/lib/sensors/useSensorStatus";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/locales/client";

import MockSensorBanner from "./MockSensorBanner";
import SimulatedSensorBanner from "./SimulatedSensorBanner";
import { SensorStatusStrip } from "./SensorStatusRows";
import { FLOW_STEPS, flowLocation } from "./steps";

export default function SessionFlowFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const { step } = flowLocation(pathname);
  const sensors = useSensorStatus();
  const { t } = useTranslation();

  useEffect(() => () => disconnectAll(), []);

  const numbered = step && step !== "stop" ? step : null;
  const index = numbered ? FLOW_STEPS.indexOf(numbered) : -1;

  return (
    <div className="space-y-5">
      <div className={cn(card, "flex flex-wrap items-center justify-between gap-4 px-5 py-4")}>
        {numbered ? (
          <div className="min-w-0">
            <p className="text-sm font-medium uppercase tracking-[0.14em] text-signal-deep">
              {t("flow.stepOf", { n: index + 1, total: FLOW_STEPS.length })}
            </p>
            <ol aria-label={t("flow.stepsLabel")} className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
              {FLOW_STEPS.map((s, i) => {
                const current = i === index;
                return (
                  <li
                    key={s}
                    aria-current={current ? "step" : undefined}
                    className={cn(
                      "items-center gap-2 text-base",
                      current ? "flex font-semibold text-ink" : "hidden text-ink-soft sm:flex",
                    )}
                  >
                    <span
                      className={cn(
                        "tnum grid size-8 place-items-center rounded-full text-sm",
                        current ? "border-2 border-ink text-ink" : "border border-line text-ink-soft",
                      )}
                    >
                      {i + 1}
                    </span>
                    <span>{t(`flow.steps.${s}`)}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        ) : (
          <p className="text-sm font-medium uppercase tracking-[0.14em] text-ink-soft">{t("flow.title")}</p>
        )}

        {step !== "stop" && (
          // TODO(#22): record the stop, and its reason (НТЗ PAT-06), before leaving the flow.
          <Link
            href="/app"
            prefetch={false}
            className={cn(
              "inline-flex min-h-14 items-center gap-2 rounded-pill border-2 border-red-700 bg-card px-5 text-base font-semibold text-red-800 transition-colors hover:bg-red-50",
              focusRing,
            )}
          >
            <OctagonX className="size-5" strokeWidth={2} aria-hidden="true" />
            {t("safety.stop")}
          </Link>
        )}
      </div>

      <MockSensorBanner />
      <SimulatedSensorBanner />
      {(step === "calibrate" || step === "exercise") && <SensorStatusStrip snapshot={sensors} />}

      {children}
    </div>
  );
}
