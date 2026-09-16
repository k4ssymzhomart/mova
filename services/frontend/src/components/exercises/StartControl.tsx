// What an exercise offers where a start control would be. Only an exercise the patient can actually start gets a
// button; everything else says so in plain text, never as a disabled button that looks startable. Strings arrive
// translated, so the card (server) and the detail (client) share it.

import { CloudOff, Play } from "lucide-react";
import Link from "next/link";

import { primaryButton } from "@/components/app/recipes";
import { cn } from "@/lib/utils";

import type { StartAction } from "./library";

export default function StartControl({
  action,
  id,
  titleId,
  labels,
  className,
}: {
  action: StartAction;
  id: string;
  /** The exercise name's id: the accessible name reads "Start, <name>", since every start control says "Start". */
  titleId: string;
  labels: { start: string; notPrescribed: string; unknown: string };
  className?: string;
}) {
  if (action.kind === "start") {
    return (
      <Link
        id={id}
        href={action.href}
        prefetch={false}
        aria-labelledby={`${id} ${titleId}`}
        className={cn(primaryButton, "w-full shrink-0 sm:w-auto", className)}
      >
        <Play className="size-5" strokeWidth={2} aria-hidden="true" />
        {labels.start}
      </Link>
    );
  }
  if (action.kind === "unknown") {
    return (
      <p id={id} className={cn("flex items-center gap-2 text-base font-medium text-ink-soft", className)}>
        <CloudOff className="size-5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
        {labels.unknown}
      </p>
    );
  }
  return (
    <p id={id} className={cn("text-base font-medium text-ink-soft", className)}>
      {labels.notPrescribed}
    </p>
  );
}
