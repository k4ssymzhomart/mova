// Step 3 of the exercise flow (Упражнение).
//
// Heel Slide runs on its own screen (HeelSlideExercise): three real sensors, or the development simulation's, which
// the flow frame announces and the session records as simulated. It keeps that screen because the clinician portal
// and the clinician recount are both written against the `heel_slide_path.v1` summary it writes and against the
// thigh/shank pitch pairs it records — moving the one exercise in clinical use onto a new record would lose it.
//
// EVERY OTHER EXERCISE runs on components/flow/ExerciseRunner, which measures the movement either from the sensors
// the exercise actually needs or from the camera, counts repetitions the same way for both, and scores the ones the
// engine has a config for. That replaces the placeholder this step used to show for sixteen of seventeen exercises.
//
// Only a session in progress opens the exercise. A completed one goes on to its check-in, one that was stopped or
// has been reviewed goes to its summary, and a scheduled one has not been started. The screen reads the status again
// itself, because Back can restore this page from the router cache without asking the server.

import type { Metadata } from "next";
import { redirect } from "next/navigation";

import PageHeader from "@/components/app/PageHeader";
import ExerciseRunner from "@/components/flow/ExerciseRunner";
import HeelSlideExercise from "@/components/flow/HeelSlideExercise";
import { stepHref } from "@/components/flow/steps";
import { getTranslation } from "@/locales/server";

import FlowUnavailable from "../../_flow/FlowUnavailable";
import { FINISHED_STATUSES, HEEL_SLIDE_SLUG, loadSensorContext, loadSessionExercise } from "../../_flow/load";

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

  const sensors = await loadSensorContext();
  if (sensors.kind !== "ok") {
    return (
      <FlowUnavailable
        eyebrow={t("flow.steps.exercise")}
        reason={sensors.kind === "error" ? "loadError" : "sessionNotFound"}
      />
    );
  }

  if (exerciseSlug !== HEEL_SLIDE_SLUG) {
    return (
      <div className="space-y-8">
        <PageHeader
          eyebrow={t("flow.steps.exercise")}
          title={exerciseName ?? t("flow.untitledExercise")}
          lead={t("flow.exercise.leadGeneric")}
        />
        <ExerciseRunner
          sessionId={id}
          exerciseSlug={exerciseSlug ?? ""}
          exerciseName={exerciseName}
          targetReps={targetReps}
          scoringRubric={scoringRubric}
          patientId={sensors.value.patientId}
          side={sensors.value.side}
          savedDevices={sensors.value.savedDevices}
        />
      </div>
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
