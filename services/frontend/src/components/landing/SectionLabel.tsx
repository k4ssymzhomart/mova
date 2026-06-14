interface SectionLabelProps {
  index: string;
  title: string;
}

/** A hairline section marker: monospace index · rule · uppercase tracked label. */
export default function SectionLabel({ index, title }: SectionLabelProps) {
  return (
    <div className="flex items-center gap-4">
      <span className="font-mono text-xs text-zinc-400">{index}</span>
      <span className="h-px flex-1 bg-black/[0.06]" />
      <span className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">{title}</span>
    </div>
  );
}
