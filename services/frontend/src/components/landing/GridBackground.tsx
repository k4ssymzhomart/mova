/**
 * Ambient technical backdrop: a faint fixed dot-matrix, masked to fade toward the edges.
 * Purely decorative — never interactive.
 */
export default function GridBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 bg-white">
      <div className="absolute inset-0 bg-[radial-gradient(#e4e4e7_1px,transparent_1px)] [background-size:24px_24px] [mask-image:radial-gradient(ellipse_75%_60%_at_50%_0%,#000_45%,transparent_100%)]" />
    </div>
  );
}
