// Media queries the library's video reads at the moment it acts, not at render: whether the patient asked for
// reduced motion, and whether the pointer can hover precisely (a mouse, not a finger).

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function hasFineHoverPointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

// Where to centre a clip that is cropped to a 16:9 frame. The clips are phone recordings; heel-slide.mp4 is a landscape
// shot letterboxed inside a portrait frame, a little below the middle, so a centred crop shows a band of its black
// letterbox. The clips themselves are used as recorded (no re-encoding), so the frame is placed instead.
const CLIP_FOCUS: Readonly<Record<string, string>> = {
  "/exercises/heel-slide.mp4": "50% 58%",
};

export function clipObjectPosition(video: string): string | undefined {
  return CLIP_FOCUS[video];
}
