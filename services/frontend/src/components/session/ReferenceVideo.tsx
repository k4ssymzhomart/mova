"use client";

// ReferenceVideo — the looping exercise-reference clip (NTZ 16.1: video + sensor feedback on ONE
// screen). Source comes from the exercise definition (exercises.demo_video_url), never a hardcoded
// constant. No video for this exercise yet -> an honest "no reference video available" state, never a
// placeholder/stock clip standing in for it.

import { VideoOff } from "lucide-react";

export default function ReferenceVideo({ videoUrl, name }: { videoUrl: string | null; name: string }) {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-night">
      {videoUrl ? (
        <video
          key={videoUrl}
          src={videoUrl}
          className="aspect-video w-full object-cover"
          autoPlay
          loop
          muted
          playsInline
          controls
          aria-label={name}
        />
      ) : (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 text-paper-soft/60">
          <VideoOff className="size-7" strokeWidth={1.5} />
          <p className="text-[13px]">Видео-пример скоро появится</p>
        </div>
      )}
    </div>
  );
}
