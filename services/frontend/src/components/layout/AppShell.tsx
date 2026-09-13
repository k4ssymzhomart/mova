"use client";

// AppShell — the persistent chrome of the patient app.
//  - Desktop: a fixed rail (74px collapsed / 260px expanded, persisted in localStorage) and a sticky
//    patient-context bar (post-operative day + operated side) at the top of the content column. The context
//    lives outside the rail so collapsing it never hides clinical context.
//  - Mobile: a sticky top bar carrying the same context plus a labelled Menu button for the drawer, and a
//    bottom tab bar with the four primary destinations (hidden inside the exercise flow).
//  - The drawer closes on navigation and on Escape and locks body scroll. While closed it is invisible and
//    inert in the rendered markup itself, so its links are never in the tab order or the accessibility tree
//    before hydration either; while open, the page behind it is inert instead.
//  - The НТЗ §15 slot: while RED is raised, SafetyStopPanel replaces the page content.

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { focusRing } from "@/components/app/recipes";
import type { PatientContext } from "@/lib/patient/context";
import { SafetyProvider, useSafety } from "@/lib/safety/SafetyProvider";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/locales/client";

import BottomTabBar from "./BottomTabBar";
import PatientContextBar from "./PatientContextBar";
import SafetyStopPanel from "./SafetyStopPanel";
import SidebarNav from "./SidebarNav";

const COLLAPSE_KEY = "mova.sidebar.collapsed";

// @types/react 18 has no `inert` prop; React 18.3 passes the attribute through as written.
const INERT = { inert: "" } as Record<string, string>;

interface ShellProps {
  name: string;
  context: PatientContext;
  children: ReactNode;
}

export default function AppShell(props: ShellProps) {
  return (
    <SafetyProvider>
      <Shell {...props} />
    </SafetyProvider>
  );
}

