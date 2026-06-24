"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuth } from "@/lib/auth/AuthProvider";

/** Gate the patient product. Unauthenticated, non-guest visitors are bounced to /signin. */
export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { loading, authed } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !authed) router.replace(`/signin?returnTo=${encodeURIComponent(pathname)}`);
  }, [loading, authed, pathname, router]);

  if (loading || !authed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <div className="flex items-center gap-2.5 text-ink-faint">
          <span className="h-2 w-2 animate-pulse rounded-full bg-signal" />
          <span className="font-mono text-xs uppercase tracking-[0.2em]">Checking session…</span>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
