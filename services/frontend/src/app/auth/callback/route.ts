import { NextResponse } from "next/server";

import { publicOrigin } from "@/lib/auth/urls";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth / magic-link callback. Exchanges the PKCE `code` for a session, then
 * provisions the self-serve patient record (idempotent) so the user can start a
 * training session immediately. Redirects to `next` (default /app).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/app";
  // Redirect against the PUBLIC origin, never request.url's internal proxy host (localhost:$PORT).
  const base = publicOrigin(request);

  if (code) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Ensure a patient record exists before the first session is created.
      await supabase.rpc("provision_self_serve_patient");
      return NextResponse.redirect(`${base}${next}`);
    }
  }

  return NextResponse.redirect(`${base}/signin?error=auth_callback`);
}
