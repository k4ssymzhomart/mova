import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Canonical browser Supabase client, built on @supabase/ssr. It writes the
 * session to cookies, so the SSR middleware and server components observe the
 * same authenticated session. Use this for the authenticated /app area and the
 * /signin flow. Safe in client components — it only ever holds the publishable
 * anon key and the user's own session cookie.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

// ---------------------------------------------------------------------------
// Legacy client-only singleton used by the patient-experience features
// (AuthProvider, RequireAuth, and the session/intake/progress/clinician pages).
// Loaded lazily via dynamic import so @supabase/supabase-js never enters the
// server/SSR bundle (a static import otherwise breaks `next start` with a
// vendor-chunk resolution error). Returns null when env is unset, so those
// flows fall back to guest mode.
// ---------------------------------------------------------------------------

let cached: SupabaseClient | null | undefined;

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export async function getSupabase(): Promise<SupabaseClient | null> {
  if (cached !== undefined) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    cached = null;
    return null;
  }
  const { createClient: createSupabaseClient } = await import("@supabase/supabase-js");
  cached = createSupabaseClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return cached;
}
