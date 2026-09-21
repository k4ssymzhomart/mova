// Media queries the library's video reads at the moment it acts, not at render: whether the patient asked for
// reduced motion, and whether the pointer can hover precisely (a mouse, not a finger).

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function hasFineHoverPointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

// Where a clip is centred and what shape its frame is are NOT here. That is per-clip geometry measured from the
// files themselves, and it lives in @/lib/exercises/clipGeometry so that the session screen — which is not part of
// the library — can read the same table. This file stays what its name says: the media queries.
