"use client";

import React from "react";
import { ChevronLeftIcon, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { authCallbackUrl } from "@/lib/auth/urls";
import { createClient } from "@/lib/supabase/client";

type Provider = "google";

export function MinimalAuthPage() {
  const [supabase] = React.useState(() => createClient());
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<
    { kind: "error" | "info"; text: string } | null
  >(null);

  React.useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("error")) {
      setMsg({ kind: "error", text: "Sign-in failed — please try again." });
    }
  }, []);

  const nextParam = () =>
    new URLSearchParams(window.location.search).get("next") ?? "/app";

  const callbackUrl = () => authCallbackUrl(nextParam());

  async function signInWithProvider(provider: Provider) {
    setBusy(provider);
    setMsg(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: callbackUrl() },
    });
    if (error) {
      setBusy(null);
      setMsg({ kind: "error", text: error.message });
    }
    // On success the browser navigates to the provider's consent screen.
  }

  async function signInWithEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setBusy("email");
    setMsg(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callbackUrl() },
    });
    setBusy(null);
    setMsg(
      error
        ? { kind: "error", text: error.message }
        : { kind: "info", text: `Magic link sent to ${email}. Check your inbox.` },
    );
  }

  // Dev-only: sign in as the seeded test user so authenticated/SSR pages can be verified without
  // clicking through OAuth. The whole block is tree-shaken out of production builds.
  async function devLogin() {
    setBusy("dev");
    setMsg(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: "dev@mova.local",
      password: "password123",
    });
    if (error) {
      setBusy(null);
      setMsg({ kind: "error", text: `Dev login failed: ${error.message}` });
      return;
    }
    window.location.assign(nextParam());
  }

  return (
    <div className="relative w-full bg-paper md:h-screen md:overflow-hidden">
      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col justify-center px-4">
        <Button variant="ghost" className="absolute left-4 top-4" asChild>
          <a href="/">
            <ChevronLeftIcon className="me-1 size-4" />
            Home
          </a>
        </Button>

        <div className="mx-auto w-full space-y-5 sm:max-w-sm">
          <div className="flex items-center gap-2">
            <img src="/logo-mova.png" alt="Mova" className="h-7 w-auto" />
          </div>

          <div className="flex flex-col space-y-1">
            <h1 className="font-serif text-3xl tracking-wide">
              Sign in or create your account
            </h1>
            <p className="text-muted-foreground text-base">
              Log in or create your Mova account to start training.
            </p>
          </div>

          {msg && (
            <div
              role={msg.kind === "error" ? "alert" : "status"}
              className={`rounded-md border px-3 py-2.5 text-sm ${
                msg.kind === "error"
                  ? "border-destructive/30 bg-destructive/5 text-destructive"
                  : "border-signal/30 bg-signal/5 text-signal-deep"
              }`}
            >
              {msg.text}
            </div>
          )}

          <div className="space-y-2.5">
            <Button
              type="button"
              size="lg"
              className="w-full"
              disabled={busy !== null}
              onClick={() => signInWithProvider("google")}
            >
              {busy === "google" ? (
                <Loader2 className="me-2 size-4 animate-spin" />
              ) : (
                <GoogleIcon className="me-2 size-4" />
              )}
              Continue with Google
            </Button>
          </div>

          <div className="flex items-center gap-3 py-1">
            <span className="h-px flex-1 bg-border" />
            <span className="text-muted-foreground text-xs uppercase tracking-[0.2em]">
              or
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <form className="space-y-2.5" onSubmit={signInWithEmail}>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              autoComplete="email"
              className="bg-background focus-visible:ring-ring h-11 w-full rounded-md border border-input px-3 text-sm outline-none transition focus-visible:ring-2"
            />
            <Button
              type="submit"
              variant="secondary"
              size="lg"
              className="w-full"
              disabled={busy !== null}
            >
              {busy === "email" ? (
                <Loader2 className="me-2 size-4 animate-spin" />
              ) : null}
              Continue with email
            </Button>
          </form>

          {process.env.NODE_ENV === "development" && (
            <button
              type="button"
              onClick={devLogin}
              disabled={busy !== null}
              className="w-full rounded-md border border-dashed border-signal/40 bg-signal/5 px-3 py-2.5 text-sm font-medium text-signal-deep transition-colors hover:bg-signal/10 disabled:opacity-60"
            >
              {busy === "dev" ? "Signing in…" : "Dev auto-login · dev@mova.local"}
            </button>
          )}

          <p className="text-muted-foreground mt-8 text-sm">
            By continuing, you agree to our{" "}
            <a
              href="#"
              className="hover:text-primary underline underline-offset-4"
            >
              Terms of Service
            </a>{" "}
            and{" "}
            <a
              href="#"
              className="hover:text-primary underline underline-offset-4"
            >
              Privacy Policy
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}

const GoogleIcon = (props: React.ComponentProps<"svg">) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    {...props}
  >
    <g>
      <path d="M12.479,14.265v-3.279h11.049c0.108,0.571,0.164,1.247,0.164,1.979c0,2.46-0.672,5.502-2.84,7.669   C18.744,22.829,16.051,24,12.483,24C5.869,24,0.308,18.613,0.308,12S5.869,0,12.483,0c3.659,0,6.265,1.436,8.223,3.307L18.392,5.62   c-1.404-1.317-3.307-2.341-5.913-2.341C7.65,3.279,3.873,7.171,3.873,12s3.777,8.721,8.606,8.721c3.132,0,4.916-1.258,6.059-2.401   c0.927-0.927,1.537-2.251,1.777-4.059L12.479,14.265z" />
    </g>
  </svg>
);

