// Server-side locale resolution. Reads the locale cookie the toggle sets and returns a translator
// bound to it. Reading cookies opts the caller into dynamic rendering — fine here: the app runs on a
// Node server (next start), not a static export, and the data-driven routes are already dynamic.

import { cookies } from "next/headers";

import {
  DEFAULT_LOCALE,
  isLocale,
  type Locale,
  LOCALE_COOKIE,
  type TranslateVars,
  translate,
} from "./index";

export function getLocale(): Locale {
  const raw = cookies().get(LOCALE_COOKIE)?.value;
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}

/** Translator bound to the request's locale cookie, for Server Components. */
export function getTranslation(): {
  locale: Locale;
  t: (key: string, vars?: TranslateVars) => string;
} {
  const locale = getLocale();
  return { locale, t: (key, vars) => translate(locale, key, vars) };
}
