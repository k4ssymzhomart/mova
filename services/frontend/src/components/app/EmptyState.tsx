// An honest empty state: says plainly that there is no data yet and, where it helps, why. Used wherever a
// screen would otherwise need invented numbers. Strings arrive translated.

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { bodyText, cardTitle } from "./recipes";

export default function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  headingLevel = 2,
}: {
  icon: LucideIcon;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className="rounded-card border border-dashed border-ink/25 bg-card px-6 py-10 text-center sm:px-10">
      <span className="mx-auto grid size-12 place-items-center rounded-full bg-paper-soft text-ink-soft ring-1 ring-line">
        <Icon className="size-6" strokeWidth={1.8} aria-hidden="true" />
      </span>
      <Heading className={`mt-4 ${cardTitle}`}>{title}</Heading>
      {body && <div className={`mx-auto mt-2 max-w-xl ${bodyText}`}>{body}</div>}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}
