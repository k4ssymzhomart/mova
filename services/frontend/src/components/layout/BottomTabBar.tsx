"use client";

// BottomTabBar — the four primary destinations, always visible below 1024px, so a patient never has to
// discover a hamburger menu to reach Plan, Progress or the care team. Hidden inside the exercise flow, which
// has its own Stop control. Settings, language and sign-out stay in the drawer.

import Link from "next/link";
import { usePathname } from "next/navigation";

import { focusRing } from "@/components/app/recipes";
import { activeHref } from "@/lib/nav/match";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/locales/client";

import { ALL_NAV, PRIMARY_NAV } from "./nav";

export default function BottomTabBar() {
  const pathname = usePathname() ?? "/app";
  const current = activeHref(pathname, ALL_NAV);
  const { t } = useTranslation();

  return (
    <nav
      aria-label={t("nav.primary")}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="mx-auto grid max-w-xl grid-cols-4">
        {PRIMARY_NAV.map((item) => {
          const active = current === item.href;
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-[4.25rem] flex-col items-center justify-center gap-1 px-0.5 py-2 text-center text-sm leading-tight transition-colors",
                  focusRing,
                  "focus-visible:ring-inset focus-visible:ring-offset-0",
                  active
                    ? "font-semibold text-signal-deep before:absolute before:inset-x-4 before:top-0 before:h-1 before:rounded-b-full before:bg-signal"
                    : "text-ink-soft hover:text-ink",
                )}
              >
                <Icon className="size-6 shrink-0" strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
                <span className="max-w-full hyphens-auto [overflow-wrap:anywhere]">{t(item.labelKey)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
