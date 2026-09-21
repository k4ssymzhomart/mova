// Per-clip geometry for the clinician's reference recordings under public/exercises, so that every screen that shows
// one of those 14 clips frames it the same way and none of them crops the movement away.
//
// Why this module exists. The library card and the detail dialog both hard-coded `aspect-video` + `object-cover`.
// Six of the twelve attached clips are true full-frame 576x1024 portrait recordings, so a 16:9 window showed 324 of
// their 1024 rows: for step-up and walking-gait that window holds neither the foot nor the knee. The fix needs a
// per-clip fact — the shape of the picture inside each file — and that fact belongs in one place rather than in a
// `className` in each component.
//
// Every value below was measured on this checkout, not assumed:
//  - file{w,h} is each .mp4's tkhd display size. All 14 rotation matrices are the identity
//    [65536,0,0,0,65536,0,0,0,1073741824], and each poster .jpg has exactly the same pixel size as its video track,
//    so the poster and the video can share one frame.
//  - content{w,h} and band come from decoding 25 frames spread across each clip (AVFoundation, via
//    AVAssetImageGenerator) and scanning them for rows whose mean luminance is under 18/255, which is a baked-in
//    black bar rather than a dark scene. Exactly two clips carry bars, and only one of them carries the same bars
//    for its whole length.
//  - 576/1024 is exactly 9/16 and 1024/576 is exactly 16/9, so `aspect-[9/16]` and `aspect-video` are pixel-exact
//    frames for the portrait and landscape files: a cover crop in the matching frame removes nothing at all.
//
// What this module deliberately does NOT do:
//  - It is not keyed by exercise slug, and no caller may build a key from one. catalog.ts:484 has the slug
//    "walking-gait" pointing at /exercises/walking-gait-front-side.mp4 while a different, unattached
//    /exercises/walking-gait.mp4 also sits in public/. The catalog's own field comment (catalog.ts:43-45) says the
//    file name "is not always the slug". The key here is the clip URL, exactly as ExerciseEntry.video stores it.
//  - It states no clinical fact and no playback policy. Whether a clip autoplays, preloads or loops is each
//    component's decision; this module only answers "what shape is the picture".
//  - It carries no "use client". It is read by server components (LibraryOverviewVideo, the library page) and it is
//    loaded directly by node:test, so it has no runtime imports of any kind — not even of a sibling.

/** Whether the file pads its picture with black, and whether that padding holds for the whole clip. */
export type ClipBars = "none" | "letterbox" | "mixed";

/** The shape of the FRAME a clip is given. For a letterboxed clip that is its content's shape, not its file's. */
export type ClipShape = "portrait" | "landscape";

/** A box of pixels. */
export interface ClipBox {
  w: number;
  h: number;
}

/** The rows of the file that hold picture rather than black bar, counted from the top, both ends inclusive. */
export interface ClipBand {
  top: number;
  bottom: number;
}

export interface ClipGeometry {
  /** Pixel size of both the .mp4 track and the .jpg poster; they are always equal. */
  file: ClipBox;
  /**
   * The picture inside the file once baked-in black bars are removed.
   *
   * null when the clip's content changes shape during playback: there is no single content box to record, and
   * writing the file box here would read as a measurement that was never taken. Only overview.mp4 is like this.
   */
  content: ClipBox | null;
  /** Whether the file pads its picture with black. */
  bars: ClipBars;
  /** The shape of the frame this clip should be given. */
  shape: ClipShape;
  /**
   * Tailwind class for a frame of exactly this clip's content aspect — a literal, so tailwind.config.ts's
   * ./src/**\/*.{ts,tsx,mdx} glob generates it. Never assemble one of these by interpolation.
   */
  frameClass: string;
  /**
   * The measured rows of picture, for a clip whose bars are constant. null when there are no bars to skip, or when
   * the bars move. This is the measurement; `focus` below is derived from it rather than typed by hand.
   */
  band: ClipBand | null;
  /**
   * "contain" only for a clip whose content changes shape part-way through. No single crop is right for the whole
   * of such a clip, so it is never cropped.
   */
  fit: "cover" | "contain";
}

/**
 * Keyed by the clip's public URL, exactly as ExerciseEntry.video stores it.
 *
 * All 14 files in public/exercises are listed, including overview.mp4 (attached to no exercise, played only by the
 * library's overview section) and walking-gait.mp4 (attached to nothing at all today). Listing the orphan means
 * attaching it later needs no code change here.
 */
