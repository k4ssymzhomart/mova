// Media queries the library's video reads at the moment it acts, not at render: whether the patient asked for
// reduced motion, and whether the pointer can hover precisely (a mouse, not a finger).

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function hasFineHoverPointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}
