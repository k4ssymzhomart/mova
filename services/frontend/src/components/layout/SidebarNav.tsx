"use client";

// SidebarNav — the patient app's navigation, shared by the desktop rail and the mobile drawer. Four primary
// destinations; Settings, the language switch and sign-out live in the footer. On desktop the rail collapses
// to icons, and each label stays in the accessibility tree as sr-only text so collapsed links keep a name.
// The active item carries four cues at once: background, weight, an edge bar and aria-current.

import { LogOut, PanelLeft, PanelLeftClose } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { focusRing } from "@/components/app/recipes";
import LanguageToggle from "@/components/LanguageToggle";
import { activeHref } from "@/lib/nav/match";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/locales/client";

import { ALL_NAV, FOOTER_NAV, type NavItem, PRIMARY_NAV } from "./nav";

function rowClass(collapsed: boolean) {
  return cn(
    "relative flex min-h-12 items-center gap-3 rounded-lg px-3 text-base transition-colors duration-200 ease-editorial",
    focusRing,
    collapsed && "justify-center px-0",
  );
}

export default function SidebarNav({
  collapsed,
  name,
  showBrand = true,
  navLabel,
  onToggleCollapse,
  onNavigate,
}: {
  collapsed: boolean;
  name: string;
  showBrand?: boolean;
  navLabel?: string;
  onToggleCollapse?: () => void;
  onNavigate?: () => void;
}) {
  const pathname = usePathname() ?? "/app";
  const current = activeHref(pathname, ALL_NAV);
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col">
      {(showBrand || onToggleCollapse) && (
        <div className={cn("flex items-center px-3 pb-3 pt-4", collapsed ? "justify-center" : "justify-between")}>
          {showBrand && !collapsed && (
            <Link href="/app" onClick={onNavigate} className={cn("flex items-center rounded-lg p-1", focusRing)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-mova.png" alt="Mova" className="h-7 w-auto" />
            </Link>
          )}
          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label={collapsed ? t("shell.expandSidebar") : t("shell.collapseSidebar")}
              aria-expanded={!collapsed}
              className={cn(
                "grid size-12 place-items-center rounded-lg text-ink-soft transition-colors hover:bg-paper-soft hover:text-ink",
                focusRing,
              )}
            >
              {collapsed ? (
                <PanelLeft className="size-5" strokeWidth={1.8} aria-hidden="true" />
              ) : (
                <PanelLeftClose className="size-5" strokeWidth={1.8} aria-hidden="true" />
              )}
            </button>
          )}
        </div>
      )}

      <nav aria-label={navLabel ?? t("nav.primary")} className="flex-1 overflow-y-auto px-2 py-2">
        <ul className="space-y-1">
          {PRIMARY_NAV.map((item) => (
            <li key={item.href}>
              <NavLink item={item} active={current === item.href} collapsed={collapsed} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      </nav>

      <div className="space-y-2 border-t border-line px-2 py-3">
        {FOOTER_NAV.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={current === item.href}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        ))}
        {!collapsed && (
          <div className="px-1 pt-1">
            <LanguageToggle variant="patient" className="w-full" />
          </div>
        )}
        {!collapsed && <p className="px-3 pt-1 text-sm text-ink-soft [overflow-wrap:anywhere]">{t("nav.signedInAs", { name })}</p>}
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            title={collapsed ? t("nav.signOut") : undefined}
            className={cn(rowClass(collapsed), "w-full text-ink-soft hover:bg-paper-soft hover:text-ink")}
          >
            <LogOut className="size-5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
            <span className={collapsed ? "sr-only" : undefined}>{t("nav.signOut")}</span>
          </button>
        </form>
      </div>
    </div>
  );
}

function NavLink({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const Icon = item.icon;
  const label = t(item.labelKey);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
      className={cn(
        rowClass(collapsed),
        active
          ? "bg-signal/10 font-semibold text-signal-deep before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-full before:bg-signal"
          : "text-ink-soft hover:bg-paper-soft hover:text-ink",
      )}
    >
      <Icon className="size-5 shrink-0" strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
      <span className={collapsed ? "sr-only" : "truncate"}>{label}</span>
    </Link>
  );
}
