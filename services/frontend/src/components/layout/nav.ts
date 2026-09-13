// The patient app's navigation, in one place. Four primary destinations (rail, drawer and mobile tab bar)
// plus Settings as a footer utility. The exercise flow is deliberately absent: it is entered from Today, and
// every /app/session/* route highlights Today through the longest-prefix matcher. See docs/ia.md.

import { ChartLine, ClipboardList, House, type LucideIcon, Settings, Users } from "lucide-react";

import type { MatchableItem } from "@/lib/nav/match";

export interface NavItem extends MatchableItem {
  /** i18n key, resolved at render time. */
  labelKey: string;
  icon: LucideIcon;
}

export const PRIMARY_NAV: readonly NavItem[] = [
  { href: "/app", labelKey: "nav.today", icon: House },
  { href: "/program", labelKey: "nav.plan", icon: ClipboardList },
  { href: "/progress", labelKey: "nav.progress", icon: ChartLine },
  { href: "/care-team", labelKey: "nav.careTeam", icon: Users },
];

export const FOOTER_NAV: readonly NavItem[] = [{ href: "/settings", labelKey: "nav.settings", icon: Settings }];

export const ALL_NAV: readonly NavItem[] = [...PRIMARY_NAV, ...FOOTER_NAV];
