import SectionLabel from "./SectionLabel";

interface ChannelStatProps {
  tag: string;
  name: string;
  detail: string;
}

function ChannelStat({ tag, name, detail }: ChannelStatProps) {
  return (
    <div className="rounded-2xl border border-black/[0.06] bg-white p-6">
      <span className="font-mono text-xs text-zinc-400">{tag}</span>
      <p className="mt-3 text-lg font-medium tracking-tight text-zinc-900">{name}</p>
      <p className="mt-1 text-sm leading-relaxed text-zinc-500">{detail}</p>
    </div>
  );
}

/** Section 02 — the ingestion story: an asymmetrical bento for 50 Hz multimodal capture. */
export default function IngestionSection() {
  const bars: number[] = Array.from({ length: 40 }, (_, i) => 28 + ((i * 53) % 64));
  return (
    <section id="ingestion" className="mx-auto max-w-6xl px-6 py-24">
      <SectionLabel index="02" title="Multimodal data capture" />
      <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3 md:grid-rows-2">
        <div className="rounded-2xl border border-black/[0.06] bg-white p-8 md:col-span-2 md:row-span-2">
          <h3 className="text-2xl font-semibold tracking-tight text-zinc-900">
            50 Hz, six-channel streams
          </h3>
          <p className="mt-3 max-w-md leading-relaxed text-zinc-600">
            Accelerometer and gyroscope, harmonized to a strict 50 Hz grid and a unified
            body-placement ontology — one canonical schema across every device and dataset.
          </p>
          <div
            className="mt-10 flex h-28 items-end gap-1.5 border-b border-black/[0.06]"
            aria-hidden="true"
          >
            {bars.map((h, i) => (
              <span
                key={i}
                className="flex-1 rounded-t-sm bg-zinc-900/80"
                style={{ height: `${h}%`, opacity: 0.35 + (i % 5) * 0.12 }}
              />
            ))}
          </div>
        </div>
        <ChannelStat tag="acc · xyz" name="Linear acceleration" detail="g, gravity-inclusive" />
        <ChannelStat tag="gyr · xyz" name="Angular velocity" detail="rad · s⁻¹" />
      </div>
    </section>
  );
}
