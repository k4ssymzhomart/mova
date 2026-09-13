// Dates and times for the three app locales, identical on the server and in the browser.
//
// Intl handles Russian and English everywhere. Kazakh is another matter: browser ICU builds often ship without
// Kazakh data and render kk-KZ as "M09 13, SUN", while Node (full ICU) formats it properly, so the same component
// would print different text on each side. Kazakh dates are therefore assembled here from month and weekday
// names, with the numbers read from en-GB parts, which every runtime has.

import type { Locale } from "@/locales";

export type DateStyle = "dateTime" | "date" | "time" | "weekday" | "dayMonth";

const INTL_TAG = { ru: "ru-RU", en: "en-GB" } as const;

const INTL_OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  dateTime: { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" },
  date: { day: "numeric", month: "long", year: "numeric" },
  time: { hour: "2-digit", minute: "2-digit" },
  weekday: { weekday: "long", day: "numeric", month: "long" },
  dayMonth: { day: "numeric", month: "long" },
};

const KK_MONTHS = [
  "қаңтар",
  "ақпан",
  "наурыз",
  "сәуір",
  "мамыр",
  "маусым",
  "шілде",
  "тамыз",
  "қыркүйек",
  "қазан",
  "қараша",
  "желтоқсан",
];

const KK_WEEKDAYS: Record<string, string> = {
  Sun: "жексенбі",
  Mon: "дүйсенбі",
  Tue: "сейсенбі",
  Wed: "сәрсенбі",
  Thu: "бейсенбі",
  Fri: "жұма",
  Sat: "сенбі",
};

function kazakh(date: Date, style: DateStyle, timeZone: string | undefined): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";

  const dayMonth = `${Number(part("day"))} ${KK_MONTHS[Number(part("month")) - 1]}`;
  const time = `${part("hour")}:${part("minute")}`;
  switch (style) {
    case "time":
      return time;
    case "dayMonth":
      return dayMonth;
    case "weekday":
      return `${dayMonth}, ${KK_WEEKDAYS[part("weekday")] ?? ""}`;
    case "date":
      return `${part("year")} жылғы ${dayMonth}`;
    case "dateTime":
      return `${part("year")} жылғы ${dayMonth}, ${time}`;
  }
}

/** Format an instant for the given locale. timeZone undefined = the runtime's own timezone. */
export function formatDate(date: Date, locale: Locale, style: DateStyle, timeZone?: string): string {
  if (locale === "kk") return kazakh(date, style, timeZone);
  return new Intl.DateTimeFormat(INTL_TAG[locale], { ...INTL_OPTIONS[style], timeZone }).format(date);
}
