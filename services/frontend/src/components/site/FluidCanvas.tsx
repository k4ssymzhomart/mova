"use client";

import { useEffect, useRef, type MutableRefObject } from "react";

type Blob = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  light: number;
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * Atmospheric dark-green fluid for the storytelling beat. Stays strictly on
 * palette — near-black base with drifting emerald light. As scroll progresses
 * the green simply intensifies (no new hues, no gradient), giving the close a
 * subtle lift toward the answer.
 */
export default function FluidCanvas({
  progressRef,
}: {
  progressRef: MutableRefObject<number>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let w = 0;
    let h = 0;
    let dpr = 1;

    const blobs: Blob[] = [];
    const COUNT = 26;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const seed = () => {
      blobs.length = 0;
      for (let i = 0; i < COUNT; i++) {
        blobs.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.28,
          vy: (Math.random() - 0.5) * 0.28,
          r: 120 + Math.random() * 320,
          light: 26 + Math.random() * 22,
        });
      }
    };

    const draw = () => {
      const p = clamp01(progressRef.current);
      // green intensifies toward the end; hue is constant (emerald)
      const intensity = 0.55 + 0.45 * p;

      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#070b08";
      ctx.fillRect(0, 0, w, h);

      ctx.globalCompositeOperation = "lighter";
      for (const b of blobs) {
        if (!reduce) {
          b.x += b.vx;
          b.y += b.vy;
          if (b.x < -b.r) b.x = w + b.r;
          if (b.x > w + b.r) b.x = -b.r;
          if (b.y < -b.r) b.y = h + b.r;
          if (b.y > h + b.r) b.y = -b.r;
        }
        const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
        g.addColorStop(0, `hsla(151, 64%, ${b.light}%, ${0.34 * intensity})`);
        g.addColorStop(0.5, `hsla(151, 60%, ${b.light - 6}%, ${0.13 * intensity})`);
        g.addColorStop(1, "hsla(151, 60%, 8%, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // vignette
      ctx.globalCompositeOperation = "source-over";
      const v = ctx.createRadialGradient(w / 2, h / 2, h * 0.18, w / 2, h / 2, h * 0.82);
      v.addColorStop(0, "rgba(0,0,0,0)");
      v.addColorStop(1, "rgba(3,6,4,0.66)");
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, w, h);

      if (!reduce) raf = requestAnimationFrame(draw);
    };

    resize();
    seed();
    draw();
    const onResize = () => {
      resize();
      seed();
      if (reduce) draw();
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
    // progressRef is a stable ref read inside the RAF loop; no deps needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="grain absolute inset-0 h-full w-full"
      aria-hidden
    />
  );
}
