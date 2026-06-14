import Link from "next/link";

import SectionLabel from "./SectionLabel";

/** Section 04 — the console portal: an abstract preview that gateways to /dashboard. */
export default function DashboardPreview() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <SectionLabel index="04" title="Clinician console" />
      <div className="mt-10 flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-end">
        <h3 className="max-w-xl text-3xl font-semibold tracking-tighter text-zinc-900">
          A spacious, multi-dimensional tracking interface.
        </h3>
        <Link
          href="/dashboard"
          className="rounded-full bg-zinc-900 px-5 py-3 text-sm font-medium text-white transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5"
        >
          Enter the console →
        </Link>
      </div>

      <div className="mt-10 rounded-3xl border border-black/[0.06] bg-white p-3">
        <div className="grid grid-cols-2 gap-3 rounded-2xl bg-[#0a0a0a] p-4 md:grid-cols-4 md:grid-rows-2">
          <div className="col-span-2 row-span-2 aspect-[16/10] rounded-xl border border-white/[0.06] bg-[radial-gradient(rgba(62,230,196,0.10),transparent_70%)]" />
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="h-2 w-10 rounded-full bg-emerald-400/70" />
            <div className="mt-4 h-5 w-16 rounded bg-white/[0.06]" />
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div className="h-2 w-8 rounded-full bg-white/20" />
            <div className="mt-4 h-5 w-12 rounded bg-white/[0.06]" />
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 md:col-span-2">
            <div className="flex h-9 items-end gap-1">
              {Array.from({ length: 22 }, (_, i) => (
                <span
                  key={i}
                  className="flex-1 rounded-t-sm bg-white/[0.07]"
                  style={{ height: `${24 + ((i * 41) % 70)}%` }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