export const CLIP_GEOMETRY: Readonly<Record<string, ClipGeometry>> = {
  // --- true portrait, picture fills the file; 576x1024 is exactly 9:16 -----------------------------------------
  // Measured: 25 frames each, no row under the black threshold at any point in any of them.
  "/exercises/ankle-dorsiflexion-band.mp4": {
    file: { w: 576, h: 1024 }, content: { w: 576, h: 1024 },
    bars: "none", shape: "portrait", frameClass: "aspect-[9/16]", band: null, fit: "cover",
  },
  "/exercises/seated-ball-roll.mp4": {
    file: { w: 576, h: 1024 }, content: { w: 576, h: 1024 },
    bars: "none", shape: "portrait", frameClass: "aspect-[9/16]", band: null, fit: "cover",
  },
  "/exercises/seated-knee-extension.mp4": {
    file: { w: 576, h: 1024 }, content: { w: 576, h: 1024 },
    bars: "none", shape: "portrait", frameClass: "aspect-[9/16]", band: null, fit: "cover",
  },
  "/exercises/seated-knee-flexion.mp4": {
    file: { w: 576, h: 1024 }, content: { w: 576, h: 1024 },
    bars: "none", shape: "portrait", frameClass: "aspect-[9/16]", band: null, fit: "cover",
  },
  "/exercises/step-up.mp4": {
    file: { w: 576, h: 1024 }, content: { w: 576, h: 1024 },
    bars: "none", shape: "portrait", frameClass: "aspect-[9/16]", band: null, fit: "cover",
  },
  "/exercises/walking-gait-front-side.mp4": {
    file: { w: 576, h: 1024 }, content: { w: 576, h: 1024 },
    bars: "none", shape: "portrait", frameClass: "aspect-[9/16]", band: null, fit: "cover",
  },
  // Attached to no exercise today. The catalog entry whose slug is "walking-gait" points at the -front-side file
  // above; this one is a separate recording. Listed so a later pairing needs no change here.
  "/exercises/walking-gait.mp4": {
    file: { w: 576, h: 1024 }, content: { w: 576, h: 1024 },
    bars: "none", shape: "portrait", frameClass: "aspect-[9/16]", band: null, fit: "cover",
  },

  // --- true landscape, picture fills the file; 1024x576 is exactly 16:9 ----------------------------------------
  "/exercises/ankle-dorsiflexion-strap.mp4": {
    file: { w: 1024, h: 576 }, content: { w: 1024, h: 576 },
    bars: "none", shape: "landscape", frameClass: "aspect-video", band: null, fit: "cover",
  },
  "/exercises/quad-set.mp4": {
    file: { w: 1024, h: 576 }, content: { w: 1024, h: 576 },
    bars: "none", shape: "landscape", frameClass: "aspect-video", band: null, fit: "cover",
  },
  "/exercises/straight-leg-raise.mp4": {
    file: { w: 1024, h: 576 }, content: { w: 1024, h: 576 },
    bars: "none", shape: "landscape", frameClass: "aspect-video", band: null, fit: "cover",
  },
  "/exercises/supine-bend-and-raise-strap.mp4": {
    file: { w: 1024, h: 576 }, content: { w: 1024, h: 576 },
    bars: "none", shape: "landscape", frameClass: "aspect-video", band: null, fit: "cover",
  },
  "/exercises/supine-knee-flexion-strap.mp4": {
    file: { w: 1024, h: 576 }, content: { w: 1024, h: 576 },
    bars: "none", shape: "landscape", frameClass: "aspect-video", band: null, fit: "cover",
  },

  // --- landscape picture letterboxed inside a portrait file ---------------------------------------------------
  // A landscape shot exported into a portrait frame. All 25 sampled frames, evenly spaced from the first to the
  // last, give the identical band: rows 404..728 of 1024, full width, so 576x325 and the bars never move. That is
  // what makes cropping this one safe; see clipFocus() for the object-position it earns.
  "/exercises/heel-slide.mp4": {
    file: { w: 576, h: 1024 }, content: { w: 576, h: 325 },
    bars: "letterbox", shape: "landscape", frameClass: "aspect-[576/325]",
    band: { top: 404, bottom: 728 }, fit: "cover",
  },

  // --- the overview compilation: the picture CHANGES SHAPE part-way through ------------------------------------
  // Measured, not inferred from the source comment: of 25 evenly spaced frames, the early ones are a landscape shot
  // letterboxed into rows 284..550, and from roughly the middle of the clip onward the picture fills all 464x832.
  // So there is no content box and no crop that is right for the whole minute. content stays null and the frame is
  // the file's own box with object-contain — this clip must never be cropped, whatever a single frame suggests.
  "/exercises/overview.mp4": {
    file: { w: 464, h: 832 }, content: null,
    bars: "mixed", shape: "portrait", frameClass: "aspect-[464/832]", band: null, fit: "contain",
  },
};

