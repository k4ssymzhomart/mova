/** Hairline footer with the clinical disclaimer. */
export default function Footer() {
  return (
    <footer className="border-t border-black/[0.06]">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-[3px] bg-zinc-900" />
          <span className="text-sm font-semibold tracking-tight text-zinc-900">mova</span>
        </div>
        <p className="text-sm text-zinc-500">Decision support, not diagnosis.</p>
      </div>
    </footer>
  );
}
