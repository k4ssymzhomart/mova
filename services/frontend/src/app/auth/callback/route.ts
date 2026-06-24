import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * OAuth / magic-link callback. Exchanges the PKCE `code` for a session, then
 * provisions the self-serve patient record (idempotent) so the user can start a
 * training session immediately. Redirects to `next` (default /app).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/app";

  if (code) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Ensure a patient record exists before the first session is created.
      await supabase.rpc("provision_self_serve_patient");
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/signin?error=auth_callback`);
}
