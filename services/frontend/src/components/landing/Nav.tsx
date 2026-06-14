import Link from "next/link";

/** Minimal sticky navbar: mova wordmark + section anchors + console CTA. */
export default function Nav() {
  return (
    <nav className="sticky top-0 z-50 border-b border-black/[0.04] bg-white/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-[3px] bg-zinc-900" />
          <span className="text-[15px] font-semibold tracking-tight text-zinc-900">mova</span>
        </Link>
        <div className="flex items-center gap-7">
          <a
            href="#ingestion"
            className="hidden text-sm text-zinc-600 transition-colors hover:text-zinc-900 sm:block"
          >
            Capture
          </a>
          <a
            href="#architecture"
            className="hidden text-sm text-zinc-600 transition-colors hover:text-zinc-900 sm:block"
          >
            Engine
          </a>
          <Link
            href="/dashboard"
            className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5"
          >
            Open console
          </Link>
        </div>
      </div>
    </nav>
  );
}
