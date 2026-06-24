"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useAuth } from "@/lib/auth/AuthProvider";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/session", label: "Session" },
  { href: "/progress", label: "Progress" },
];

/** Slim patient-app header in the editorial system — shared by /session and /progress. */
export default function AppHeader({ active }: { active?: string }) {
  const { authed, isGuest, user, signOut } = useAuth();
  const router = useRouter();

  const onSignOut = async () => {
    await signOut();
    router.replace("/signin");
  };

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-shell items-center justify-between px-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-signal" />
          <span className="font-serif text-xl italic tracking-tight text-ink">Mova</span>
        </Link>
        <nav className="flex items-center gap-1">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "rounded-pill px-3.5 py-1.5 text-sm transition-colors",
                active === l.href ? "bg-paper-soft text-ink" : "text-ink-soft hover:text-ink",
              )}
            >
              {l.label}
            </Link>
          ))}
          {authed ? (
            <div className="ml-2 flex items-center gap-2">
              <span className="hidden max-w-[160px] truncate text-sm text-ink-faint sm:inline">
                {isGuest ? "Guest" : (user?.email ?? "Signed in")}
              </span>
              <button
                onClick={onSignOut}
                className="rounded-pill border border-line px-3.5 py-1.5 text-sm text-ink transition-colors hover:bg-paper-soft"
              >
                Sign out
              </button>
            </div>
          ) : (
            <Link
              href="/signin"
              className="ml-1 rounded-pill bg-night px-4 py-1.5 text-sm font-medium text-paper-soft transition-colors hover:bg-ink"
            >
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
