// The honest stand-in for a flow step whose contents belong to another issue. It says plainly that the step is not
// connected yet and, in one sentence, what will happen here. The link onward exists so reviewers can walk the flow
// end to end; each owning issue replaces it with its own gate (calibration succeeded, exercise finished,
// questionnaire answered).

import { ArrowRight, type LucideIcon } from "lucide-react";
import Link from "next/link";

import EmptyState from "@/components/app/EmptyState";
import PageHeader from "@/components/app/PageHeader";
import { secondaryButton } from "@/components/app/recipes";
import type { FlowStepId } from "@/components/flow/steps";
import { getTranslation } from "@/locales/server";

type PendingStep = Extract<FlowStepId, "calibrate" | "exercise" | "checkIn">;

export default function StepPending({
  step,
  icon,
  exerciseName,
  nextHref,
  nextStep,
}: {
  step: PendingStep;
  icon: LucideIcon;
  exerciseName: string | null;
  nextHref: string;
  nextStep: Exclude<FlowStepId, "sensors">;
}) {
  const { t } = getTranslation();
  return (
    <div className="space-y-8">
      <PageHeader eyebrow={t(`flow.steps.${step}`)} title={exerciseName ?? t("flow.untitledExercise")} />
      <EmptyState
        icon={icon}
        title={t("flow.pending.title")}
        body={t(`flow.pending.${step}`)}
        action={
          <Link href={nextHref} prefetch={false} className={secondaryButton}>
            {t("flow.toStep", { step: t(`flow.steps.${nextStep}`) })}
            <ArrowRight className="size-5" strokeWidth={2} aria-hidden="true" />
          </Link>
        }
      />
    </div>
  );
}
