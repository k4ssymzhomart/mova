import { createClient } from "@supabase/supabase-js";

import "server-only";

/**
 * Service-role Supabase client — bypasses RLS. SERVER ONLY. Never import this
 * into a client component or expose the key to the browser. Use only for trusted
 * back-office tasks that legitimately need to cross tenant boundaries.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
