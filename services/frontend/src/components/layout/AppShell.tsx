"use client";

// AppShell — the persistent layout for the authenticated patient app.
// A FIXED, solid, un-rounded sidebar rail on the left (its own panel, flush to the viewport edge), with
// the page content flowing on an open canvas to the right — no single rounded container wrapping the
// whole page, so nothing feels "boxed in". Individual cards inside each page provide the spatial depth.
// On small screens the rail becomes a hamburger drawer. Collapse state persists; the streak is derived
// from the signed-in user's own on-device history (scoped by user id).

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { loadSessions } from "@/lib/insights/store";
import type { SessionRecord } from "@/lib/insights/types";
import { cn } from "@/lib/utils";

import SidebarNav from "./SidebarNav";

const COLLAPSE_KEY = "mova.sidebar.collapsed";

export default function AppShell({
  name,
  email: _email,
  userId,
  children,
}: {
  name: string;
  email: string;
  userId: string;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [streak, setStreak] = useState(0);
  const pathname = usePathname();

  // Hydrate persisted UI state + derive the streak from this user's own local history.
  useEffect(() => {
    setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    setStreak(computeStreak(loadSessions(userId)));
  }, [userId]);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  function toggleCollapse() {
    setCollapsed((v) => {
      const next = !v;
      window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  }

  const railW = collapsed ? "lg:w-[74px]" : "lg:w-[260px]";
  const contentPad = collapsed ? "lg:pl-[74px]" : "lg:pl-[260px]";

  return (
    <div className="min-h-[100dvh] bg-paper-soft text-ink">
      {/* mobile top bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-card/90 px-4 py-3 backdrop-blur-md lg:hidden">
        <Link href="/app" className="flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mova.png" alt="Mova" className="h-7 w-auto" />
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="grid size-9 place-items-center rounded-lg text-ink-soft transition-colors hover:bg-paper-soft hover:text-ink"
        >
          <Menu className="size-5" strokeWidth={1.8} />
        </button>
      </div>

      {/* desktop fixed rail — solid, square, flush to the edge */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden border-r border-line bg-card transition-[width] duration-300 ease-editorial lg:block",
          railW,
        )}
      >
        <SidebarNav collapsed={collapsed} name={name} streak={streak} onToggleCollapse={toggleCollapse} />
      </aside>

      {/* content — open canvas, generous gutters, no wrapping card. The max-width tracks the rail state
          so collapsing the sidebar genuinely reflows content into the reclaimed width instead of just
          widening empty gutters (data grids fill out; prose stays readable under the cap). */}
      <div className={cn("transition-[padding] duration-300 ease-editorial", contentPad)}>
        <main
          className={cn(
            "mx-auto w-full px-5 py-8 transition-[max-width] duration-300 ease-editorial sm:px-8 lg:px-12 lg:py-12",
            collapsed ? "max-w-[1180px] lg:max-w-[1560px]" : "max-w-[1180px]",
          )}
        >
          {children}
        </main>
      </div>

      {/* mobile drawer */}
      <div className={cn("fixed inset-0 z-50 lg:hidden", mobileOpen ? "" : "pointer-events-none")}>
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
          className={cn(
            "absolute inset-0 bg-ink/30 backdrop-blur-[1px] transition-opacity duration-300",
            mobileOpen ? "opacity-100" : "opacity-0",
          )}
        />
        <div
          className={cn(
            "absolute inset-y-0 left-0 flex w-72 max-w-[82%] flex-col border-r border-line bg-card shadow-2xl transition-transform duration-300 ease-editorial",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <Link href="/app" className="flex items-center" onClick={() => setMobileOpen(false)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-mova.png" alt="Mova" className="h-7 w-auto" />
            </Link>
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
              className="grid size-9 place-items-center rounded-lg text-ink-soft transition-colors hover:bg-paper-soft hover:text-ink"
            >
              <X className="size-5" strokeWidth={1.8} />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <SidebarNav collapsed={false} name={name} streak={streak} onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Consecutive-day streak ending today (or yesterday) from the local session history. */
function computeStreak(sessions: SessionRecord[]): number {
  if (sessions.length === 0) return 0;
  const days = new Set(sessions.map((s) => new Date(s.startedAt).toDateString()));
  const cursor = new Date();
  if (!days.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(cursor.toDateString())) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
