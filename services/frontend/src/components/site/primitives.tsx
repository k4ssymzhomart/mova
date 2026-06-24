"use client";

import {
  motion,
  useInView,
  useMotionValue,
  useSpring,
  type Variants,
} from "framer-motion";
import { ArrowDownRight } from "lucide-react";
import {
  forwardRef,
  useEffect,
  useRef,
  type ReactNode,
} from "react";

const EASE = [0.16, 1, 0.3, 1] as const;

/* ------------------------------------------------------------------ */
/* Scroll reveal                                                       */
/* ------------------------------------------------------------------ */

export function Reveal({
  children,
  delay = 0,
  y = 24,
  className,
  once = true,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  once?: boolean;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, margin: "-12% 0px -12% 0px" }}
      transition={{ duration: 0.9, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

/** Word-by-word rise used for big editorial headings. */
export function RevealWords({
  text,
  className,
  delay = 0,
}: {
  text: string;
  className?: string;
  delay?: number;
}) {
  const words = text.split(" ");
  const container: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: 0.05, delayChildren: delay } },
  };
  const child: Variants = {
    hidden: { opacity: 0, y: "0.5em" },
    show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: EASE } },
  };
  return (
    <motion.span
      className={className}
      variants={container}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-10% 0px" }}
      style={{ display: "inline" }}
    >
      {words.map((w, i) => (
        <span
          key={i}
          style={{ display: "inline-block", overflow: "hidden", verticalAlign: "top" }}
        >
          <motion.span variants={child} style={{ display: "inline-block" }}>
            {w}
            {i < words.length - 1 ? " " : ""}
          </motion.span>
        </span>
      ))}
    </motion.span>
  );
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

type ArrowButtonProps = {
  children: ReactNode;
  href?: string;
  variant?: "dark" | "light" | "ghost" | "signal";
  className?: string;
  block?: boolean;
};

export function ArrowButton({
  children,
  href = "#",
  variant = "dark",
  className = "",
  block = false,
}: ArrowButtonProps) {
  const styles: Record<string, string> = {
    dark: "bg-night text-paper-soft hover:bg-ink",
    light: "bg-card text-ink border border-line hover:bg-paper-soft",
    ghost: "bg-white/10 text-white border border-white/20 hover:bg-white/20",
    signal: "bg-signal text-white hover:bg-signal-bright",
  };
  return (
    <a
      href={href}
      className={`group relative inline-flex items-center justify-between gap-10 overflow-hidden rounded-pill px-5 py-4 text-sm font-medium transition-all duration-300 hover:-translate-y-0.5 ${
        styles[variant]
      } ${block ? "w-full" : ""} ${className}`}
    >
      <span className="relative z-10">{children}</span>
      <span className="relative z-10 transition-transform duration-500 ease-editorial group-hover:translate-x-1 group-hover:translate-y-1">
        <ArrowDownRight className="h-4 w-4" strokeWidth={1.6} />
      </span>
    </a>
  );
}

/* ------------------------------------------------------------------ */
/* Section tag / kicker                                                */
/* ------------------------------------------------------------------ */

export function Kicker({
  children,
  light = false,
}: {
  children: ReactNode;
  light?: boolean;
}) {
  return (
    <span
      className={`text-[11px] font-medium uppercase tracking-[0.22em] ${
        light ? "text-white/60" : "text-ink-faint"
      }`}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Count-up number                                                     */
/* ------------------------------------------------------------------ */

export const CountUp = forwardRef<
  HTMLSpanElement,
  { value: number; suffix?: string; className?: string }
>(function CountUp({ value, suffix = "", className }, _ref) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-20% 0px" });
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { duration: 1.6, bounce: 0 });

  useEffect(() => {
    if (inView) mv.set(value);
  }, [inView, value, mv]);

  useEffect(() => {
    return spring.on("change", (v) => {
      if (ref.current) {
        ref.current.textContent =
          Math.round(v).toLocaleString("en-US") + suffix;
      }
    });
  }, [spring, suffix]);

  return (
    <span ref={ref} className={className}>
      0{suffix}
    </span>
  );
});

export { EASE };
