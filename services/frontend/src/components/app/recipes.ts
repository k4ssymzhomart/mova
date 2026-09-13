// Type and control recipes for the patient surface. Same scale as the original mova recipes, adjusted for
// the accessibility pass (docs/ia.md → Typography):
//  - Inter with real weights, so headings carry weight instead of relying on size alone.
//  - Text colours pass WCAG 1.4.3: signal-deep is 6.34:1 on white and ink-soft 7.43:1. `signal` (3.27:1) and
//    `ink-faint` (3.44:1) stay for non-text UI only — bars, rings, borders, active states (1.4.11 needs 3:1).
//  - No text below 14px. Tile and field labels are sentence case, since all-caps is harder to read; only the
//    one-line eyebrow above a page title stays uppercase.
//  - Controls are at least 48px tall.
//  - Titles wrap anywhere, so a long unbroken name (an email local part) never runs off a 400px screen.

export const eyebrow = "text-sm font-medium uppercase tracking-[0.14em] text-signal-deep";
export const pageTitle =
  "mt-2 text-4xl font-semibold leading-tight tracking-tight text-ink [overflow-wrap:anywhere] sm:text-5xl";
export const sectionTitle = "text-2xl font-semibold leading-tight text-ink";
export const cardTitle = "text-xl font-semibold leading-tight text-ink";
export const bodyText = "text-base leading-relaxed text-ink-soft";
export const tileLabel = "text-sm font-medium text-ink-soft";
export const metricValue = "tnum text-3xl font-semibold text-ink";

export const card = "rounded-card border border-line bg-card";

export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-deep focus-visible:ring-offset-2 focus-visible:ring-offset-paper-soft";

export const primaryButton = `inline-flex min-h-12 items-center justify-center gap-2 rounded-pill bg-signal-deep px-6 text-base font-medium text-white transition-colors hover:bg-ink disabled:cursor-not-allowed disabled:bg-ink-soft ${focusRing}`;

export const secondaryButton = `inline-flex min-h-12 items-center justify-center gap-2 rounded-pill border border-line bg-card px-5 text-base font-medium text-ink transition-colors hover:bg-paper-soft disabled:cursor-not-allowed disabled:text-ink-soft ${focusRing}`;

export const textLink = `rounded-sm text-signal-deep underline underline-offset-4 hover:text-ink ${focusRing}`;