function Shell({ name, context, children }: ShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname() ?? "/app";
  const { t } = useTranslation();
  const { state: safety } = useSafety();
  const inFlow = pathname.startsWith("/app/session/");

  const drawerRef = useRef<HTMLDivElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Hydrate the persisted rail state.
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* storage unavailable: stay expanded */
    }
  }, []);

  // Scroll padding for the sticky and fixed bars (globals.css), so focus never lands underneath them.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("app-shell");
    root.classList.toggle("app-flow", inFlow);
    return () => root.classList.remove("app-shell", "app-flow");
  }, [inFlow]);

  // Close the drawer whenever the route changes.
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

  // Focus moves into the drawer on open, and back to the Menu button on close if it was left inside the drawer
  // (making the drawer inert drops that focus to <body>).
  useEffect(() => {
    if (mobileOpen) {
      drawerCloseRef.current?.focus();
    } else if (wasOpen.current) {
      const active = document.activeElement;
      if (!active || active === document.body || drawerRef.current?.contains(active)) menuButtonRef.current?.focus();
    }
    wasOpen.current = mobileOpen;
  }, [mobileOpen]);

  // Escape closes the drawer; so does widening past the breakpoint where it no longer exists.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    const wide = window.matchMedia("(min-width: 1024px)");
    const onWide = () => {
      if (wide.matches) setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    wide.addEventListener("change", onWide);
    return () => {
      window.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", onWide);
    };
  }, [mobileOpen]);

  function toggleCollapse() {
    setCollapsed((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* storage unavailable: the choice lasts for this page only */
      }
      return next;
    });
  }

  const railW = collapsed ? "lg:w-[74px]" : "lg:w-[260px]";
  const contentPad = collapsed ? "lg:pl-[74px]" : "lg:pl-[260px]";
  // The max-width tracks the rail, so collapsing it reflows content into the reclaimed width.
  const maxW = collapsed ? "max-w-[1180px] lg:max-w-[1560px]" : "max-w-[1180px]";

  return (
    <div className="min-h-[100dvh] bg-paper-soft text-ink">
      <div {...(mobileOpen ? INERT : {})}>
        <a
          href="#main"
          className={cn(
            "sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-pill focus:bg-night focus:px-5 focus:py-3 focus:text-base focus:text-paper",
            focusRing,
          )}
        >
          {t("shell.skipToContent")}
        </a>

        {/* mobile top bar: clinical context + Menu */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-card px-4 py-2.5 lg:hidden [@media(max-height:500px)]:static">
          <PatientContextBar context={context} layout="stacked" className="min-w-0 flex-1" />
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-expanded={mobileOpen}
            aria-controls="app-drawer"
            className={cn(
              "inline-flex min-h-12 shrink-0 items-center gap-2 rounded-pill border border-line px-4 text-base font-medium text-ink transition-colors hover:bg-paper-soft",
              focusRing,
            )}
          >
            <Menu className="size-5" strokeWidth={1.8} aria-hidden="true" />
            {t("shell.menu")}
          </button>
        </header>

        {/* desktop rail */}
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-30 hidden border-r border-line bg-card transition-[width] duration-300 ease-editorial lg:block",
            railW,
          )}
        >
          <SidebarNav collapsed={collapsed} name={name} onToggleCollapse={toggleCollapse} />
        </aside>

        <div className={cn("transition-[padding] duration-300 ease-editorial", contentPad)}>
          {/* desktop context bar */}
          <div className="sticky top-0 z-20 hidden border-b border-line bg-card lg:block [@media(max-height:500px)]:static">
            <div className={cn("mx-auto w-full px-12 py-3 transition-[max-width] duration-300 ease-editorial", maxW)}>
              <PatientContextBar context={context} layout="inline" />
            </div>
          </div>

          <main
            id="main"
            tabIndex={-1}
            className={cn(
              "mx-auto w-full px-5 py-8 transition-[max-width] duration-300 ease-editorial focus:outline-none sm:px-8 lg:px-12 lg:py-12",
              maxW,
              inFlow ? "pb-12" : "pb-32 lg:pb-12",
            )}
          >
            {safety.level === "red" ? <SafetyStopPanel /> : children}
          </main>
        </div>

        {!inFlow && <BottomTabBar />}
      </div>

      {/* mobile drawer */}
      <div
        ref={drawerRef}
        id="app-drawer"
        role={mobileOpen ? "dialog" : undefined}
        aria-modal={mobileOpen || undefined}
        aria-label={t("shell.menu")}
        {...(mobileOpen ? {} : INERT)}
        className={cn(
          "fixed inset-0 z-50 transition-[visibility] duration-300 lg:hidden",
          mobileOpen ? "visible" : "invisible pointer-events-none",
        )}
      >
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => setMobileOpen(false)}
          className={cn(
            "absolute inset-0 bg-ink/30 transition-opacity duration-300",
            mobileOpen ? "opacity-100" : "opacity-0",
          )}
        />
        <div
          className={cn(
            "absolute inset-y-0 left-0 flex w-80 max-w-[88%] flex-col border-r border-line bg-card shadow-2xl transition-transform duration-300 ease-editorial",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
            <Link
              href="/app"
              onClick={() => setMobileOpen(false)}
              className={cn("flex items-center rounded-lg p-1", focusRing)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-mova.png" alt="Mova" className="h-7 w-auto" />
            </Link>
            <button
              ref={drawerCloseRef}
              type="button"
              onClick={() => setMobileOpen(false)}
              className={cn(
                "inline-flex min-h-12 items-center gap-2 rounded-pill px-4 text-base text-ink-soft transition-colors hover:bg-paper-soft hover:text-ink",
                focusRing,
              )}
            >
              <X className="size-5" strokeWidth={1.8} aria-hidden="true" />
              {t("shell.closeMenu")}
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <SidebarNav
              collapsed={false}
              name={name}
              showBrand={false}
              navLabel={t("shell.menu")}
              onNavigate={() => setMobileOpen(false)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
