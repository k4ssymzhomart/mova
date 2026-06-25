"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import LanguageToggle from "@/components/LanguageToggle";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useTranslation } from "@/locales/client";

/** Clinician-portal header — the editorial system, distinguished from the patient app by a "Clinic" tag. */
export default function ClinicHeader() {
  const { authed, isGuest, user, signOut } = useAuth();
  const router = useRouter();
  const { t } = useTranslation();

  const onSignOut = async () => {
    await signOut();
    router.replace("/signin");
  };

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur-md print:hidden">
      <div className="mx-auto flex h-16 max-w-shell items-center justify-between px-5 sm:px-8">
        <Link href="/clinician" className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mova.png" alt="Mova" className="h-7 w-auto" />
          <span className="rounded-pill border border-line bg-paper-soft px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-ink-faint">
            {t("clinician.header.clinic")}
          </span>
        </Link>
        <nav className="flex items-center gap-1">
          <Link href="/clinician" className="rounded-pill px-3.5 py-1.5 text-sm text-ink-soft transition-colors hover:text-ink">
            {t("clinician.header.caseload")}
          </Link>
          <Link href="/app" className="rounded-pill px-3.5 py-1.5 text-sm text-ink-soft transition-colors hover:text-ink">
            {t("clinician.header.patientApp")}
          </Link>
          <LanguageToggle className="ml-1" />
          {authed ? (
            <div className="ml-2 flex items-center gap-2">
              <span className="hidden max-w-[180px] truncate text-sm text-ink-faint sm:inline">
                {isGuest ? t("clinician.header.demoClinician") : (user?.email ?? t("clinician.header.signedIn"))}
              </span>
              <button
                onClick={onSignOut}
                className="rounded-pill border border-line px-3.5 py-1.5 text-sm text-ink transition-colors hover:bg-paper-soft"
              >
                {t("clinician.header.signOut")}
              </button>
            </div>
          ) : (
            <Link href="/signin" className="ml-1 rounded-pill bg-night px-4 py-1.5 text-sm font-medium text-paper-soft transition-colors hover:bg-ink">
              {t("clinician.header.signIn")}
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
