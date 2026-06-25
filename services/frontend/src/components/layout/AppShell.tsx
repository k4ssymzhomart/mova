"use client";

// AppShell — the persistent layout for the authenticated patient app (Part 2.B of the master doc).
// A collapsible left sidebar on a soft gray canvas, with the page content floating inside a large white
// rounded-3xl card so the canvas peeks through the gaps (the "spatial" feel). On small screens the
// sidebar becomes a hamburger drawer. Collapse state persists across sessions; the streak ring is
// derived from the local session history.

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
  children,
}: {
  name: string;
  email: string;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [streak, setStreak] = useState(0);
  const pathname = usePathname();

  // Hydrate persisted UI state + derive the streak from local history (client-only).
  useEffect(() => {
    setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    setStreak(computeStreak(loadSessions()));
  }, []);

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

  return (
    <div className="min-h-[100dvh] bg-paper-soft text-ink">
      {/* mobile top bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-paper-soft/90 px-4 py-3 backdrop-blur-md lg:hidden">
        <Link href="/app" className="flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mova.png" alt="Mova" className="h-7 w-auto" />
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="grid size-9 place-items-center rounded-xl text-ink-soft transition-colors hover:bg-card hover:text-ink"
        >
          <Menu className="size-5" strokeWidth={1.8} />
        </button>
      </div>

      <div className="flex">
        {/* desktop sidebar */}
        <aside
          className={cn(
            "sticky top-0 hidden h-[100dvh] shrink-0 transition-[width] duration-300 ease-editorial lg:block",
            collapsed ? "w-[76px]" : "w-64",
          )}
        >
          <SidebarNav collapsed={collapsed} name={name} streak={streak} onToggleCollapse={toggleCollapse} />
        </aside>

        {/* main content — a floating white card on the gray canvas */}
        <div className="min-w-0 flex-1 p-3 sm:p-4 lg:py-4 lg:pl-1 lg:pr-4">
          <main className="min-h-[calc(100dvh-1.5rem)] rounded-3xl bg-card p-5 shadow-sm ring-1 ring-line/60 sm:p-7 lg:min-h-[calc(100dvh-2rem)] lg:p-10">
            {children}
          </main>
        </div>
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
            "absolute inset-y-0 left-0 flex w-72 max-w-[82%] flex-col bg-paper-soft shadow-2xl transition-transform duration-300 ease-editorial",
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
              className="grid size-9 place-items-center rounded-xl text-ink-soft transition-colors hover:bg-card hover:text-ink"
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
