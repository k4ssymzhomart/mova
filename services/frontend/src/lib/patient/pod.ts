// Post-operative day (POD). Everything in the TKA protocol is indexed to it, so it is computed in exactly
// one place (here, called from the server layout) and rendered by exactly one component (PatientContextBar).
//
// Two things are deliberately NOT decided in code:
//  1. The origin: is the day of surgery POD 0 or POD 1? The НТЗ only says «Дата операции; POD вычисляется
//     автоматически».
//  2. Which timezone the day boundary is taken in (clinic or patient). `clinics.timezone` and
//     `profiles.timezone` both default to UTC, which is five hours off for Astana.
// Both questions are with the clinician. Until they are answered POD_CONVENTION stays null and no day
// number is shown, even when a surgery date exists.
//
// Never estimate the surgery date from anything else: not the signup date, not the first session, not
// programs.start_date, and not patients.baseline (the patient can write that column).

export interface PodConvention {
  /** Day number assigned to the calendar day of surgery. */
  surgeryDayIs: 0 | 1;
  /** IANA timezone the day boundary is computed in, e.g. "Asia/Almaty". */
  timeZone: string;
}

// TODO(clinician): set once the POD origin and timezone are confirmed.
export const POD_CONVENTION: PodConvention | null = null;

export type PostOpDay =
  | { status: "known"; day: number; surgeryDate: string; isSurgeryDay: boolean }
  | { status: "scheduled"; surgeryDate: string }
  | { status: "unknown"; reason: "no-surgery-date" | "invalid-date" | "convention-pending" };

const DAY_MS = 86_400_000;

/** Days since the Unix epoch for a YYYY-MM-DD calendar date, or null if it isn't a real date. */
function epochDay(isoDate: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const [y, m, d] = isoDate.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d);
  if (new Date(ms).toISOString().slice(0, 10) !== isoDate) return null; // rejects 2026-02-30
  return ms / DAY_MS;
}

/** The calendar date (YYYY-MM-DD) an instant falls on in the given timezone. */
function calendarDateIn(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    instant,
  );
}

export function computePostOpDay(
  surgeryDate: string | null,
  now: Date,
  convention: PodConvention | null,
): PostOpDay {
  if (!surgeryDate) return { status: "unknown", reason: "no-surgery-date" };
  const surgery = epochDay(surgeryDate);
  if (surgery === null) return { status: "unknown", reason: "invalid-date" };
  if (!convention) return { status: "unknown", reason: "convention-pending" };

  const today = epochDay(calendarDateIn(now, convention.timeZone));
  if (today === null) return { status: "unknown", reason: "invalid-date" };
  const elapsed = today - surgery;
  if (elapsed < 0) return { status: "scheduled", surgeryDate };
  return { status: "known", day: elapsed + convention.surgeryDayIs, surgeryDate, isSurgeryDay: elapsed === 0 };
}
