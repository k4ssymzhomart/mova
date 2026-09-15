// Step 1 of the exercise flow (Датчики). Loads the prescription the patient started from Today and what connecting
// sensors needs (the patient, the side bindings are saved under, the saved bindings), then hands over to
// SensorsStep. There is no session row yet: SensorsStep creates it once three real sensors are streaming.

import type { Metadata } from "next";

import PageHeader from "@/components/app/PageHeader";
import { getTranslation } from "@/locales/server";

import FlowUnavailable from "../../_flow/FlowUnavailable";
import { loadActivePrescription, loadSensorContext } from "../../_flow/load";
import SensorsStep from "./SensorsStep";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = getTranslation();
  return { title: `${t("flow.steps.sensors")} · Mova` };
}

export default async function SensorsStepPage({ params }: { params: { prescriptionId: string } }) {
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

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={t("flow.steps.sensors")}
        title={prescription.value.exerciseName ?? t("flow.untitledExercise")}
        lead={t("flow.sensors.lead")}
      />
      <SensorsStep
        prescriptionId={prescription.value.id}
        patientId={sensors.value.patientId}
        side={sensors.value.side}
        savedDevices={sensors.value.savedDevices}
      />
    </div>
  );
}
