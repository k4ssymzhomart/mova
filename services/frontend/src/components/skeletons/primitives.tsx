// Skeleton primitives — a single shimmer language reused by every route-level loading state so each
// placeholder mirrors the real page's layout (header + the page's characteristic blocks) instead of a
// generic spinner. All blocks pulse softly on the page canvas; nothing here renders copy.

import { cn } from "@/lib/utils";

/** A soft pulsing block. Pass Tailwind sizing/spacing via className. */
export function Bar({ className }: { className?: string }) {
  return <div className={cn("rounded-pill bg-line", className)} aria-hidden="true" />;
}

/** A larger rounded surface standing in for a card/panel. */
export function Block({ className }: { className?: string }) {
  return <div className={cn("rounded-xl bg-line/60", className)} aria-hidden="true" />;
}

/** Eyebrow + headline pair that every editorial page opens with. */
export function HeaderSkeleton({ wide = false }: { wide?: boolean }) {
  return (
    <div className="space-y-3">
      <Bar className="h-3 w-40" />
      <Bar className={cn("h-10 rounded-xl", wide ? "w-3/4 max-w-2xl" : "w-2/3 max-w-md")} />
    </div>
  );
}

/** A row of equal stat tiles (the 4-up rollup grids). */
export function TileRow({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Block key={i} className="h-24" />
      ))}
    </div>
  );
}

/** Wrap a skeleton in the page's animate-pulse + vertical rhythm. */
export function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="animate-pulse space-y-8" aria-hidden="true">
      {children}
    </div>
  );
}
