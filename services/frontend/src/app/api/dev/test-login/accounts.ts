// The seeded Heel Slide test accounts (scripts/seed-heel-slide.mjs, docs/heel-slide-path.md §4) behind the dev
// sign-in buttons on /signin. Server only: the passwords are read from the server environment and never leave it,
// and the sign-in page learns only whether both are set. The same rule as the test password form decides where this
// works at all: a local development server or a Vercel preview, never production.

import "server-only";

export type TestAccount = "patient" | "clinician";

export interface TestAccountCredentials {
  email: string;
  password: string;
  /** Where the account lands after signing in. */
  next: "/app" | "/clinician";
}

const TEST_EMAIL_DOMAIN = "@mova.test";

/** VERCEL_ENV is read on the server, where Vercel always sets it (see app/signin/page.tsx). */
export function testLoginAllowed(): boolean {
  return process.env.NODE_ENV === "development" || process.env.VERCEL_ENV === "preview";
}

export function isTestAccount(value: unknown): value is TestAccount {
  return value === "patient" || value === "clinician";
}

/**
 * The account's address and password, or null when test sign-in is not allowed here, the password is not set, or
 * the address is not a test address. The address falls back to the seed's default, as the seed does.
 */
export function testAccountCredentials(account: TestAccount): TestAccountCredentials | null {
  if (!testLoginAllowed()) return null;
  const configured =
    account === "patient"
      ? {
          email: process.env.HEEL_SLIDE_PATIENT_EMAIL || "heel-slide-patient@mova.test",
          password: process.env.HEEL_SLIDE_PATIENT_PASSWORD,
          next: "/app" as const,
        }
      : {
          email: process.env.HEEL_SLIDE_CLINICIAN_EMAIL || "heel-slide-clinician@mova.test",
          password: process.env.HEEL_SLIDE_CLINICIAN_PASSWORD,
          next: "/clinician" as const,
        };
  const email = configured.email.trim().toLowerCase();
  if (!configured.password) return null;
  if (!email.endsWith(TEST_EMAIL_DOMAIN) || email.length === TEST_EMAIL_DOMAIN.length) return null;
  return { email, password: configured.password, next: configured.next };
}

/** Both buttons or neither: a recording needs the patient and the clinician. */
export function testAccountButtonsAvailable(): boolean {
  return testAccountCredentials("patient") !== null && testAccountCredentials("clinician") !== null;
}
