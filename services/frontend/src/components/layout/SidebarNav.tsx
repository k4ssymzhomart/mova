"use client";

// SidebarNav — the patient-app navigation, shared by the desktop sidebar and the mobile drawer.
// Editorial/spatial language: sits on the soft gray page canvas; the active item floats up as a white
// rounded card. Collapses to icon-only on desktop. Routes that aren't built yet point at a ComingSoon
// stub (no 404) and carry a subtle "soon" marker.

import {
  Activity,
  BookOpen,
  Bluetooth,
  ClipboardList,
  Dumbbell,
  HelpCircle,
  Home,
  type LucideIcon,
  LogOut,
  PanelLeft,
  PanelLeftClose,
  Settings,
  TrendingUp,
  Trophy,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  ready: boolean;
  match?: string; // active-state prefix (defaults to href); longest match wins
  prefetch?: boolean;
}

const NAV: NavItem[] = [
  { href: "/app", label: "Today", icon: Home, ready: true, match: "/app" },
  { href: "/program", label: "My Program", icon: ClipboardList, ready: true },
  { href: "/app/session/new", label: "Train", icon: Activity, ready: true, match: "/app/session", prefetch: false },
  { href: "/exercises", label: "Exercises", icon: Dumbbell, ready: true },
  { href: "/progress", label: "Progress", icon: TrendingUp, ready: true },
  { href: "/achievements", label: "Achievements", icon: Trophy, ready: true },
  { href: "/devices", label: "Devices", icon: Bluetooth, ready: false },
  { href: "/care-team", label: "Care Team", icon: Users, ready: false },
  { href: "/learn", label: "Learn", icon: BookOpen, ready: false },
  { href: "/settings", label: "Settings", icon: Settings, ready: false },
];

/** Longest matching nav prefix wins, so /app/session/[id] highlights Train, not Today. */
function activeHref(pathname: string): string | null {
  let best: string | null = null;
  let bestLen = -1;
  for (const it of NAV) {
    const m = it.match ?? it.href;
    if ((pathname === m || pathname.startsWith(`${m}/`)) && m.length > bestLen) {
      best = it.href;
      bestLen = m.length;
    }
  }
  return best;
}

export default function SidebarNav({
  collapsed,
  name,
  streak,
  onToggleCollapse,
  onNavigate,
}: {
  collapsed: boolean;
  name: string;
  streak: number;
  onToggleCollapse?: () => void;
  onNavigate?: () => void;
}) {
  const pathname = usePathname() ?? "/app";
  const current = activeHref(pathname);

  return (
    <div className="flex h-full flex-col">
      {/* brand + collapse toggle */}
      <div className={cn("flex items-center px-3 pt-4 pb-3", collapsed ? "justify-center" : "justify-between")}>
        {!collapsed && (
          <Link href="/app" onClick={onNavigate} className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-mova.png" alt="Mova" className="h-7 w-auto" />
          </Link>
        )}
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="grid size-8 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-paper-soft hover:text-ink"
          >
            {collapsed ? (
              <PanelLeft className="size-[18px]" strokeWidth={1.7} />
            ) : (
              <PanelLeftClose className="size-[18px]" strokeWidth={1.7} />
            )}
          </button>
        )}
      </div>

      {/* profile + streak */}
      <div className={cn("mx-2 mb-2 flex items-center gap-3 rounded-2xl px-2 py-2", collapsed && "justify-center px-0")}>
        <StreakRing days={streak} initial={(name[0] ?? "M").toUpperCase()} />
        {!collapsed && (
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-ink">{name}</div>
            <div className="font-mono text-[11px] tabular-nums text-ink-faint">
              {streak > 0 ? `${streak}-day streak` : "Start your streak"}
            </div>
          </div>
        )}
      </div>

      {/* nav */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-1">
        {NAV.map((item) => {
          const active = current === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={item.prefetch}
              onClick={onNavigate}
              title={collapsed ? item.label : undefined}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-200 ease-editorial",
                collapsed && "justify-center px-0",
                active
                  ? "bg-signal/10 font-medium text-signal-deep"
                  : "text-ink-soft hover:bg-paper-soft hover:text-ink",
              )}
            >
              <Icon className="size-[18px] shrink-0" strokeWidth={active ? 2 : 1.7} />
              {!collapsed && <span className="truncate">{item.label}</span>}
              {!collapsed && !item.ready && (
                <span className="ml-auto rounded-full bg-ink/[0.06] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-ink-faint">
                  soon
                </span>
              )}
              {collapsed && !item.ready && (
                <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-ink-faint/40" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* footer */}
      <div className="mt-2 space-y-0.5 border-t border-line px-2 py-3">
        <Link
          href="/learn"
          onClick={onNavigate}
          title={collapsed ? "Help & support" : undefined}
          className={cn(
            "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-ink-soft transition-colors hover:bg-paper-soft hover:text-ink",
            collapsed && "justify-center px-0",
          )}
        >
          <HelpCircle className="size-[18px] shrink-0" strokeWidth={1.7} />
          {!collapsed && <span>Help &amp; support</span>}
        </Link>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            title={collapsed ? "Sign out" : undefined}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-ink-soft transition-colors hover:bg-card/70 hover:text-ink",
              collapsed && "justify-center px-0",
            )}
          >
            <LogOut className="size-[18px] shrink-0" strokeWidth={1.7} />
            {!collapsed && <span>Sign out</span>}
          </button>
        </form>
      </div>
    </div>
  );
}

/** A compact streak ring with the user's initial in the centre; fills over a 7-day week. */
function StreakRing({ days, initial }: { days: number; initial: string }) {
  const r = 15;
  const circ = 2 * Math.PI * r;
  const frac = days <= 0 ? 0 : Math.min(1, ((days - 1) % 7) / 7 + 1 / 7);
  return (
    <div className="relative grid size-9 shrink-0 place-items-center">
      <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
        <circle cx="18" cy="18" r={r} fill="none" stroke="#E7E5E4" strokeWidth="3" />
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          stroke="#16a35b"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - frac)}
          className="transition-[stroke-dashoffset] duration-500 ease-editorial"
        />
      </svg>
      <span className="text-[12px] font-semibold text-ink">{initial}</span>
    </div>
  );
}
