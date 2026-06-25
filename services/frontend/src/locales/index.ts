// i18n core — isomorphic, dependency-free (no React, no next) so it is safe to import in Server
// Components, Client Components, and at module scope. Russian is the default and the fallback: a key
// missing from the active locale falls back to ru.json, then to the key itself (so a typo renders
// visibly instead of crashing). Dot-path keys index ru.json/en.json; `{n}` placeholders interpolate.
//
// - Module scope / "I don't care about runtime locale": import { t } — always Russian.
// - Client Components: import { useTranslation } from "@/locales/client" — reacts to the toggle.
// - Server Components: import { getTranslation } from "@/locales/server" — reads the locale cookie.

import en from "./en.json";
import ru from "./ru.json";

export type TranslateVars = Record<string, string | number>;
export type Locale = "ru" | "en";

export const LOCALES: Locale[] = ["ru", "en"];
export const DEFAULT_LOCALE: Locale = "ru";
export const LOCALE_COOKIE = "mova.locale";

const DICTS: Record<Locale, unknown> = { ru, en };

export function isLocale(value: unknown): value is Locale {
  return value === "ru" || value === "en";
}

function lookup(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, source);
}

function interpolate(value: string, vars?: TranslateVars): string {
  if (!vars) return value;
  return Object.entries(vars).reduce(
    (str, [name, replacement]) => str.replaceAll(`{${name}}`, String(replacement)),
    value,
  );
}

/** Translate a key in an explicit locale, falling back to Russian then the key itself. */
export function translate(locale: Locale, key: string, vars?: TranslateVars): string {
  let value = lookup(DICTS[locale], key);
  if (typeof value !== "string") value = lookup(DICTS[DEFAULT_LOCALE], key);
  if (typeof value !== "string") return key;
  return interpolate(value, vars);
}

/** Synchronous, always-Russian translator. Use for module-scope constants / back-compat. */
export function t(key: string, vars?: TranslateVars): string {
  return translate(DEFAULT_LOCALE, key, vars);
}

export { ru as messages };
