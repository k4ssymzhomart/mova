"use client";

import React from "react";
import { ChevronLeftIcon, Loader2 } from "lucide-react";

import LanguageToggle from "@/components/LanguageToggle";
import { Button } from "@/components/ui/button";
import { authCallbackUrl } from "@/lib/auth/urls";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/locales/client";

type Provider = "google";

// Password sign-in for the seeded test accounts (docs/heel-slide-path.md): a tester on a Vercel preview signs in
// as the test patient or clinician without a mailbox. Real accounts sign in with Google or an email link and have
// no password, and the form refuses any address outside the test domain. The sign-in page decides whether to show
// it (development and previews only); it is never rendered in production. Next to it, one button per test account
// signs in through /api/dev/test-login, which keeps the password in the server environment, so nothing is typed or
// shown on a recording. The sign-in page shows the buttons only where that route works and both passwords are set.
const TEST_EMAIL_DOMAIN = "@mova.test";

type TestAccount = "patient" | "clinician";

export function MinimalAuthPage({
  testPasswordLogin = false,
  testAccountButtons = false,
}: {
  testPasswordLogin?: boolean;
  testAccountButtons?: boolean;
}) {
  const { t } = useTranslation();
  const [supabase] = React.useState(() => createClient());
  const [email, setEmail] = React.useState("");
  const [testEmail, setTestEmail] = React.useState("");
  const [testPassword, setTestPassword] = React.useState("");
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

  // Only same-site paths: `next` comes from the URL, and a full URL there would send the tester off-site.
  const safeNext = () => {
    const next = nextParam();
    return next.startsWith("/") && !next.startsWith("//") ? next : "/app";
  };

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
        : { kind: "info", text: t("auth.checkEmail") },
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

  // One request, no retry. The route answers only { ok, next }; any failure gets the same message.
  async function testAccountButtonLogin(account: TestAccount) {
    setBusy(`test-${account}`);
    setMsg(null);
    let next: string | null = null;
    try {
      const response = await fetch("/api/dev/test-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account }),
      });
      const body: unknown = response.ok ? await response.json() : null;
      const candidate = body !== null && typeof body === "object" ? (body as { ok?: unknown; next?: unknown }) : null;
      if (
        candidate?.ok === true &&
        typeof candidate.next === "string" &&
        candidate.next.startsWith("/") &&
        !candidate.next.startsWith("//")
      ) {
        next = candidate.next;
      }
    } catch {
      next = null;
    }
    if (next === null) {
      setBusy(null);
      setMsg({ kind: "error", text: t("auth.testLogin.accountFailed") });
      return;
    }
    window.location.assign(next);
  }

  async function testAccountLogin(e: React.FormEvent) {
    e.preventDefault();
    const address = testEmail.trim().toLowerCase();
    if (!address.endsWith(TEST_EMAIL_DOMAIN)) {
      setMsg({ kind: "error", text: t("auth.testLogin.onlyTest") });
      return;
    }
    setBusy("test");
    setMsg(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: address,
      password: testPassword,
    });
    if (error) {
      setBusy(null);
      setMsg({ kind: "error", text: t("auth.testLogin.failed") });
      return;
    }
    window.location.assign(safeNext());
  }

  return (
    <div className="relative w-full bg-paper md:h-screen md:overflow-hidden">
      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col justify-center px-4">
        <Button variant="ghost" className="absolute left-4 top-4" asChild>
          <a href="/">
            <ChevronLeftIcon className="me-1 size-4" />
            {t("common.back")}
          </a>
        </Button>
        <div className="absolute right-4 top-4">
          <LanguageToggle />
        </div>

        <div className="mx-auto w-full space-y-5 sm:max-w-sm">
          <div className="flex items-center gap-2">
            <img src="/logo-mova.png" alt="Mova" className="h-7 w-auto" />
          </div>

          <div className="flex flex-col space-y-1">
            <h1 className="text-3xl tracking-wide">{t("auth.title")}</h1>
            <p className="text-muted-foreground text-base">{t("auth.subtitle")}</p>
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
              {t("auth.google")}
            </Button>
          </div>

          <div className="flex items-center gap-3 py-1">
            <span className="h-px flex-1 bg-border" />
            <span className="text-muted-foreground text-xs uppercase tracking-[0.2em]">
              {t("auth.or")}
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <form className="space-y-2.5" onSubmit={signInWithEmail}>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("auth.emailPlaceholder")}
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
              {t("auth.continueEmail")}
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

          {testAccountButtons && (
            <div className="space-y-2.5">
              {(["patient", "clinician"] as const).map((account) => (
                <Button
                  key={account}
                  type="button"
                  variant="secondary"
                  size="lg"
                  className="h-12 w-full"
                  disabled={busy !== null}
                  onClick={() => testAccountButtonLogin(account)}
                >
                  {busy === `test-${account}` ? <Loader2 className="me-2 size-4 animate-spin" /> : null}
                  {t(account === "patient" ? "auth.testLogin.asPatient" : "auth.testLogin.asClinician")}
                </Button>
              ))}
            </div>
          )}

          {testPasswordLogin && (
            <form
              className="space-y-2.5 rounded-md border border-dashed border-input p-3"
              onSubmit={testAccountLogin}
              aria-labelledby="test-login-title"
            >
              <div>
                <p id="test-login-title" className="text-base font-medium">
                  {t("auth.testLogin.title")}
                </p>
                <p className="text-muted-foreground text-sm">{t("auth.testLogin.hint")}</p>
              </div>
              <div className="space-y-1">
                <label htmlFor="test-login-email" className="block text-sm font-medium">
                  {t("auth.testLogin.email")}
                </label>
                <input
                  id="test-login-email"
                  type="email"
                  required
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  autoComplete="username"
                  className="bg-background focus-visible:ring-ring h-12 w-full rounded-md border border-input px-3 text-base outline-none transition focus-visible:ring-2"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="test-login-password" className="block text-sm font-medium">
                  {t("auth.testLogin.password")}
                </label>
                <input
                  id="test-login-password"
                  type="password"
                  required
                  value={testPassword}
                  onChange={(e) => setTestPassword(e.target.value)}
                  autoComplete="current-password"
                  className="bg-background focus-visible:ring-ring h-12 w-full rounded-md border border-input px-3 text-base outline-none transition focus-visible:ring-2"
                />
              </div>
              <Button
                type="submit"
                variant="secondary"
                size="lg"
                className="w-full"
                disabled={busy !== null}
              >
                {busy === "test" ? (
                  <Loader2 className="me-2 size-4 animate-spin" />
                ) : null}
                {t("auth.testLogin.submit")}
              </Button>
            </form>
          )}

          <p className="text-muted-foreground mt-8 text-sm">{t("auth.terms")}</p>
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

