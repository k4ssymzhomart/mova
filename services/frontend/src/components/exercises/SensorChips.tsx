// The sensors an exercise uses, one chip per role, labelled with the shell's sensors.role.* words. Strings arrive
// translated. Renders nothing for an empty list, so a caller omits the row rather than showing an empty one.

export default function SensorChips({ labels }: { labels: readonly string[] }) {
  if (labels.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {labels.map((label) => (
        <li
          key={label}
          className="inline-flex min-h-8 items-center rounded-pill bg-paper-soft px-3 text-sm font-medium text-ink ring-1 ring-line"
        >
          {label}
        </li>
      ))}
    </ul>
  );
}
