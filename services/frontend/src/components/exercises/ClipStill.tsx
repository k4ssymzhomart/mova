// A still frame from a clinician clip, filling a panel of any shape.
//
// Unlike the library card, this box is not the clip's own shape — it is as wide as a page — so the picture is
// cropped to fill it, from the middle. That only works on a picture with no black bands baked in, so the asset comes
// from clipStill() (lib/exercises/clipFrames.ts): for the two letterboxed clips that is a cropped copy, for every
// other clip it is the poster itself.

import { clipStill } from "@/lib/exercises/clipFrames";
import { cn } from "@/lib/utils";

export default function ClipStill({
  poster,
  className,
  alt = "",
}: {
  /** "/exercises/<clip>.jpg" */
  poster: string;
  /** The box to fill. Give it a height; the picture sizes itself inside. */
  className?: string;
  /** Left empty by default: on a card the name beside the picture already says what it shows. */
  alt?: string;
}) {
  return (
    <div className={cn("relative overflow-hidden bg-paper-soft", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={clipStill(poster)} alt={alt} className="absolute inset-0 size-full object-cover" />
    </div>
  );
}
