// BadgeMark — a minimalist geometric emblem for a badge, deterministic per code.
// Editorial Spatial, deliberately not a cartoon: crisp SVG geometry, monochrome when locked,
// emerald when earned. Six line-drawn variants (concentric rings, triangle, hexagon, nested
// squares, asterisk, diamond) chosen by a stable hash of the badge code.

const EARNED = "#16A35B"; // signal
const LOCKED = "#B4B2A9"; // ink-faint-ish

function variantFor(code: string): number {
  let h = 0;
  for (let i = 0; i < code.length; i += 1) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  return h % 6;
}

export default function BadgeMark({ code, earned }: { code: string; earned: boolean }) {
  const stroke = earned ? EARNED : LOCKED;
  const v = variantFor(code);
  return (
    <svg viewBox="0 0 48 48" width="44" height="44" fill="none" aria-hidden="true">
      <g stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
        {v === 0 && (
          <>
            <circle cx="24" cy="24" r="14" />
            <circle cx="24" cy="24" r="8" />
            <circle cx="24" cy="24" r="2.4" fill={stroke} stroke="none" />
          </>
        )}
        {v === 1 && (
          <>
            <path d="M24 9 L39 35 H9 Z" />
            <path d="M24 19 L31 32 H17 Z" />
          </>
        )}
        {v === 2 && (
          <>
            <path d="M24 8 L37 16 V32 L24 40 L11 32 V16 Z" />
            <path d="M24 17 L31 21 V29 L24 33 L17 29 V21 Z" />
          </>
        )}
        {v === 3 && (
          <>
            <rect x="11" y="11" width="26" height="26" rx="2" />
            <rect x="17.5" y="17.5" width="13" height="13" rx="1.5" transform="rotate(45 24 24)" />
          </>
        )}
        {v === 4 && (
          <>
            <circle cx="24" cy="24" r="3" fill={stroke} stroke="none" />
            <path d="M24 7 V15 M24 33 V41 M7 24 H15 M33 24 H41 M12 12 L17 17 M31 31 L36 36 M36 12 L31 17 M17 31 L12 36" />
          </>
        )}
        {v === 5 && (
          <>
            <path d="M24 8 L36 24 L24 40 L12 24 Z" />
            <circle cx="24" cy="24" r="4.5" />
          </>
        )}
      </g>
    </svg>
  );
}
