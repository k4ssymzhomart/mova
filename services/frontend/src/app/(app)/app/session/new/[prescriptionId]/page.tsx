// Step 1 of the exercise flow (Датчики). Loads the prescription the patient started from Today and what connecting
// sensors needs (the patient, the side bindings are saved under, the saved bindings), then hands over to
// SensorsStep. There is no session row yet: SensorsStep creates it once three real sensors are streaming (or, on
// `next dev` with NEXT_PUBLIC_SENSOR_SIMULATION=1, three simulated ones, and the session is stamped as simulated).
//
// Only Heel Slide runs on this path. For any other exercise the step stays the honest placeholder it was before:
// no sensor panel, nothing connected or saved, and no session opened, because nothing after this step could finish
// one.
//
// `?rate=100` asks the sensors for 100 Hz, for the hardware checks; `?rate=50`, no parameter or anything else asks
// for 50 Hz (lib/ble/sampleRate requestedRateFromParam). Only those two rates are ever written to a sensor.

import type { Metadata } from "next";

import PageHeader from "@/components/app/PageHeader";
import { requestedRateFromParam } from "@/lib/ble/sampleRate";
import { visionJointFor } from "@/lib/exercises/visionJoint";
import { getTranslation } from "@/locales/server";

import FlowUnavailable from "../../_flow/FlowUnavailable";
import { loadActivePrescription, loadSensorContext } from "../../_flow/load";
import { loadPrescriptionExerciseSlug } from "./load";
import SensorsStep from "./SensorsStep";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = getTranslation();
  return { title: `${t("flow.steps.sensors")} · Mova` };
}

export default async function SensorsStepPage({
  params,
  searchParams,
}: {
  params: { prescriptionId: string };
  searchParams: { rate?: string | string[] };
}) {
  const { t } = getTranslation();
  const [prescription, sensors] = await Promise.all([
    loadActivePrescription(params.prescriptionId),
    loadSensorContext(),
  ]);
  if (prescription.kind !== "ok") {
    return (
      <FlowUnavailable
        eyebrow={t("flow.steps.sensors")}
        reason={prescription.kind === "error" ? "loadError" : "prescriptionNotFound"}
      />
    );
  }
  if (sensors.kind !== "ok") {
    return (
      <FlowUnavailable
        eyebrow={t("flow.steps.sensors")}
        reason={sensors.kind === "error" ? "loadError" : "prescriptionNotFound"}
      />
    );
  }

  const exercise = await loadPrescriptionExerciseSlug(prescription.value.id, sensors.value.patientId);
  if (exercise.kind !== "ok") {
    return (
      <FlowUnavailable
        eyebrow={t("flow.steps.sensors")}
        reason={exercise.kind === "error" ? "loadError" : "prescriptionNotFound"}
      />
    );
  }

  const title = prescription.value.exerciseName ?? t("flow.untitledExercise");
  // Every prescribed exercise opens a session here now, not only Heel Slide. The step that used to refuse them is
  // gone because the exercise screen can run them: Heel Slide keeps its own screen, and everything else runs on
  // components/flow/ExerciseRunner. An exercise the camera can also measure offers a second way out of this step,
  // so a patient with no sensors is not stopped at the door.
  const cameraAvailable = visionJointFor(exercise.value) !== null;

  return (
    <div className="space-y-8">
      <PageHeader eyebrow={t("flow.steps.sensors")} title={title} lead={t("flow.sensors.lead")} />
      <SensorsStep
        prescriptionId={prescription.value.id}
        patientId={sensors.value.patientId}
        side={sensors.value.side}
        savedDevices={sensors.value.savedDevices}
        requestedHz={requestedRateFromParam(searchParams.rate)}
        cameraAvailable={cameraAvailable}
      />
    </div>
  );
}
