// Upper-limb reaching game — pure engine (no React, no DOM beyond the 2D context passed to draw()).
//
// One target at a time: the patient drives a cursor with their wrist landmark and must hold it over a
// sharp black square to "reach" it. On contact the square inverts to white-with-outline and pulses,
// then a new target spawns elsewhere. Monochrome and geometric by construction — the only states are
// black, white, and hairline.

export interface Target {
  x: number;
  y: number;
  size: number;
  state: "active" | "hit";
  bornAt: number;
  hitAt: number;
}

export interface ReachingStats {
  score: number;
  attempts: number;
  lastReachMs: number | null; // time from spawn to reach (movement speed proxy)
}

const RESPAWN_MS = 320;
const PULSE_MS = 320;
const SPAWN_MS = 180;
const CURSOR_SMOOTH = 0.35; // lerp factor — higher = snappier
const MARGIN = 0.12; // keep targets away from the frame edge (fraction of min dimension)

export class ReachingGame {
  width = 0;
  height = 0;
  // 0..1 personalisation knob seeded from the baseline ROM: higher ability -> smaller, wider-spread
  // targets. Default 0.5 keeps the original behaviour for un-onboarded patients.
  difficulty = 0.5;
  target: Target | null = null;
  cursor: { x: number; y: number; active: boolean } = { x: 0, y: 0, active: false };
  stats: ReachingStats = { score: 0, attempts: 0, lastReachMs: null };
  private respawnAt = 0;
  private rng = Math.random;

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  reset(): void {
    this.stats = { score: 0, attempts: 0, lastReachMs: null };
    this.target = null;
    this.respawnAt = 0;
  }

  private spawn(now: number): void {
    const d = Math.max(0, Math.min(1, this.difficulty));
    const min = Math.min(this.width, this.height);
    const m = MARGIN * (0.7 + 0.7 * d) * min; // harder -> targets reach closer to the edges
    const size = Math.max(34, Math.round(min * (0.13 - 0.05 * d))); // harder -> smaller targets
    this.target = {
      x: m + this.rng() * (this.width - 2 * m - size),
      y: m + this.rng() * (this.height - 2 * m - size),
      size,
      state: "active",
      bornAt: now,
      hitAt: 0,
    };
  }

  /** Advance one frame. `wrist` is the cursor target in canvas px, or null when untracked. */
  update(wrist: [number, number] | null, now: number): void {
    if (this.width === 0 || this.height === 0) return;

    // cursor follows the wrist with inertia (snappy but not jittery)
    if (wrist) {
      if (!this.cursor.active) {
        this.cursor.x = wrist[0];
        this.cursor.y = wrist[1];
      } else {
        this.cursor.x += (wrist[0] - this.cursor.x) * CURSOR_SMOOTH;
        this.cursor.y += (wrist[1] - this.cursor.y) * CURSOR_SMOOTH;
      }
      this.cursor.active = true;
    } else {
      this.cursor.active = false;
    }

    if (!this.target && now >= this.respawnAt) this.spawn(now);
    const t = this.target;
    if (!t) return;

    if (t.state === "active" && this.cursor.active && this.overlaps(t)) {
      t.state = "hit";
      t.hitAt = now;
      this.stats.score += 1;
      this.stats.attempts += 1;
      this.stats.lastReachMs = Math.round(now - t.bornAt);
      this.respawnAt = now + RESPAWN_MS;
    }
    if (t.state === "hit" && now - t.hitAt > PULSE_MS) {
      this.target = null;
    }
  }

  private overlaps(t: Target): boolean {
    return (
      this.cursor.x >= t.x &&
      this.cursor.x <= t.x + t.size &&
      this.cursor.y >= t.y &&
      this.cursor.y <= t.y + t.size
    );
  }

  /** Render the game stage. Caller has already cleared `ctx` to the stage colour (white). */
  draw(ctx: CanvasRenderingContext2D, now: number): void {
    this.drawGrid(ctx);
    if (this.target) this.drawTarget(ctx, this.target, now);
    if (this.cursor.active) this.drawCursor(ctx);
  }

  private drawGrid(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = "rgba(18,19,17,0.05)";
    ctx.lineWidth = 1;
    const step = 40;
    ctx.beginPath();
    for (let x = step; x < this.width; x += step) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, this.height);
    }
    for (let y = step; y < this.height; y += step) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(this.width, y + 0.5);
    }
    ctx.stroke();
  }

  private drawTarget(ctx: CanvasRenderingContext2D, t: Target, now: number): void {
    const cx = t.x + t.size / 2;
    const cy = t.y + t.size / 2;
    if (t.state === "active") {
      const grow = Math.min(1, (now - t.bornAt) / SPAWN_MS); // sharp scale-in
      const s = t.size * (0.6 + 0.4 * grow);
      ctx.fillStyle = "#121311"; // ink
      ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
    } else {
      // hit: invert to paper with an emerald (signal) outline + a single emerald pulse ring
      const p = Math.min(1, (now - t.hitAt) / PULSE_MS);
      const s = t.size * (1 + 0.28 * p);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
      ctx.strokeStyle = "#16a35b";
      ctx.lineWidth = 2;
      ctx.strokeRect(cx - s / 2, cy - s / 2, s, s);
      const ring = t.size * (1 + 0.9 * p);
      ctx.globalAlpha = 1 - p;
      ctx.strokeRect(cx - ring / 2, cy - ring / 2, ring, ring);
      ctx.globalAlpha = 1;
    }
  }

  private drawCursor(ctx: CanvasRenderingContext2D): void {
    const over = this.target?.state === "active" && this.overlaps(this.target);
    const r = over ? 13 : 10;
    ctx.strokeStyle = "#16a35b"; // emerald signal — the patient's live cursor
    ctx.lineWidth = over ? 3 : 2;
    ctx.strokeRect(this.cursor.x - r, this.cursor.y - r, r * 2, r * 2);
    ctx.beginPath();
    ctx.moveTo(this.cursor.x - r - 5, this.cursor.y);
    ctx.lineTo(this.cursor.x - r, this.cursor.y);
    ctx.moveTo(this.cursor.x + r, this.cursor.y);
    ctx.lineTo(this.cursor.x + r + 5, this.cursor.y);
    ctx.moveTo(this.cursor.x, this.cursor.y - r - 5);
    ctx.lineTo(this.cursor.x, this.cursor.y - r);
    ctx.moveTo(this.cursor.x, this.cursor.y + r);
    ctx.lineTo(this.cursor.x, this.cursor.y + r + 5);
    ctx.stroke();
  }
}
