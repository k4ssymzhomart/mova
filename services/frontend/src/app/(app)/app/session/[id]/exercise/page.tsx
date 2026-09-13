// Step 3 of the exercise flow (Упражнение). Holds the step's place until the session screen exists. The frame
// above already shows the three sensor statuses on this step.

import { Activity } from "lucide-react";
import type { Metadata } from "next";

import { stepHref } from "@/components/flow/steps";
import { getTranslation } from "@/locales/server";

import FlowUnavailable from "../../_flow/FlowUnavailable";
import { loadFlowSession } from "../../_flow/load";
import StepPending from "../../_flow/StepPending";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = getTranslation();
  return { title: `${t("flow.steps.exercise")} · Mova` };
}

export default async function ExerciseStep({ params }: { params: { id: string } }) {
  const { t } = getTranslation();
  const session = await loadFlowSession(params.id);
  if (session.kind !== "ok") {
    return (
      <FlowUnavailable
        eyebrow={t("flow.steps.exercise")}
        reason={session.kind === "error" ? "loadError" : "sessionNotFound"}
      />
    );
  }

  // TODO(#22): the session screen (demonstration video, repetition counter, live cue, ghost guide) replaces this
  // placeholder, and its end of exercise replaces the link onward.
  return (
    <StepPending
      step="exercise"
      icon={Activity}
      exerciseName={session.value.exerciseName}
      nextStep="checkIn"
      nextHref={stepHref(session.value.id, "checkIn")}
    />
  );
}
