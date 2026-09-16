// Dev sign-in for the seeded Heel Slide test accounts: POST {account: "patient" | "clinician"} signs this browser in
// with the cookie-based server client, so the session cookie comes back on this response, and answers
// {ok: true, next}. It lets a walkthrough be recorded without typing a password on screen (docs/heel-slide-path.md).
//
// Outside a local development server or a Vercel preview, and whenever the account's password is not set, every
// request gets the same bare 404. A failed sign-in is a bare 401. Nothing here logs, and no response carries an
// address, a password or Supabase's error text. One request is one sign-in attempt; nothing retries.

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

import { isTestAccount, testAccountCredentials, testLoginAllowed } from "./accounts";

function notFound() {
  return NextResponse.json({ ok: false }, { status: 404 });
}

export async function POST(request: Request) {
  if (!testLoginAllowed()) return notFound();
  // JSON only: a cross-site page cannot send it without a preflight this route never answers, so no other site can
  // sign a visitor's browser into a test account.
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return notFound();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return notFound();
  }
  const account = body !== null && typeof body === "object" ? (body as { account?: unknown }).account : undefined;
  if (!isTestAccount(account)) return notFound();
  const credentials = testAccountCredentials(account);
  if (!credentials) return notFound();

  let signedIn = false;
  try {
    const { error } = await createClient().auth.signInWithPassword({
      email: credentials.email,
      password: credentials.password,
    });
    signedIn = !error;
  } catch {
    signedIn = false;
  }
  if (!signedIn) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true, next: credentials.next });
}
