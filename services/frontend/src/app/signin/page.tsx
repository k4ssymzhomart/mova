import type { Metadata } from "next";
import { Suspense } from "react";

import AuthForm from "@/components/auth/AuthForm";

export const metadata: Metadata = {
  title: "Sign in · Mova",
  description: "Sign in or create your Mova account to access your sessions, progress, and insights.",
};

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <AuthForm />
    </Suspense>
  );
}
