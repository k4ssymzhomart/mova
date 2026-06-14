"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

interface RevealProps {
  children: ReactNode;
  /** Extra classes applied alongside the `.reveal` transition. */
  className?: string;
  /** Stagger, in milliseconds, applied as a transition-delay. */
  delayMs?: number;
}

/**
 * Wraps content and eases it in (fade + upward translate) the first time it scrolls into view,
 * using an IntersectionObserver. The transition itself lives in `globals.css`.
 */
export default function Reveal({ children, className = "", delayMs = 0 }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState<boolean>(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries: IntersectionObserverEntry[]) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.18, rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      data-visible={visible}
      style={{ transitionDelay: `${delayMs}ms` }}
      className={`reveal ${className}`}
    >
      {children}
    </div>
  );
}
