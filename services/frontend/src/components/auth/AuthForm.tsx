"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Particles } from "@/components/ui/particles";
import { useAuth } from "@/lib/auth/AuthProvider";
import { cn } from "@/lib/utils";

type Mode = "signin" | "signup";

/** One combined sign-in / create-account form. Google OAuth + email/password, with guest fallback. */
export default function AuthForm() {
  const { authed, configured, signInWithGoogle, signInWithEmail, signUpWithEmail, continueAsGuest } =
    useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const returnTo = params.get("returnTo") || "/session";

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  // Once a session (or guest) exists, leave for the product.
  useEffect(() => {
    if (authed) router.replace(returnTo);
  }, [authed, returnTo, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = mode === "signin"
      ? await signInWithEmail(email, password)
      : await signUpWithEmail(email, password);
    if (res.error) setMsg({ kind: "error", text: res.error });
    else if (res.info) setMsg({ kind: "info", text: res.info });
    setBusy(false);
  };

  const google = async () => {
    setBusy(true);
    setMsg(null);
    const res = await signInWithGoogle();
    if (res.error) setMsg({ kind: "error", text: res.error });
    setBusy(false);
  };

  const guest = () => {
    continueAsGuest();
    router.replace(returnTo);
  };

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-paper px-4">
      <Particles color="#16A35B" quantity={110} ease={26} className="absolute inset-0" />
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[52rem] w-[52rem] -translate-x-1/2 -translate-y-1/3 rounded-full blur-3xl"
        style={{ background: "radial-gradient(closest-side, rgba(22,163,91,0.12), rgba(22,163,91,0) 70%)" }}
      />

      <div className="relative w-full max-w-sm">
        <Link href="/" className="mb-8 inline-flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-signal" />
          <span className="font-serif text-2xl italic tracking-tight text-ink">Mova</span>
        </Link>

        <h1 className="font-serif text-4xl italic leading-tight text-ink">
          {mode === "signin" ? "Welcome back." : "Create your account."}
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
          One account for your sessions, progress, and personalised insights.
        </p>

        <div className="mt-7 space-y-2.5">
          <button
            onClick={google}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2.5 rounded-pill bg-night px-5 py-3.5 text-sm font-medium text-paper-soft transition-all duration-300 ease-editorial hover:-translate-y-0.5 hover:bg-ink disabled:opacity-50"
          >
            <GoogleIcon className="size-4" />
            Continue with Google
          </button>
        </div>

        <div className="my-5 flex items-center gap-3">
          <span className="h-px flex-1 bg-line" />
          <span className="text-[11px] uppercase tracking-[0.2em] text-ink-faint">or</span>
          <span className="h-px flex-1 bg-line" />
        </div>

        <form onSubmit={submit} className="space-y-2.5">
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            className="h-12 w-full rounded-card border border-line bg-card px-3.5 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-signal focus:ring-2 focus:ring-signal/20"
          />
          <input
            type="password"
            required
            minLength={6}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="h-12 w-full rounded-card border border-line bg-card px-3.5 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-signal focus:ring-2 focus:ring-signal/20"
          />
          <button
            type="submit"
            disabled={busy}
            className="h-12 w-full rounded-pill bg-signal text-sm font-medium text-white transition-all duration-300 ease-editorial hover:-translate-y-0.5 hover:bg-signal-bright disabled:opacity-50"
          >
            {busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        {msg && (
          <p
            className={cn(
              "mt-3 rounded-card border px-3.5 py-2.5 text-[13px] leading-relaxed",
              msg.kind === "error" ? "border-line bg-paper-soft text-ink" : "border-signal/40 bg-signal/5 text-signal-deep",
            )}
          >
            {msg.text}
          </p>
        )}

        <p className="mt-5 text-sm text-ink-soft">
          {mode === "signin" ? "New to Mova? " : "Already have an account? "}
          <button
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setMsg(null);
            }}
            className="font-medium text-signal-deep underline underline-offset-4 hover:text-signal"
          >
            {mode === "signin" ? "Create an account" : "Sign in"}
          </button>
        </p>

        <button
          onClick={guest}
          className="mt-6 inline-flex items-center gap-1 text-sm text-ink-faint transition-colors hover:text-ink"
        >
          Just exploring? Continue as guest →
        </button>

        {!configured && (
          <p className="mt-6 border-t border-line pt-4 text-[12px] leading-relaxed text-ink-faint">
            Google &amp; email sign-in activate once Supabase keys are set (see{" "}
            <code>.env.local.example</code>). You can explore the product as a guest now.
          </p>
        )}

        <p className="mt-6 text-[12px] leading-relaxed text-ink-faint">
          By continuing you agree to our Terms and acknowledge our Privacy Policy. Raw video and
          performance data stay on your device.
        </p>
      </div>
    </div>
  );
}

const GoogleIcon = (props: React.ComponentProps<"svg">) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M12.479,14.265v-3.279h11.049c0.108,0.571,0.164,1.247,0.164,1.979c0,2.46-0.672,5.502-2.84,7.669C18.744,22.829,16.051,24,12.483,24C5.869,24,0.308,18.613,0.308,12S5.869,0,12.483,0c3.659,0,6.265,1.436,8.223,3.307L18.392,5.62c-1.404-1.317-3.307-2.341-5.913-2.341C7.65,3.279,3.873,7.171,3.873,12s3.777,8.721,8.606,8.721c3.132,0,4.916-1.258,6.059-2.401c0.927-0.927,1.537-2.251,1.777-4.059L12.479,14.265z" />
  </svg>
);
