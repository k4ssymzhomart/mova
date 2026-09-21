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
export const bodyText = "max-w-measure text-base leading-relaxed text-ink-soft";
export const tileLabel = "text-sm font-medium text-ink-soft";
export const metricValue = "tnum text-3xl font-semibold text-ink";

export const card = "rounded-card border border-line bg-card";

// Layout recipes. A page composes from these; it does not write its own frame, grid or rhythm. Card grids measure
// the column they sit in rather than the window, so a card never gets smaller when the window gets wider.

/** The page frame: the patient <main>, the context bar above it, and every clinician <main>. */
export const appFrame = "mx-auto w-full max-w-app px-5 sm:px-8 lg:px-12";

/** The task frame: the session flow, where one column is the whole job. */
export const flowFrame = "mx-auto w-full max-w-flow px-5 sm:px-8 lg:px-12";

/** Between the top-level bands of a page. The only vertical rhythm a page sets. */
export const pageFlow = "space-y-10 lg:space-y-14";

/** The masthead: eyebrow and title on the left, the lead at its own measure on the right, one rule under both. */
export const pageMasthead =
  "border-b border-line pb-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-end lg:gap-x-12 lg:pb-8";

/** A section heading with its count beside it. Never justified apart: the frame is wide. */
export const sectionHead = "flex flex-wrap items-baseline gap-x-4 gap-y-1";

export const mediaCardGrid = "grid gap-4 grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))]";
export const cardGrid = "grid gap-4 grid-cols-[repeat(auto-fill,minmax(min(100%,24rem),1fr))]";
export const personGrid = "grid gap-4 grid-cols-[repeat(auto-fill,minmax(min(100%,28rem),1fr))]";
export const tileGrid = "grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))]";

/** The instrument: the exercise the patient came to do. Picture on one side, decision on the other. */
export const instrumentCard =
  "grid overflow-hidden rounded-card border border-line bg-card sm:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]";
export const instrumentBody = "flex flex-col items-stretch p-6 sm:items-start sm:justify-center sm:p-10";

/** A notice that is one message rather than a page: label column on the left, message at its measure. */
export const noticeBand =
  "rounded-card border border-line bg-card p-5 sm:p-6 lg:grid lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] lg:gap-x-8";

export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-deep focus-visible:ring-offset-2 focus-visible:ring-offset-paper-soft";

export const primaryButton = `inline-flex min-h-12 items-center justify-center gap-2 rounded-pill bg-signal-deep px-6 text-base font-medium text-white transition-colors hover:bg-ink disabled:cursor-not-allowed disabled:bg-ink-soft ${focusRing}`;

export const secondaryButton = `inline-flex min-h-12 items-center justify-center gap-2 rounded-pill border border-line bg-card px-5 text-base font-medium text-ink transition-colors hover:bg-paper-soft disabled:cursor-not-allowed disabled:text-ink-soft ${focusRing}`;

export const textLink = `rounded-sm text-signal-deep underline underline-offset-4 hover:text-ink ${focusRing}`;
