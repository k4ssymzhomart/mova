// How each clinician clip has to be framed. The clips are phone recordings used exactly as they were filmed: seven are
// upright (9:16), five are sideways (16:9), and two — heel-slide and the overview — are a sideways shot letterboxed
// inside an upright frame, with black bands baked into the picture.
//
// So the app cannot use one fixed frame. Each clip declares the size of its own picture, and the two letterboxed ones
// declare where the picture sits inside the file. Everything else is derived: the shape of the box to draw, and the
// point to align the picture on when the box is filled. Nothing is ever cropped except those black bands.
//
// The numbers are the files' own pixel sizes, measured from the posters in public/exercises (the poster and the clip
// are the same frame). A clip with no entry here is drawn at 16:9, which is only a fallback: clipFrames.test.ts fails
// if the catalogue attaches a clip that is missing from this table.

export interface ClipSource {
  /** The file's own width and height in pixels. */
  width: number;
  height: number;
  /** Rows of black letterbox baked into the top and the bottom of the picture, if any. */
  letterbox?: { top: number; bottom: number };
}

export interface ClipFrame {
  /** Width divided by height of the visible picture: the shape of the box to draw. */
  ratio: number;
  /** CSS object-position for the picture inside that box; only the two letterboxed clips need anything but the middle. */
  objectPosition: string;
  /** true when the picture is wider than it is tall. */
  wide: boolean;
}

const SOURCES: Readonly<Record<string, ClipSource>> = {
  "heel-slide": { width: 576, height: 1024, letterbox: { top: 404, bottom: 295 } },
  "overview": { width: 464, height: 832, letterbox: { top: 284, bottom: 281 } },
  "ankle-dorsiflexion-band": { width: 576, height: 1024 },
  "ankle-dorsiflexion-strap": { width: 1024, height: 576 },
  "quad-set": { width: 1024, height: 576 },
  "seated-ball-roll": { width: 576, height: 1024 },
  "seated-knee-extension": { width: 576, height: 1024 },
  "seated-knee-flexion": { width: 576, height: 1024 },
  "step-up": { width: 576, height: 1024 },
  "straight-leg-raise": { width: 1024, height: 576 },
  "supine-bend-and-raise-strap": { width: 1024, height: 576 },
  "supine-knee-flexion-strap": { width: 1024, height: 576 },
  "walking-gait": { width: 576, height: 1024 },
  "walking-gait-front-side": { width: 576, height: 1024 },
};

const FALLBACK: ClipFrame = { ratio: 16 / 9, objectPosition: "50% 50%", wide: true };

/** "/exercises/walking-gait.mp4" -> "walking-gait" */
export function clipName(path: string): string {
  const file = path.slice(path.lastIndexOf("/") + 1);
  const dot = file.lastIndexOf(".");
  return dot === -1 ? file : file.slice(0, dot);
}

export function clipSource(path: string): ClipSource | null {
  return SOURCES[clipName(path)] ?? null;
}

/**
 * The box to draw a clip in, and where to align it.
 *
 * With no letterbox the box has the file's own shape, so filling it shows the whole picture and crops nothing. With a
 * letterbox the box has the shape of the picture inside the bands: filling it pushes the bands out of view. The
 * alignment is the share of the removed height that sits above the picture, which is what object-position measures.
 */
export function clipFrame(path: string): ClipFrame {
  const source = clipSource(path);
  if (!source) return FALLBACK;
  const bars = source.letterbox;
  if (!bars) {
    return { ratio: source.width / source.height, objectPosition: "50% 50%", wide: source.width >= source.height };
  }
  const pictureHeight = source.height - bars.top - bars.bottom;
  const hidden = source.height - pictureHeight;
  const y = hidden > 0 ? Math.round((bars.top / hidden) * 1000) / 10 : 50;
  return { ratio: source.width / pictureHeight, objectPosition: `50% ${y}%`, wide: source.width >= pictureHeight };
}

/** Clip names this table knows about, for the tests. */
export function knownClipNames(): string[] {
  return Object.keys(SOURCES);
}
