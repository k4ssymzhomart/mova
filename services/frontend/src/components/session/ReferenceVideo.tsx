"use client";

// The clinician's reference clip, shown beside the live feedback on the session screen so the patient can see the
// movement they are being asked for (НТЗ 16.1: the example and the feedback on ONE screen).
//
// Where the clip comes from. The caller passes a URL; it must read it from the static catalog
// (`exerciseBySlug(slug)?.video`) and must never build a path out of a slug — catalog.ts:484 has the slug
// "walking-gait" pointing at /exercises/walking-gait-front-side.mp4 while a different /exercises/walking-gait.mp4
// also exists. An earlier version of this file claimed the source was an exercises.demo_video_url column; no such
// column is queried anywhere in src/, so that claim has been removed rather than left to mislead the next reader.
//
// What it deliberately does NOT do:
//  - It never substitutes another exercise's clip, or a stock one, for an exercise that has no recording. Without a
//    URL it says so, in the patient's own language, and shows nothing.
//  - It does not crop. The frame is the clip's measured content aspect, from @/lib/exercises/clipGeometry, the same
//    table the library reads. A clip this table has never been told about is contained in a 16:9 frame instead:
//    padding is honest where a crop would be a guess.
//  - It does not decide the surrounding layout. The caller sets the column width; a portrait clip is capped at
//    18rem wide (32rem tall) and centred so it cannot crowd out the live panel next to it on a wide screen.
//  - It sets no colour of its own beyond the white chassis. There is no dark frame here; the earlier bg-night was
//    left over from a different design.
//
// Three earlier faults are fixed and should not come back: the bg-night chassis, a hardcoded Russian sentence that
// bypassed t() (so English and Kazakh silently read Russian), and an autoPlay that ignored prefers-reduced-motion.

import { VideoOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { prefersReducedMotion } from "@/components/exercises/media";
import { clipFitClass, clipFocus, clipGeometry } from "@/lib/exercises/clipGeometry";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/locales/client";

export default function ReferenceVideo({
  videoUrl,
  poster,
  name,
}: {
  videoUrl: string | null;
  poster?: string | null;
  name: string;
}) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    // Muted as a property too: React does not reliably set the attribute, and only a muted clip may start itself.
    element.muted = true;
    if (!prefersReducedMotion()) {
      element.play().catch(() => {
        /* the browser refused to start it; the clip's own controls still work */
      });
    }
    // Turning reduced motion on while the clip loops stops it, rather than waiting for the next mount.
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => {
      if (query.matches) element.pause();
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [videoUrl]);

  const geometry = clipGeometry(videoUrl);
  const frame = geometry?.frameClass ?? "aspect-video";
  // A clip that will not load is the same situation as an exercise with no recording: say so, rather than leave a
  // black rectangle that looks like the clip is still coming.
  const showing = videoUrl !== null && !failed;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-card border border-line bg-paper-soft",
        geometry?.shape === "portrait" && "mx-auto max-w-[18rem]",
      )}
    >
      {showing ? (
        <video
          key={videoUrl}
          ref={videoRef}
          src={videoUrl}
          poster={poster ?? undefined}
          className={cn("w-full", frame, clipFitClass(geometry))}
          style={{ objectPosition: clipFocus(geometry) }}
          loop
          muted
          playsInline
          controls
          preload="metadata"
          disablePictureInPicture
          disableRemotePlayback
          onError={() => setFailed(true)}
          aria-label={t("exerciseLibrary.media.video", { name })}
        />
      ) : (
        <div className={cn("flex w-full flex-col items-center justify-center gap-2 text-ink-soft", frame)}>
          <VideoOff className="size-7" strokeWidth={1.5} aria-hidden="true" />
          <p className="text-[13px]">{t("exerciseLibrary.media.comingSoon")}</p>
        </div>
      )}
    </div>
  );
}
