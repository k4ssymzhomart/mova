"use client";

// Client-side locale context. Initialised from the cookie the server already resolved (passed via the
// root layout), so there is no hydration flash. Switching writes the cookie + refreshes the router so
// Server Components re-render in the new locale, and updates context so Client Components react live.

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

import {
  DEFAULT_LOCALE,
  type Locale,
  LOCALE_COOKIE,
  type TranslateVars,
  translate,
} from "./index";

interface LocaleContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: string, vars?: TranslateVars) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const router = useRouter();

  const setLocale = useCallback(
    (next: Locale) => {
      // 1 year, root path, lax — readable by both the server (cookies()) and the client.
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
      document.documentElement.lang = next;
      setLocaleState(next);
      router.refresh();
    },
    [router],
  );

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale, t: (key, vars) => translate(locale, key, vars) }),
    [locale, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** Client translator bound to the active locale. Falls back to Russian outside a provider. */
export function useTranslation() {
  const ctx = useContext(LocaleContext);
  if (ctx) return { t: ctx.t, locale: ctx.locale };
  return { t: (key: string, vars?: TranslateVars) => translate(DEFAULT_LOCALE, key, vars), locale: DEFAULT_LOCALE };
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  return {
    locale: ctx?.locale ?? DEFAULT_LOCALE,
    setLocale: ctx?.setLocale ?? (() => {}),
  };
}
