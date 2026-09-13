"use client";

// The live part of the sensors step (НТЗ AC-03): three separate sensor statuses, then «Далее». «Далее» opens only
// when all three sensors are streaming over the real transport. With no transport yet, or with the mock, it stays
// disabled and says why next to it: a simulated sensor must never start a real session.

import { ArrowRight, Info } from "lucide-react";
import { useId } from "react";

import { primaryButton } from "@/components/app/recipes";
import SensorStatusRows from "@/components/flow/SensorStatusRows";
import { useSensorStatus } from "@/lib/sensors/useSensorStatus";
import { useTranslation } from "@/locales/client";

export default function SensorsStep() {
  const snapshot = useSensorStatus();
  const { t } = useTranslation();
  const reasonId = useId();

  const ready = snapshot.allStreaming && snapshot.source === "ble";
  const reason = ready
    ? null
    : snapshot.source === "mock"
      ? t("flow.sensors.blockedMock")
      : snapshot.source === "none"
        ? t("flow.sensors.blockedNoTransport")
        : t("flow.sensors.blockedNotReady");

  function start() {
    if (!ready) return;
    // TODO(#22): create the session row here for this prescription (with the device descriptors from #21), then
    // move the patient on with router.push(stepHref(session.id, "calibrate")). Until that exists nothing is
    // created, and nothing can reach this line: no transport reports "ble" yet (#21).
  }

  return (
    <div className="space-y-5">
      <SensorStatusRows snapshot={snapshot} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
        <button
          type="button"
          onClick={start}
          disabled={!ready}
          aria-describedby={reason ? reasonId : undefined}
          className={primaryButton}
        >
          {t("flow.next")}
          <ArrowRight className="size-5" strokeWidth={2} aria-hidden="true" />
        </button>
        {reason && (
          <p id={reasonId} className="flex items-start gap-2 text-base leading-relaxed text-ink-soft">
            <Info className="mt-0.5 size-5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
            {reason}
          </p>
        )}
      </div>
    </div>
  );
}
