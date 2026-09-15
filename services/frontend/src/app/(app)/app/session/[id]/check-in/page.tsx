// Step 4 of the exercise flow (Опрос). A short check-in after the exercise: pain before and after, how hard it was,
// how the knee feels, and any new symptoms. It opens only for a completed session that has no check-in yet, since
// that is the only state submit_session_check_in accepts; every other state sends the patient to where the
// session stands. Once answered, the check-in is never edited, so the step then leads straight to the summary.
//
// The answers are stored as given and nothing is triaged from them here. The RED safety check (НТЗ §15) is out of
// scope for this path, so no answer changes what the patient sees next.

import type { Metadata } from "next";
import { redirect } from "next/navigation";

import PageHeader from "@/components/app/PageHeader";
import { stepHref } from "@/components/flow/steps";
import { getTranslation } from "@/locales/server";

import FlowUnavailable from "../../_flow/FlowUnavailable";
import { loadFlowSession } from "../../_flow/load";
import CheckInForm from "./CheckInForm";
import { loadCheckInSubmitted } from "./load";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = getTranslation();
  return { title: `${t("flow.steps.checkIn")} · Mova` };
}

export default async function CheckInStep({ params }: { params: { id: string } }) {
  const { t } = getTranslation();
  const eyebrow = t("flow.steps.checkIn");
  const session = await loadFlowSession(params.id);
  if (session.kind !== "ok") {
    return <FlowUnavailable eyebrow={eyebrow} reason={session.kind === "error" ? "loadError" : "sessionNotFound"} />;
  }

  const { id, status } = session.value;
  // Still in progress: the exercise has not been finished. Stopped or already reviewed: only the summary is left.
  if (status === "in_progress") redirect(stepHref(id, "exercise"));
  if (status === "scheduled") return <FlowUnavailable eyebrow={eyebrow} reason="notStarted" />;
  if (status !== "completed") redirect(stepHref(id, "summary"));

  const submitted = await loadCheckInSubmitted(id);
  if (submitted.kind !== "ok") return <FlowUnavailable eyebrow={eyebrow} reason="loadError" />;
  if (submitted.value) redirect(stepHref(id, "summary"));

  return (
    <div className="space-y-8">
      <PageHeader eyebrow={eyebrow} title={t("flow.checkIn.title")} lead={t("flow.checkIn.hint")} />
      <CheckInForm sessionId={id} />
    </div>
  );
}
