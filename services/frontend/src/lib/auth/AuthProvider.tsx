"use client";

// App-wide auth state. Wraps Supabase Auth (Google OAuth + email/password) and a local "guest" mode
// so the product is usable without a backend. It reads the session from the cookie-based @supabase/ssr
// browser client — the SAME session the /app middleware refreshes and the live-telemetry writes use —
// so a single sign-in (via /signin → MinimalAuthPage) authenticates the whole client product, not just
// the SSR /app area. Privacy-first: only the session lives client-side.

import type { Session, User } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { authCallbackUrl } from "@/lib/auth/urls";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

type Result = { error?: string; info?: string };

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  configured: boolean;
  isGuest: boolean;
  authed: boolean;
  signInWithGoogle: () => Promise<Result>;
  signInWithEmail: (email: string, password: string) => Promise<Result>;
  signUpWithEmail: (email: string, password: string) => Promise<Result>;
  continueAsGuest: () => void;
  signOut: () => Promise<void>;
}

const GUEST_KEY = "mova.guest";
const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const configured = isSupabaseConfigured();
  // One cookie-backed browser client for the whole app; null when env is unset (guest-only mode).
  const [supabase] = useState(() => (configured ? createClient() : null));
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);

  useEffect(() => {
    setIsGuest(typeof window !== "undefined" && window.localStorage.getItem(GUEST_KEY) === "1");
    if (!supabase) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  const value = useMemo<AuthState>(
    () => ({
      user: session?.user ?? null,
      session,
      loading,
      configured,
      isGuest,
      authed: Boolean(session) || isGuest,
      async signInWithGoogle() {
        if (!supabase) return { error: "Sign-in isn't configured yet — continue as guest, or add Supabase keys." };
        const { error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: authCallbackUrl("/app") },
        });
        return error ? { error: error.message } : {};
      },
      async signInWithEmail(email, password) {
        if (!supabase) return { error: "Sign-in isn't configured yet — continue as guest." };
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        return error ? { error: error.message } : {};
      },
      async signUpWithEmail(email, password) {
        if (!supabase) return { error: "Sign-up isn't configured yet — continue as guest." };
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: authCallbackUrl("/app") },
        });
        if (error) return { error: error.message };
        if (!data.session) return { info: "Account created — check your email to confirm, then sign in." };
        return {};
      },
      continueAsGuest() {
        if (typeof window !== "undefined") window.localStorage.setItem(GUEST_KEY, "1");
        setIsGuest(true);
      },
      async signOut() {
        if (typeof window !== "undefined") window.localStorage.removeItem(GUEST_KEY);
        setIsGuest(false);
        await supabase?.auth.signOut();
        setSession(null);
      },
    }),
    [session, loading, configured, isGuest, supabase],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
