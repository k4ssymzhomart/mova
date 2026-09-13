// Step 4 of the exercise flow (Опрос). Holds the step's place until the post-session questionnaire exists. No
// questions are shown here: their wording is a clinical decision that belongs to #22.

import { ClipboardList } from "lucide-react";
import type { Metadata } from "next";

import { stepHref } from "@/components/flow/steps";
import { getTranslation } from "@/locales/server";

import FlowUnavailable from "../../_flow/FlowUnavailable";
import { loadFlowSession } from "../../_flow/load";
import StepPending from "../../_flow/StepPending";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = getTranslation();
  return { title: `${t("flow.steps.checkIn")} · Mova` };
}

export default async function CheckInStep({ params }: { params: { id: string } }) {
  const { t } = getTranslation();
  const session = await loadFlowSession(params.id);
  if (session.kind !== "ok") {
    return (
      <FlowUnavailable
        eyebrow={t("flow.steps.checkIn")}
        reason={session.kind === "error" ? "loadError" : "sessionNotFound"}
      />
    );
  }

  // TODO(#22): the post-session questionnaire replaces this placeholder, and submitting it replaces the link
  // onward.
  return (
    <StepPending
      step="checkIn"
      icon={ClipboardList}
      exerciseName={session.value.exerciseName}
      nextStep="summary"
      nextHref={stepHref(session.value.id, "summary")}
    />
  );
}
