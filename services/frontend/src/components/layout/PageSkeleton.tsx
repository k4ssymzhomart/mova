// PageSkeleton — the shared loading placeholder for authenticated routes. Mirrors the editorial layout
// (eyebrow + title, then a card grid) so a route swap reads as "loading this page" rather than a spinner.
// Minimal: soft pulsing blocks on the page canvas, no copy.

export default function PageSkeleton() {
  return (
    <div className="animate-pulse space-y-8" aria-hidden="true">
      <div className="space-y-3">
        <div className="h-3 w-40 rounded-pill bg-line" />
        <div className="h-10 w-2/3 max-w-md rounded-xl bg-line" />
      </div>
      <div className="h-36 rounded-3xl bg-line/70" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-2xl bg-line/60" />
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 rounded-2xl bg-line/60" />
        ))}
      </div>
    </div>
  );
}
