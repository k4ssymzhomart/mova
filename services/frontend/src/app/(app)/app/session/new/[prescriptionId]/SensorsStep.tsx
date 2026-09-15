"use client";

// The live part of the sensors step (НТЗ AC-03): the three sensors connected one by one over Web Bluetooth, then
// «Далее». «Далее» opens only when all three are streaming over the real transport. With the mock on it stays
// disabled and says why next to it: a simulated sensor must never start a real session. An unconfirmed sample rate
// does not block. The row shows it and the session records it; the delivered rate is the figure that counts.
//
// The rate the sensors are asked for comes from the page (`?rate=`, 50 Hz unless 100) and is handed to the sensor
// store before anything connects; the store writes it on every connect and reconnect. The closed «Технические
// данные» block under the button holds the numbers the hardware test protocol is read from.
//
// The page renders this step only for a Heel Slide prescription (page.tsx); every other exercise keeps the
// placeholder there, so no session is opened for an exercise this path cannot finish.
//
// «Далее» opens the session (start_prescribed_session, which creates a row on every call and aborts this patient's
// earlier unfinished session for the same prescription, so a second press is ignored while the first is under way)
// with the sensors' descriptors, then goes straight to the exercise. The calibration step keeps its place in the
// flow but is not on this path: calibration does not exist yet, and the exercise zeroes itself on the leg held
// straight.

import { ArrowRight, Info, LoaderCircle, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { primaryButton } from "@/components/app/recipes";
import { sensorDeviceInfo } from "@/components/flow/heelSlideRecords";
import SensorConnectPanel, { type SavedDeviceRow } from "@/components/flow/SensorConnectPanel";
import SensorTechnicalReadout from "@/components/flow/SensorTechnicalReadout";
import { stepHref } from "@/components/flow/steps";
import { getSnapshot, setRequestedRate, useLiveSensors } from "@/lib/ble/liveSensors";
import type { SupportedRateHz } from "@/lib/ble/witRegister";
import { useSensorStatus } from "@/lib/sensors/useSensorStatus";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/locales/client";

export default function SensorsStep({
  prescriptionId,
  patientId,
  side,
  savedDevices,
  requestedHz,
}: {
  prescriptionId: string;
  patientId: string;
  side: "left" | "right" | null;
  savedDevices: readonly SavedDeviceRow[];
  requestedHz: SupportedRateHz;
}) {
  const snapshot = useSensorStatus();
  const live = useLiveSensors();
  const router = useRouter();
  const { t } = useTranslation();
  const reasonId = useId();
  const startingRef = useRef(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<"inactive" | "failed" | null>(null);

  // Before any click can connect a sensor. Sensors already connected are set again only if the rate changed.
  useEffect(() => {
    setRequestedRate(requestedHz);
  }, [requestedHz]);

  const ready = snapshot.source === "ble" && live.allStreaming;
  const reason = ready
    ? null
    : snapshot.source === "mock"
      ? t("flow.sensors.blockedMock")
      : live.supported === false
        ? t("flow.sensors.blockedUnsupported")
        : t("flow.sensors.blockedNotReady");

  async function start() {
    if (!ready || startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setStartError(null);

    let sessionId: string | null = null;
    let inactive = false;
    try {
      const { data, error } = await createClient().rpc("start_prescribed_session", {
        p_prescription: prescriptionId,
        p_device_info: sensorDeviceInfo(getSnapshot()),
      });
      const id = (data as { id?: unknown } | null)?.id;
      if (!error && typeof id === "string") sessionId = id;
      // 55000: the prescription or its program is no longer active.
      inactive = error?.code === "55000";
    } catch {
      sessionId = null;
    }

    if (!sessionId) {
      setStartError(inactive ? "inactive" : "failed");
      startingRef.current = false;
      setStarting(false);
      return;
    }
    // The button stays disabled while the exercise opens.
    router.push(stepHref(sessionId, "exercise"));
  }

  return (
    <div className="space-y-5">
      <SensorConnectPanel patientId={patientId} side={side} savedDevices={savedDevices} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
        <button
          type="button"
          onClick={start}
          disabled={!ready || starting}
          aria-describedby={reason ? reasonId : undefined}
          className={primaryButton}
        >
          {starting ? t("flow.sensors.starting") : t("flow.next")}
          {starting ? (
            <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden="true" />
          ) : (
            <ArrowRight className="size-5" strokeWidth={2} aria-hidden="true" />
          )}
        </button>
        {reason && (
          <p id={reasonId} className="flex items-start gap-2 text-base leading-relaxed text-ink-soft">
            <Info className="mt-0.5 size-5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
            {reason}
          </p>
        )}
        {startError && (
          <p role="alert" className="flex items-start gap-2 text-base leading-relaxed text-red-800">
            <TriangleAlert className="mt-0.5 size-5 shrink-0" strokeWidth={2} aria-hidden="true" />
            {startError === "inactive" ? t("flow.sensors.startInactive") : t("flow.sensors.startFailed")}
          </p>
        )}
      </div>
      <SensorTechnicalReadout />
    </div>
  );
}
