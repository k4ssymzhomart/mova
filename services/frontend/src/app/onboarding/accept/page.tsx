"use client";

// Invitation acceptance (NTZ WF-02: invite/QR onboarding with a safety notice). Outside the (app) route
// group deliberately — a person following an invite link is usually not signed in yet. Reads ?token=,
// validates it publicly (validate_invitation, no auth required), shows who's inviting them, then — once
// signed in — calls accept_invitation to attach the account to that clinic (0029_invitations.sql).

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, ShieldAlert } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

type Step = "loading" | "invalid" | "preview" | "accepting" | "done" | "error";

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<Shell><Loader2 className="mx-auto size-6 animate-spin text-ink-faint" /></Shell>}>
      <AcceptInviteInner />
    </Suspense>
  );
}

function AcceptInviteInner() {
  const params = useSearchParams();
  const token = params.get("token");
  const [step, setStep] = useState<Step>("loading");
  const [clinicName, setClinicName] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStep("invalid");
      return;
    }
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const [{ data: userData }, { data: rpcData, error: rpcError }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.rpc("validate_invitation", { p_token: token }),
      ]);
      if (cancelled) return;

      const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
      if (rpcError || !row?.valid) {
        setStep("invalid");
        return;
      }
      setClinicName(row.clinic_name ?? null);

      if (!userData.user) {
        setStep("preview");
        return;
      }

      setStep("accepting");
      const { error: acceptError } = await supabase.rpc("accept_invitation", { p_token: token });
      if (cancelled) return;
      if (acceptError) {
        setStep("error");
        return;
      }
      setStep("done");
      setTimeout(() => window.location.assign("/app"), 1200);
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (step === "loading") {
    return (
      <Shell>
        <Loader2 className="mx-auto size-6 animate-spin text-ink-faint" />
      </Shell>
    );
  }

  if (step === "invalid") {
    return (
      <Shell>
        <h1 className="text-xl text-ink">This invitation link isn&apos;t valid</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
          It may have expired or already been used. Ask your clinic for a new invitation.
        </p>
      </Shell>
    );
  }

  if (step === "error") {
    return (
      <Shell>
        <h1 className="text-xl text-ink">Something went wrong</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
          We couldn&apos;t connect your account to this clinic. Try opening the link again, or ask your
          clinic to resend it.
        </p>
      </Shell>
    );
  }

  if (step === "accepting") {
    return (
      <Shell>
        <Loader2 className="mx-auto size-6 animate-spin text-signal" />
        <p className="mt-3 text-[13px] text-ink-soft">Connecting your account{clinicName ? ` to ${clinicName}` : ""}…</p>
      </Shell>
    );
  }

  if (step === "done") {
    return (
      <Shell>
        <CheckCircle2 className="mx-auto size-8 text-signal" strokeWidth={1.6} />
        <h1 className="mt-3 text-xl text-ink">You&apos;re connected{clinicName ? ` to ${clinicName}` : ""}</h1>
        <p className="mt-2 text-[13px] text-ink-soft">Taking you to your program…</p>
      </Shell>
    );
  }

  // preview — not signed in yet
  const here = typeof window !== "undefined" ? window.location.pathname + window.location.search : "/onboarding/accept";
  return (
    <Shell>
      <h1 className="text-xl text-ink">You&apos;re invited{clinicName ? ` to join ${clinicName}` : ""}</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
        Sign in or create an account to accept. Your program, sensors, and progress will be set up under
        this clinic once you do.
      </p>
      <div className="mt-4 flex items-start gap-2 rounded-lg bg-amber-500/10 px-4 py-3 text-left text-[12px] leading-relaxed text-amber-700">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.9} />
        Only accept an invitation link from a clinic or clinician you recognize and trust.
      </div>
      <a
        href={`/signin?next=${encodeURIComponent(here)}`}
        className="mt-5 inline-flex items-center justify-center gap-2 rounded-pill bg-signal px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-signal-bright"
      >
        Continue
      </a>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper-soft px-4">
      <div className="w-full max-w-sm rounded-card border border-line bg-card p-7 text-center shadow-soft">
        {children}
      </div>
    </div>
  );
}
