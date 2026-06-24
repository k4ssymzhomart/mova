import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin?next=/app");

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="sticky top-0 z-40 border-b border-line bg-paper/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-shell items-center justify-between px-5 py-4 sm:px-8">
          <div className="flex items-center gap-5">
            <a href="/app" className="flex items-center">
              <img src="/logo-mova.png" alt="Mova" className="h-7 w-auto" />
            </a>
            <span className="hidden h-5 w-px bg-line sm:block" />
            <span className="hidden font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint sm:block">
              Training
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden text-sm text-ink-soft sm:block">
              {user.email}
            </span>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="rounded-pill border border-line px-3.5 py-2 text-sm text-ink-soft transition-colors hover:border-ink-faint hover:text-ink"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-shell px-5 py-10 sm:px-8 sm:py-14">
        {children}
      </main>
    </div>
  );
}
