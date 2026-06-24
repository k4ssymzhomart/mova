"use client";

// App-wide auth state. Wraps Supabase Auth (Google OAuth + email/password) and a local "guest" mode
// so the product is usable without a backend. Privacy-first: only the session lives client-side.

import type { Session, User } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";

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

function redirectTo(path = "/session"): string {
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const configured = isSupabaseConfigured();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);

  useEffect(() => {
    setIsGuest(typeof window !== "undefined" && window.localStorage.getItem(GUEST_KEY) === "1");
    let unsub: (() => void) | undefined;
    getSupabase().then((supabase) => {
      if (!supabase) {
        setLoading(false);
        return;
      }
      supabase.auth.getSession().then(({ data }) => {
        setSession(data.session);
        setLoading(false);
      });
      const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
      unsub = () => sub.subscription.unsubscribe();
    });
    return () => unsub?.();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user: session?.user ?? null,
      session,
      loading,
      configured,
      isGuest,
      authed: Boolean(session) || isGuest,
      async signInWithGoogle() {
        const supabase = await getSupabase();
        if (!supabase) return { error: "Sign-in isn't configured yet — continue as guest, or add Supabase keys." };
        const { error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: redirectTo("/session") },
        });
        return error ? { error: error.message } : {};
      },
      async signInWithEmail(email, password) {
        const supabase = await getSupabase();
        if (!supabase) return { error: "Sign-in isn't configured yet — continue as guest." };
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        return error ? { error: error.message } : {};
      },
      async signUpWithEmail(email, password) {
        const supabase = await getSupabase();
        if (!supabase) return { error: "Sign-up isn't configured yet — continue as guest." };
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: redirectTo("/session") },
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
        const supabase = await getSupabase();
        await supabase?.auth.signOut();
        setSession(null);
      },
    }),
    [session, loading, configured, isGuest],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
