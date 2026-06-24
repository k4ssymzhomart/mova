"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useAuth } from "@/lib/auth/AuthProvider";

/** Clinician-portal header — the editorial system, distinguished from the patient app by a "Clinic" tag. */
export default function ClinicHeader() {
  const { authed, isGuest, user, signOut } = useAuth();
  const router = useRouter();

  const onSignOut = async () => {
    await signOut();
    router.replace("/signin");
  };

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur-md print:hidden">
      <div className="mx-auto flex h-16 max-w-shell items-center justify-between px-5 sm:px-8">
        <Link href="/clinician" className="flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-signal" />
          <span className="font-serif text-xl italic tracking-tight text-ink">Mova</span>
          <span className="rounded-pill border border-line bg-paper-soft px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-ink-faint">
            Clinic
          </span>
        </Link>
        <nav className="flex items-center gap-1">
          <Link href="/clinician" className="rounded-pill px-3.5 py-1.5 text-sm text-ink-soft transition-colors hover:text-ink">
            Caseload
          </Link>
          <Link href="/session" className="rounded-pill px-3.5 py-1.5 text-sm text-ink-soft transition-colors hover:text-ink">
            Patient app
          </Link>
          {authed ? (
            <div className="ml-2 flex items-center gap-2">
              <span className="hidden max-w-[180px] truncate text-sm text-ink-faint sm:inline">
                {isGuest ? "Demo clinician" : (user?.email ?? "Signed in")}
              </span>
              <button
                onClick={onSignOut}
                className="rounded-pill border border-line px-3.5 py-1.5 text-sm text-ink transition-colors hover:bg-paper-soft"
              >
                Sign out
              </button>
            </div>
          ) : (
            <Link href="/signin" className="ml-1 rounded-pill bg-night px-4 py-1.5 text-sm font-medium text-paper-soft transition-colors hover:bg-ink">
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
