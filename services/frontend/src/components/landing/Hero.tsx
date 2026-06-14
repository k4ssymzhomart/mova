import Link from "next/link";

/** Section 01 — the conceptual hook: massive headline with a staggered mount entrance. */
export default function Hero() {
  return (
    <section className="relative mx-auto max-w-6xl px-6 pb-28 pt-24 sm:pt-32">
      <div className="animate-rise" style={{ animationDelay: "60ms" }}>
        <span className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white px-3 py-1 text-xs font-medium tracking-tight text-zinc-600">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          50 Hz medical-grade gait tracking
        </span>
      </div>

      <h1
        className="animate-rise mt-8 max-w-4xl text-[clamp(2.6rem,7vw,5.6rem)] font-semibold leading-[0.95] tracking-tighter text-zinc-900"
        style={{ animationDelay: "120ms" }}
      >
        Motion intelligence
        <br />
        for rehabilitation.
      </h1>

      <p
        className="animate-rise mt-7 max-w-2xl text-lg leading-relaxed text-zinc-600"
        style={{ animationDelay: "220ms" }}
      >
        Mova turns one or two consumer IMUs into clinical-grade joint-angle, movement-quality and
        freezing-of-gait signals — camera-free, at home, generalizing across patients and devices.
      </p>

      <div
        className="animate-rise mt-10 flex flex-wrap items-center gap-3"
        style={{ animationDelay: "320ms" }}
      >
        <Link
          href="/dashboard"
          className="rounded-full bg-zinc-900 px-5 py-3 text-sm font-medium text-white transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5"
        >
          Open the clinician console
        </Link>
        <a
          href="#architecture"
          className="rounded-full border border-black/[0.08] px-5 py-3 text-sm font-medium text-zinc-700 transition-colors hover:border-black/20"
        >
          See the engine
        </a>
      </div>
    </section>
  );
}
