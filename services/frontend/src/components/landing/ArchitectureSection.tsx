import SectionLabel from "./SectionLabel";

const SNIPPET = `psd  = abs(rfft(acc_mag * hann)) ** 2 / n
freqs = rfftfreq(n, 1 / fs)

loco   = psd[(freqs >= 0.5) & (freqs < 3)].sum()
freeze = psd[(freqs >= 3) & (freqs < 8)].sum()

freeze_index = freeze / loco
is_fog = freeze_index > 1.5 and total_power > floor`;

/** Section 03 — the algorithmic panel: the Bachlin Freeze Index, framed in high whitespace. */
export default function ArchitectureSection() {
  return (
    <section id="architecture" className="mx-auto max-w-6xl px-6 py-24">
      <SectionLabel index="03" title="Signal-processing engine" />
      <div className="mt-10 rounded-3xl border border-black/[0.06] bg-[#fafafa] p-8 sm:p-14">
        <h3 className="max-w-xl text-3xl font-semibold tracking-tighter text-zinc-900">
          The Bachlin Freeze Index
        </h3>
        <p className="mt-4 max-w-xl leading-relaxed text-zinc-600">
          Freezing of gait is detected by comparing spectral energy in the freeze band against the
          locomotor band of the acceleration magnitude — a high ratio with sufficient movement energy
          flags an episode.
        </p>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <div className="flex flex-col justify-center rounded-2xl border border-black/[0.06] bg-white p-8">
            <span className="text-xs uppercase tracking-[0.18em] text-zinc-400">Freeze index</span>
            <p className="mt-4 font-mono text-2xl tracking-tight text-zinc-900">
              FI = <span className="text-zinc-400">P</span>
              <sub className="text-zinc-500">3–8 Hz</sub> / <span className="text-zinc-400">P</span>
              <sub className="text-zinc-500">0.5–3 Hz</sub>
            </p>
            <p className="mt-4 text-sm leading-relaxed text-zinc-500">
              Deterministic, explainable, and the same payload shape the trained model will emit —
              so the console never changes when the engine is swapped.
            </p>
          </div>

          <pre className="overflow-x-auto rounded-2xl border border-black/[0.06] bg-zinc-950 p-6 font-mono text-[13px] leading-relaxed text-zinc-100">
            <code>{SNIPPET}</code>
          </pre>
        </div>
      </div>
    </section>
  );
}
