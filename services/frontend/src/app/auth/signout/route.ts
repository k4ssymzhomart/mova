import { NextResponse } from "next/server";

import { publicOrigin } from "@/lib/auth/urls";
import { createClient } from "@/lib/supabase/server";

/** Sign the user out and return to the landing page (on the public origin, not the proxy host). */
export async function POST(request: Request) {
  const supabase = createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(`${publicOrigin(request)}/`, { status: 303 });
}
