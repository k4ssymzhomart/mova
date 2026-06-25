/**
 * Presentational atoms for the credibility surfaces. All pure / server-safe
 * (no hooks) so pages stay server components and ship zero client JS for content.
 */

import { Fragment, type ReactNode } from "react";

/* ------------------------------------------------------------------ */
/* RichText — tiny inline markdown: links, **bold**, `code`            */
/* ------------------------------------------------------------------ */

const TOKEN = /(\[[^\]]+\]\([^)]+\))|(\*\*[^*]+\*\*)|(`[^`]+`)/g;

export function RichText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  if (!text) return null;
  const src = text.replace(/\s+/g, " ").trim();
  const nodes: ReactNode[] = [];
  const re = new RegExp(TOKEN);
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > last) nodes.push(src.slice(last, m.index));
    const tok = m[0];
    if (m[1]) {
      const lm = tok.match(/\[([^\]]+)\]\(([^)]+)\)/)!;
      nodes.push(
        <a
          key={m.index}
          href={lm[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-signal-deep underline decoration-line underline-offset-2 transition-colors hover:decoration-signal"
        >
          {lm[1]}
        </a>,
      );
    } else if (m[2]) {
      nodes.push(
        <strong key={m.index} className="font-semibold text-ink">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else if (m[3]) {
      nodes.push(
        <code
          key={m.index}
          className="rounded bg-paper-soft px-1 py-0.5 font-mono text-[0.85em] text-ink"
        >
          {tok.slice(1, -1)}
        </code>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < src.length) nodes.push(src.slice(last));
  return (
    <span className={className}>
      {nodes.map((n, i) => (
        <Fragment key={i}>{n}</Fragment>
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Section — an anchored block with a serif heading (matches TOC ids)  */
/* ------------------------------------------------------------------ */

export function Section({
  id,
  title,
  kicker,
  children,
}: {
  id: string;
  title: string;
  kicker?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-28 pt-14 first:pt-0">
      <div className="border-b border-line pb-4">
        {kicker && (
          <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-signal">
            {kicker}
          </div>
        )}
        <h2 className="text-[clamp(1.7rem,3.4vw,2.4rem)] leading-tight tracking-tight text-ink">
          {title}
        </h2>
      </div>
      <div className="mt-7 space-y-7">{children}</div>
    </section>
  );
}

export function Lede({ children }: { children: ReactNode }) {
  return (
    <p className="max-w-2xl text-[1.05rem] leading-relaxed text-ink-soft">
      {children}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Badge                                                               */
/* ------------------------------------------------------------------ */

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "signal" | "warn";
}) {
  const tones = {
    neutral: "border-line bg-paper-soft text-ink-soft",
    signal: "border-signal/30 bg-signal/10 text-signal-deep",
    warn: "border-amber-500/30 bg-amber-50 text-amber-700",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 font-mono text-[11px] font-medium uppercase tracking-[0.08em] ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* StatCard — headline number with label + caption                     */
/* ------------------------------------------------------------------ */

export function StatCard({
  value,
  label,
  caption,
  tone = "default",
}: {
  value: ReactNode;
  label: string;
  caption?: string;
  tone?: "default" | "signal";
}) {
  return (
    <div
      className={`rounded-card border p-5 ${
        tone === "signal"
          ? "border-signal/25 bg-signal/[0.04]"
          : "border-line bg-card"
      }`}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
        {label}
      </div>
      <div className="tnum mt-2 text-[2rem] leading-none text-ink">
        {value}
      </div>
      {caption && (
        <div className="mt-2 text-[13px] leading-snug text-ink-soft">
          {caption}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* KeyVal — definition row list                                        */
/* ------------------------------------------------------------------ */

export function KeyVal({ items }: { items: { k: string; v: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-line overflow-hidden rounded-card border border-line bg-card">
      {items.map((it, i) => (
        <div
          key={i}
          className="grid grid-cols-[minmax(0,9rem)_1fr] gap-4 px-4 py-3 sm:grid-cols-[minmax(0,11rem)_1fr]"
        >
          <dt className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-faint">
            {it.k}
          </dt>
          <dd className="text-[14px] leading-relaxed text-ink">{it.v}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------------ */
/* DataTable — data-dense, tabular numerics                            */
/* ------------------------------------------------------------------ */

export type Col = {
  key: string;
  label: string;
  align?: "left" | "right";
  mono?: boolean;
};

export function DataTable({
  cols,
  rows,
  caption,
}: {
  cols: Col[];
  rows: Record<string, ReactNode>[];
  caption?: string;
}) {
  return (
    <figure className="overflow-hidden rounded-card border border-line bg-card">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line bg-paper-soft/60">
              {cols.map((c) => (
                <th
                  key={c.key}
                  className={`whitespace-nowrap px-4 py-3 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-ink-faint ${
                    c.align === "right" ? "text-right" : "text-left"
                  }`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r, i) => (
              <tr key={i} className="transition-colors hover:bg-paper-soft/40">
                {cols.map((c) => (
                  <td
                    key={c.key}
                    className={`whitespace-nowrap px-4 py-3 text-ink ${
                      c.align === "right" ? "text-right" : "text-left"
                    } ${c.mono ? "tnum font-mono" : ""}`}
                  >
                    {r[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {caption && (
        <figcaption className="border-t border-line px-4 py-2.5 text-[12px] text-ink-faint">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Bar — a horizontal magnitude bar (0..1 scaled)                      */
/* ------------------------------------------------------------------ */

export function Bar({
  value,
  max = 1,
  label,
  display,
  tone = "signal",
}: {
  value: number;
  max?: number;
  label: string;
  display: string;
  tone?: "signal" | "muted";
}) {
  const w = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="flex items-center gap-3">
      <div className="w-36 shrink-0 truncate text-[13px] text-ink-soft">
        {label}
      </div>
      <div className="h-2 flex-1 overflow-hidden rounded-pill bg-paper-soft">
        <div
          className={`h-full rounded-pill ${
            tone === "signal" ? "bg-signal" : "bg-ink-faint"
          }`}
          style={{ width: `${w}%` }}
        />
      </div>
      <div className="tnum w-14 shrink-0 text-right font-mono text-[12px] text-ink">
        {display}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Callout — bordered note                                             */
/* ------------------------------------------------------------------ */

export function Callout({
  title,
  children,
  tone = "neutral",
}: {
  title?: string;
  children: ReactNode;
  tone?: "neutral" | "signal";
}) {
  return (
    <div
      className={`rounded-card border-l-2 py-4 pl-5 pr-4 ${
        tone === "signal"
          ? "border-l-signal bg-signal/[0.04]"
          : "border-l-ink-faint bg-paper-soft/50"
      }`}
    >
      {title && (
        <div className="mb-1 text-[13px] font-semibold text-ink">{title}</div>
      )}
      <div className="text-[13.5px] leading-relaxed text-ink-soft">
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* CodeBlock — monospace command / payload block                       */
/* ------------------------------------------------------------------ */

export function CodeBlock({
  children,
  label,
}: {
  children: string;
  label?: string;
}) {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-night">
      {label && (
        <div className="border-b border-white/10 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">
          {label}
        </div>
      )}
      <pre className="overflow-x-auto px-4 py-3.5">
        <code className="font-mono text-[12.5px] leading-relaxed text-white/85">
          {children}
        </code>
      </pre>
    </div>
  );
}

/* Prose paragraph helper for body copy inside sections. */
export function P({ children }: { children: ReactNode }) {
  return (
    <p className="max-w-2xl text-[15px] leading-relaxed text-ink-soft">
      {children}
    </p>
  );
}
