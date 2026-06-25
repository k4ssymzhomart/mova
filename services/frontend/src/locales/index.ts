// Lightweight i18n engine. Russian is the hardcoded default interface language, so there's no runtime
// locale switching and no React context to thread through — translations are a synchronous dictionary
// lookup that works identically in Server and Client Components. Keys are dot-paths into ru.json
// (e.g. "nav.today"); `{n}`-style placeholders are interpolated from `vars`. A missing key falls back
// to the key itself, so a typo renders visibly instead of crashing.

import ru from "./ru.json";

export type TranslateVars = Record<string, string | number>;

function lookup(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, source);
}

export function t(key: string, vars?: TranslateVars): string {
  const value = lookup(ru, key);
  if (typeof value !== "string") return key;
  if (!vars) return value;
  return Object.entries(vars).reduce(
    (str, [name, replacement]) => str.replaceAll(`{${name}}`, String(replacement)),
    value,
  );
}

/** Ergonomic accessor for Client Components — returns the same isomorphic `t`. */
export function useTranslation() {
  return { t };
}

export { ru as messages };
