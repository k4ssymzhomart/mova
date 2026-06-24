import type { Metadata } from "next";

import { MinimalAuthPage } from "@/components/ui/minimal-auth-page";

export const metadata: Metadata = {
  title: "Sign in · Mova",
  description: "Log in or create your Mova account.",
};

export default function SignInPage() {
  return <MinimalAuthPage />;
}
