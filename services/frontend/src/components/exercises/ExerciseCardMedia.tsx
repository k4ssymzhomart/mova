"use client";

// A library card's media: the poster until the patient asks for motion, then the looping muted reference clip.
//  - Nothing requests the video before a click, or a hover with a mouse. Until then only the poster <img> exists.
//  - Hover plays only for a fine pointer that can hover, and not when reduced motion is asked for; leaving pauses a
//    clip that hover started. A click is an explicit request, so it plays either way and the clip stays put after.
//  - One button covers the media and toggles play and pause; its name carries the exercise.
//  - The card renders this only when the catalog has a confirmed clip. A clip that fails to load removes the block.

import { Pause, Play } from "lucide-react";
import { type PointerEvent, useEffect, useRef, useState } from "react";

import { useTranslation } from "@/locales/client";

import { hasFineHoverPointer, prefersReducedMotion } from "./media";

export default function ExerciseCardMedia({
  video,
  poster,
  name,
}: {
  video: string;
  poster: string | null;
  name: string;
}) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const clicked = useRef(false);
  const [mounted, setMounted] = useState(false); // the <video> exists
  const [wantPlay, setWantPlay] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    if (wantPlay) {
      // Muted as a property too: React does not reliably set the attribute, and only a muted clip may start itself.
      element.muted = true;
      element.play().catch(() => setWantPlay(false));
    } else {
      element.pause();
    }
  }, [mounted, wantPlay]);

  // A clip that fails to load takes the media block with it, rather than leaving a button that plays nothing.
  if (failed) return null;

  function onClick() {
    clicked.current = true;
    setMounted(true);
    setWantPlay(!(mounted && wantPlay));
  }

  function onPointerEnter(event: PointerEvent) {
    if (event.pointerType !== "mouse" || !hasFineHoverPointer() || prefersReducedMotion()) return;
    if (clicked.current) return;
    setMounted(true);
    setWantPlay(true);
  }

  function onPointerLeave(event: PointerEvent) {
    if (event.pointerType !== "mouse" || clicked.current) return;
    setWantPlay(false);
  }

  return (
    <div
      className="group relative aspect-video w-full overflow-hidden border-b border-line bg-paper-soft"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      {mounted ? (
        <video
          ref={videoRef}
          src={video}
          poster={poster ?? undefined}
          loop
          muted
          playsInline
          preload="auto"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onError={() => setFailed(true)}
          disablePictureInPicture
          disableRemotePlayback
          className="absolute inset-0 size-full object-cover"
        />
      ) : poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={poster}
          alt={t("exerciseLibrary.media.poster", { name })}
          width={640}
          height={360}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
      <button
        type="button"
        onClick={onClick}
        aria-label={t(playing ? "exerciseLibrary.media.pauseNamed" : "exerciseLibrary.media.playNamed", { name })}
        className="absolute inset-0 grid place-items-center focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-signal-deep"
      >
        <span
          className={`grid size-14 place-items-center rounded-full bg-card text-signal-deep shadow-soft ring-1 ring-line transition-opacity ${
            playing ? "opacity-0 group-has-[:focus-visible]:opacity-100" : "opacity-100"
          }`}
        >
          {playing ? (
            <Pause className="size-6" strokeWidth={2} aria-hidden="true" />
          ) : (
            <Play className="size-6 translate-x-0.5" strokeWidth={2} aria-hidden="true" />
          )}
        </span>
      </button>
    </div>
  );
}
