import { type LucideIcon } from "lucide-react";
import Link from "next/link";

/** Placeholder body for navigational routes that are scoped but not yet built, so the sidebar never 404s. */
export default function ComingSoon({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
}) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center text-center">
      <div className="grid size-14 place-items-center rounded-2xl bg-paper-soft text-ink-soft ring-1 ring-line">
        <Icon className="size-6" strokeWidth={1.6} />
      </div>
      <div className="mt-5 font-mono text-[11px] uppercase tracking-[0.22em] text-signal">Coming soon</div>
      <h1 className="mt-2 font-serif text-3xl italic text-ink">{title}</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">{description}</p>
      <Link
        href="/app"
        className="mt-7 rounded-pill bg-night px-5 py-2.5 text-sm font-medium text-paper-soft transition-colors hover:bg-ink"
      >
        Back to Today
      </Link>
    </div>
  );
}
