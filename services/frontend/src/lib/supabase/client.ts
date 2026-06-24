import { createBrowserClient } from "@supabase/ssr";

/**
 * Canonical browser Supabase client, built on @supabase/ssr. It writes the
 * session to cookies, so the SSR middleware, server components and the client
 * AuthProvider all observe the same authenticated session. Safe in client
 * components — it only ever holds the publishable anon key and the user's own
 * session cookie.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

/** True when the public Supabase env is present; gates the guest-mode fallback. */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
