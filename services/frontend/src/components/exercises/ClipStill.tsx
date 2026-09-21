// A still frame from a clinician clip, for a panel that is not a clip surface: the exercise card on Today, where
// the picture sits beside the name and the button.
//
// It gives the clip a frame of its own picture's shape (lib/exercises/clipGeometry.ts) inside whatever box the page
// hands it, so the crop lands on the movement and never on the black bands two of the files carry. A clip whose
// picture changes shape while it plays is shown whole instead of cropped, as that table asks.

import { clipFitClass, clipFocus, clipGeometry } from "@/lib/exercises/clipGeometry";
import { cn } from "@/lib/utils";

export default function ClipStill({
  poster,
  video,
  className,
  alt = "",
}: {
  /** "/exercises/<clip>.jpg" */
  poster: string;
  /** The clip this poster belongs to: the geometry table is keyed by the clip URL, never by the poster or a slug. */
  video: string;
  /** The box to fill. Give it a height; the picture sizes itself inside. */
  className?: string;
  /** Left empty by default: on a card the name beside the picture already says what it shows. */
  alt?: string;
}) {
  const geometry = clipGeometry(video);
  return (
    <div className={cn("relative grid place-items-center overflow-hidden bg-paper-soft", className)}>
      {/* The clip's own poster, blurred and dimmed, so a portrait picture in a wide panel has no empty margins. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={poster}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 size-full scale-125 object-cover opacity-30 blur-2xl"
      />
      <div className={cn("relative h-full", geometry?.frameClass)} style={{ maxWidth: "100%", maxHeight: "100%" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={poster}
          alt={alt}
          className={cn("absolute inset-0 size-full", clipFitClass(geometry))}
          style={{ objectPosition: clipFocus(geometry) }}
        />
      </div>
    </div>
  );
}
