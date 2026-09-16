// Step 3 of the exercise flow (Упражнение). Heel Slide runs here with real sensors (HeelSlideExercise), or with the
// development simulation's, which the flow frame announces and the session records as simulated. Any other
// exercise keeps the placeholder: this path covers one exercise. The frame above already shows the three sensor
// statuses on this step.
//
// Only a session in progress opens the exercise. A completed one goes on to its check-in, one that was stopped or
// has been reviewed goes to its summary, and a scheduled one has not been started. The screen reads the status again
// itself, because Back can restore this page from the router cache without asking the server.

import { Activity } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import PageHeader from "@/components/app/PageHeader";
import HeelSlideExercise from "@/components/flow/HeelSlideExercise";
import { stepHref } from "@/components/flow/steps";
import { getTranslation } from "@/locales/server";

import FlowUnavailable from "../../_flow/FlowUnavailable";
import { FINISHED_STATUSES, HEEL_SLIDE_SLUG, loadSensorContext, loadSessionExercise } from "../../_flow/load";
import StepPending from "../../_flow/StepPending";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = getTranslation();
  return { title: `${t("flow.steps.exercise")} · Mova` };
}

export default async function ExerciseStep({ params }: { params: { id: string } }) {
  const { t } = getTranslation();
  const session = await loadSessionExercise(params.id);
  if (session.kind !== "ok") {
    return (
      <FlowUnavailable
        eyebrow={t("flow.steps.exercise")}
        reason={session.kind === "error" ? "loadError" : "sessionNotFound"}
      />
    );
  }

  const { id, status, exerciseName, exerciseSlug, scoringRubric, targetReps, deviceInfo } = session.value;
  if (status === "completed") redirect(stepHref(id, "checkIn"));
  if (FINISHED_STATUSES.includes(status)) redirect(stepHref(id, "summary"));
  if (status !== "in_progress") return <FlowUnavailable eyebrow={t("flow.steps.exercise")} reason="notStarted" />;

  if (exerciseSlug !== HEEL_SLIDE_SLUG) {
    // TODO(#22): the session screens of the other exercises replace this placeholder.
    return (
      <StepPending
        step="exercise"
        icon={Activity}
        exerciseName={exerciseName}
        nextStep="checkIn"
        nextHref={stepHref(id, "checkIn")}
      />
    );
  }

  const sensors = await loadSensorContext();
  if (sensors.kind !== "ok") {
    return (
      <FlowUnavailable
        eyebrow={t("flow.steps.exercise")}
        reason={sensors.kind === "error" ? "loadError" : "sessionNotFound"}
      />
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={t("flow.steps.exercise")}
        title={exerciseName ?? t("flow.untitledExercise")}
        lead={t("flow.exercise.lead")}
      />
      <HeelSlideExercise
        sessionId={id}
        targetReps={targetReps}
        scoringRubric={scoringRubric}
        deviceInfo={deviceInfo}
        patientId={sensors.value.patientId}
        side={sensors.value.side}
        savedDevices={sensors.value.savedDevices}
      />
    </div>
  );
}
