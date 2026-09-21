// What a flow route shows when it cannot open what the URL points at: the session or prescription is not this
// patient's (or does not exist), the session has not been started, or the read failed. Each case says so plainly
// and leads home, because the flow is only ever entered from Today.

import { CalendarClock, CloudOff, type LucideIcon, SearchX } from "lucide-react";
import Link from "next/link";

import EmptyState from "@/components/app/EmptyState";
import PageHeader from "@/components/app/PageHeader";
import { primaryButton } from "@/components/app/recipes";
import { getTranslation } from "@/locales/server";

export type UnavailableReason = "sessionNotFound" | "prescriptionNotFound" | "notStarted" | "loadError";

const ICON: Record<UnavailableReason, LucideIcon> = {
  sessionNotFound: SearchX,
  prescriptionNotFound: SearchX,
  notStarted: CalendarClock,
  loadError: CloudOff,
};

export default function FlowUnavailable({ reason, eyebrow }: { reason: UnavailableReason; eyebrow?: string }) {
  const { t } = getTranslation();
  return (
    <div className="space-y-8">
      <PageHeader stacked eyebrow={eyebrow ?? t("flow.title")} title={t("flow.unavailable.title")} />
      <EmptyState
        icon={ICON[reason]}
        title={t(`flow.unavailable.${reason}.title`)}
        body={t(`flow.unavailable.${reason}.body`)}
        action={
          <Link href="/app" className={primaryButton}>
            {t("shell.home")}
          </Link>
        }
      />
    </div>
  );
}