/**
 * The media band every library card uses, so a two-column grid row stays level whatever each card holds.
 *
 * Why a square, and why one shared band at all. The grid at exercises/page.tsx:56 is `md:grid-cols-2`, and a 9:16
 * card next to a 16:9 card at the same width would be three times as tall — the rows would read as broken. So the
 * library pads to a fixed band and fits the clip inside it, and the detail dialog and the session screen are where
 * a clip is shown at its true shape.
 *
 * The band's shape decides how much of each card the picture gets. Of the twelve attached clips exactly six have
 * portrait content (9:16) and six have landscape content (16:9 or, for heel-slide, 1.772). The geometric mean of
 * 9/16 and 16/9 is exactly 1, so a square is the one band that gives those two halves of the library the same
 * picture area: in a square of side s each renders 0.5625*s^2. The `aspect-[4/3]` band considered first gives a
 * landscape clip 75% of the band's area and a portrait clip only 42%, and shrinks the portrait picture to 1.69/4 of
 * the card width while leaving the landscape picture exactly the size a square band gives it. The square costs card
 * height and nothing else.
 */
export const CARD_FRAME = "aspect-square";

/** The geometry of a clip, or undefined for a clip this module has never been told about. */
export function clipGeometry(video: string | null | undefined): ClipGeometry | undefined {
  return video ? CLIP_GEOMETRY[video] : undefined;
}

/**
 * The clip's content aspect (width / height), or null when its content changes shape during playback and so has no
 * single aspect. Derived from `content` rather than stored beside it, so the two can never drift apart.
 */
export function clipAspect(geometry: ClipGeometry | undefined): number | null {
  const content = geometry?.content;
  return content ? content.w / content.h : null;
}

/**
 * The CSS object-position that makes a cover crop land on the picture instead of on the black bars.
 *
 * Only meaningful inside a frame of the clip's own content aspect, which is what `frameClass` gives — the card's
 * inner box, the detail dialog's frame and the session screen's frame are all built that way, so one value serves
 * all three. undefined for every clip without constant bars, where the default 50% 50% is already right.
 *
 * The arithmetic, for heel-slide (the only clip this applies to). A cover fit of a 576x1024 source into a frame of
 * aspect 576/325 is bound by the width, so it scales by frameWidth/576 and exactly 325 of the 1024 source rows stay
 * visible; the other 1024 - 325 = 699 are the crop's vertical overflow. An object-position of p puts the top of the
 * visible window at 699*p source rows, so landing it on the first picture row, 404, wants p = 404/699 = 57.797%.
 * Rounded to one decimal that is 57.8%, which starts the window at row 404.02 — within a fortieth of a source pixel
 * of the boundary, and inside the picture rather than a hair above it.
 *
 * This supersedes the "50% 58%" that shipped in components/exercises/media.ts:16. That value was written for a 16:9
 * frame, where only 324 rows stay visible and the overflow is 700; 58% of 700 is row 406, which was 2 rows inside
 * the picture at the top and therefore 2 rows of black bar at the bottom. The focus point is unchanged — the same
 * measured band — but the frame it is computed against is now the picture's own aspect, so the value moves with it.
 */
export function clipFocus(geometry: ClipGeometry | undefined): string | undefined {
  if (!geometry || !geometry.band || !geometry.content) return undefined;
  const { file, content, band } = geometry;
  // Source rows left visible by a cover fit into a frame of the content's aspect.
  const visibleRows = (file.w * content.h) / content.w;
  const overflowRows = file.h - visibleRows;
  if (overflowRows <= 0) return undefined;
  const percent = (band.top / overflowRows) * 100;
  return `50% ${Math.round(percent * 10) / 10}%`;
}

/**
 * The Tailwind object-fit class a clip wants. Kept here rather than spelled out at each call site so that changing
 * a clip's fit is a one-line change in the table above.
 */
export function clipFitClass(geometry: ClipGeometry | undefined): string {
  return geometry?.fit === "cover" ? "object-cover" : "object-contain";
}
