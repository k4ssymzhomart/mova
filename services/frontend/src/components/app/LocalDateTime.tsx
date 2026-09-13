"use client";

// A date or time in the viewer's own timezone. The server renders in UTC and nothing records the patient's
// timezone yet (profiles.timezone is never written, so it stays at its UTC default); formatting on the server
// would put an Astana session five hours early and show yesterday's date until 05:00. Until hydration the text
// is laid out but invisible, so a wrong value is never shown; on client-side navigation it renders at once.

import { useSyncExternalStore } from "react";

import { type DateStyle, formatDate } from "@/lib/i18n/formatDate";
import { useTranslation } from "@/locales/client";

const subscribe = () => () => {};

function calendarDay(date: Date, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export default function LocalDateTime({
  iso,
  format,
  sameDayAs,
}: {
  iso: string;
  format: DateStyle;
  /** With format "time": if the instant falls on a different calendar day than this one, show the date too. */
  sameDayAs?: string;
}) {
  const { locale } = useTranslation();
  const onClient = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  // undefined = the browser's timezone. Before hydration: UTC, only to reserve the same space.
  const timeZone = onClient ? undefined : "UTC";
  const reference = sameDayAs ? new Date(sameDayAs) : null;
  const effective: DateStyle =
    format === "time" &&
    reference &&
    !Number.isNaN(reference.getTime()) &&
    calendarDay(date, timeZone) !== calendarDay(reference, timeZone)
      ? "dateTime"
      : format;

  const text = formatDate(date, locale, effective, timeZone);

  if (!onClient) {
    return (
      <span className="invisible" aria-hidden="true">
        {text}
      </span>
    );
  }
  return <time dateTime={iso}>{text}</time>;
}
