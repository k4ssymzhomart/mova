// Step 2 of the exercise flow (Калибровка). Holds the step's place until calibration exists. The frame above
// already shows the three sensor statuses on this step.

import { Crosshair } from "lucide-react";
import type { Metadata } from "next";

import { stepHref } from "@/components/flow/steps";
import { getTranslation } from "@/locales/server";

import FlowUnavailable from "../../_flow/FlowUnavailable";
import { loadFlowSession } from "../../_flow/load";
import StepPending from "../../_flow/StepPending";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = getTranslation();
  return { title: `${t("flow.steps.calibrate")} · Mova` };
}

export default async function CalibrateStep({ params }: { params: { id: string } }) {
  const { t } = getTranslation();
  const session = await loadFlowSession(params.id);
  if (session.kind !== "ok") {
    return (
      <FlowUnavailable
        eyebrow={t("flow.steps.calibrate")}
        reason={session.kind === "error" ? "loadError" : "sessionNotFound"}
      />
    );
  }

  // TODO(#17): the calibration procedure and its maths replace this placeholder.
  // TODO(#21): calibration reads live frames from the sensor transport.
  // TODO(#17): replace the link onward with the calibration gate: move on only once calibration has succeeded.
  return (
    <StepPending
      step="calibrate"
      icon={Crosshair}
      exerciseName={session.value.exerciseName}
      nextStep="exercise"
      nextHref={stepHref(session.value.id, "exercise")}
    />
  );
}
