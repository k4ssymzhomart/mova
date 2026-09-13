// /app/session/<id> with no step: send the patient to where this session stands. Ended sessions (completed,
// reviewed by the care team, or stopped) go to the summary; a session in progress goes to calibration, the first
// step that belongs to a session. A scheduled session has not been started, so it is not opened from here.

import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { stepHref } from "@/components/flow/steps";
import { getTranslation } from "@/locales/server";

import FlowUnavailable from "../_flow/FlowUnavailable";
import { FINISHED_STATUSES, loadFlowSession } from "../_flow/load";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = getTranslation();
  return { title: `${t("flow.title")} · Mova` };
}

export default async function SessionEntry({ params }: { params: { id: string } }) {
  const session = await loadFlowSession(params.id);
  if (session.kind === "error") return <FlowUnavailable reason="loadError" />;
  if (session.kind === "notFound") return <FlowUnavailable reason="sessionNotFound" />;

  const { id, status } = session.value;
  if (FINISHED_STATUSES.includes(status)) redirect(stepHref(id, "summary"));
  if (status === "in_progress") redirect(stepHref(id, "calibrate"));

  // TODO(#22): decide whether a scheduled session can be started from here. Nothing creates one today.
  return <FlowUnavailable reason="notStarted" />;
}
