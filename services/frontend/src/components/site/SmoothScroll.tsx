"use client";

import { ReactLenis } from "@studio-freight/react-lenis";
import type { ReactNode } from "react";

/**
 * App-wide smooth scroll. The eased momentum (the perceived "latency" of the
 * reference site) comes from Lenis interpolating scroll position every frame.
 * Slightly lower lerp + a gentle wheel multiplier give a heavier, more
 * cinematic glide without feeling laggy.
 */
export default function SmoothScroll({ children }: { children: ReactNode }) {
  return (
    <ReactLenis
      root
      options={{
        lerp: 0.075,
        wheelMultiplier: 0.95,
        touchMultiplier: 1.5,
        smoothWheel: true,
        syncTouch: true,
      }}
    >
      {children}
    </ReactLenis>
  );
}
