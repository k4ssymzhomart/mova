// Step 1 of the exercise flow (Датчики). Loads the prescription the patient started from Today, then hands the
// sensor check to SensorsStep. There is no session row yet, and none is created here: a session starts only once
// three real sensors are streaming.

import type { Metadata } from "next";

import PageHeader from "@/components/app/PageHeader";
import { getTranslation } from "@/locales/server";

import FlowUnavailable from "../../_flow/FlowUnavailable";
import { loadActivePrescription } from "../../_flow/load";
import SensorsStep from "./SensorsStep";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = getTranslation();
  return { title: `${t("flow.steps.sensors")} · Mova` };
}

export default async function SensorsStepPage({ params }: { params: { prescriptionId: string } }) {
  const { t } = getTranslation();
  const prescription = await loadActivePrescription(params.prescriptionId);
  if (prescription.kind !== "ok") {
    return (
      <FlowUnavailable
        eyebrow={t("flow.steps.sensors")}
        reason={prescription.kind === "error" ? "loadError" : "prescriptionNotFound"}
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
      {/* TODO(#22): pass prescription.value.id to SensorsStep once it creates the session row. */}
      <SensorsStep />
    </div>
  );
}
