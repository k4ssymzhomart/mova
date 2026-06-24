"use client";

// Browser Supabase client (singleton), loaded lazily and *browser-only*. The static import is
// type-only (erased at build time) and the implementation is pulled in via dynamic import inside an
// async getter — so @supabase never enters the server/SSR bundle (which otherwise breaks `next start`
// with a vendor-chunk resolution error). Reads the public URL + anon key from env; returns null when
// unset so the app falls back to guest mode.

import type { SupabaseClient } from "@supabase/supabase-js";

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
  const { createClient } = await import("@supabase/supabase-js");
  cached = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return cached;
}
