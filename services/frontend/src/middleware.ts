import { type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match everything except Next internals and static assets, so auth cookies
     * are refreshed on real navigations only.
     */
    "/((?!_next/static|_next/image|favicon.ico|logo-mova.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
