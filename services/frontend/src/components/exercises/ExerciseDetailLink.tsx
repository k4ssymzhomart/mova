"use client";

// Opens an exercise's detail on the library itself (/exercises?exercise=<slug>). A plain link that works before
// hydration and in a new tab; after hydration a plain click pushes the URL instead of navigating, so the detail
// opens without a server round trip and Back closes it. Next 14.2 keeps useSearchParams in step with pushState.

import type { ReactNode } from "react";

import { exerciseHref } from "./library";

/** Marks the history entry the library pushed, so closing the detail can step back instead of stacking entries. */
export const DETAIL_HISTORY_KEY = "movaExerciseDetail";

export default function ExerciseDetailLink({
  slug,
  id,
  labelledBy,
  className,
  children,
}: {
  slug: string;
  id?: string;
  labelledBy?: string;
  className?: string;
  children: ReactNode;
}) {
  const href = exerciseHref(slug);
  return (
    <a
      id={id}
      href={href}
      aria-labelledby={labelledBy}
      className={className}
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        window.history.pushState({ [DETAIL_HISTORY_KEY]: true }, "", href);
      }}
    >
      {children}
    </a>
  );
}
