// Canonical URL helpers for the Supabase auth flow.
//
// Every auth redirect — the OAuth/magic-link `redirectTo` (client) and the /auth/callback +
// /auth/signout redirects (server) — must point at the PUBLIC deployment origin. Behind Render's (or
// Vercel's) proxy a route handler's `request.url` reflects the INTERNAL bind host (e.g.
// http://localhost:10000, Render's injected $PORT), so redirecting to it sends the browser to a dead
// localhost address. Resolution order: explicit NEXT_PUBLIC_SITE_URL → proxy forwarded host (server) /
// live browser origin (client) → the raw request origin as a last resort.

const SITE = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") || "";

/** Client-side absolute `/auth/callback` URL for supabase.auth.signInWithOAuth / signInWithOtp / signUp. */
export function authCallbackUrl(next = "/app"): string {
  const base = SITE || (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}/auth/callback?next=${encodeURIComponent(next)}`;
}

/** Server-side public origin to redirect back to from a route handler (never the internal bind host). */
export function publicOrigin(request: Request): string {
  if (SITE) return SITE;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    return `${proto}://${host}`;
  }
  return new URL(request.url).origin;
}
