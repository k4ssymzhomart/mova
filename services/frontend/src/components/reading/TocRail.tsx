"use client";

import { useEffect, useState } from "react";

export type TocItem = { id: string; label: string; hint?: string };

/**
 * Sticky table-of-contents rail with scroll-spy. Highlights the section nearest
 * the top of the viewport. Hidden below lg (the reading column stands alone).
 */
export default function TocRail({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState(items[0]?.id ?? "");

  useEffect(() => {
    const targets = items
      .map((i) => document.getElementById(i.id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (!targets.length) return;

    const onScroll = () => {
      const probe = 140; // px from top
      let current = targets[0].id;
      for (const el of targets) {
        if (el.getBoundingClientRect().top - probe <= 0) current = el.id;
      }
      setActive(current);
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [items]);

  return (
    <nav className="hidden lg:block">
      <div className="sticky top-28">
        <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-faint">
          On this page
        </div>
        <ul className="space-y-0.5">
          {items.map((it) => {
            const on = active === it.id;
            return (
              <li key={it.id}>
                <a
                  href={`#${it.id}`}
                  className={`block border-l-2 py-1.5 pl-3 text-[13px] leading-snug transition-colors ${
                    on
                      ? "border-signal font-medium text-ink"
                      : "border-line text-ink-soft hover:border-ink-faint hover:text-ink"
                  }`}
                >
                  {it.label}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
