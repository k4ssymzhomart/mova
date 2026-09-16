import type { Metadata } from "next";

import { testAccountButtonsAvailable } from "@/app/api/dev/test-login/accounts";
import { MinimalAuthPage } from "@/components/ui/minimal-auth-page";

export const metadata: Metadata = {
  title: "Sign in · Mova",
  description: "Log in or create your Mova account.",
};

// The test-account password form exists for local development and Vercel previews only. VERCEL_ENV is read on the
// server because Vercel always sets it there, while its NEXT_PUBLIC_ copy depends on a project setting.
const TEST_PASSWORD_LOGIN = process.env.NODE_ENV === "development" || process.env.VERCEL_ENV === "preview";

export default function SignInPage() {
  // The one-press test sign-in buttons follow the same rule and also need both test passwords in the server
  // environment. Only this boolean reaches the browser.
  const testAccountButtons = TEST_PASSWORD_LOGIN && testAccountButtonsAvailable();
  return <MinimalAuthPage testPasswordLogin={TEST_PASSWORD_LOGIN} testAccountButtons={testAccountButtons} />;
}
