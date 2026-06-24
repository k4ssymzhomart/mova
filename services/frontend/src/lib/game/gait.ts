// Lower-limb gait/balance game — pure engine (no React, no DOM beyond the 2D context passed to draw()).
//
// Mechanic: rhythmic stepping. A metronome alternates a cue between the two feet; the patient lifts the
// cued knee (a step / high-knee march in place) so the foot crosses a lift threshold on the beat. Hitting
// the beat scores a step and grows a streak; the engine measures real cadence and rhythm accuracy.
//
// Why this exercise: external rhythmic cueing (visual/auditory) is an evidence-based way to drive gait
// and reduce freezing-of-gait — so the game is the same construct the lower-limb FoG model reads, not a
// decorative skin. Strict editorial palette: ink lines, paper stage, a single emerald signal accent.

export type Side = "left" | "right";

export interface GaitSample {
  // Foot horizontal position in canvas px (already mirrored), for placing the step pads under the feet.
  left: { footX: number; ankleY: number; kneeY: number };
  right: { footX: number; ankleY: number; kneeY: number };
  hipY: number; // normalized 0..1 (mean hip height) — the scale reference for "how high is a step"
}

export interface GaitStats {
  steps: number; // cued lifts landed on the beat
  beats: number; // cues issued
  cadenceSpm: number; // measured steps / minute from real step intervals
  rhythmPct: number; // 0..1 — fraction of cues stepped on time
  currentStreak: number;
  bestStreak: number;
  lastErrMs: number | null; // signed timing error of the last step (− early, + late)
}

interface Leg {
  lift: number; // 0..1 normalized knee/foot elevation above the resting floor
  baseY: number; // auto-calibrated resting ankle height (normalized, larger = lower in frame)
  baseInit: boolean; // whether baseY has been seeded from a real frame yet
  armed: boolean; // rising-edge latch so a held knee can't multi-count
  footX: number; // last known px x (for drawing)
  flashAt: number; // last successful-step timestamp (for the hit flash)
}

const DEFAULT_PERIOD_MS = 900; // ~67 steps/min — a gentle, FoG-safe default cadence
const MIN_SPM = 40; // cadence floor (slow, deliberate weight shifts)
const MAX_SPM = 110; // cadence ceiling (brisk marching)
const HIT_LIFT = 0.5; // normalized lift that counts as a completed step
const RELEASE_LIFT = 0.22; // foot must drop below this to re-arm the next step
const HIT_WINDOW_FRAC = 0.85; // fraction of the beat in which a step still counts

function emptyLeg(footX: number): Leg {
  return { lift: 0, baseY: 0.9, baseInit: false, armed: true, footX, flashAt: -1 };
}

export class GaitGame {
  width = 0;
  height = 0;
  lead: Side = "right";
  stepPeriodMs = DEFAULT_PERIOD_MS;
  cadenceTargetSpm = Math.round(60000 / DEFAULT_PERIOD_MS);

  stats: GaitStats = {
    steps: 0,
    beats: 0,
    cadenceSpm: 0,
    rhythmPct: 0,
    currentStreak: 0,
    bestStreak: 0,
    lastErrMs: null,
  };

  private legs: Record<Side, Leg> = { left: emptyLeg(0), right: emptyLeg(0) };
  private startedAt = 0;
  private lastNow = 0;
  private beatIndex = -1;
  private beatHit = false;
  private cuedSide: Side = "right";
  private stepTimes: number[] = []; // recent step timestamps for cadence

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  /** Set the cued cadence (steps/min). Preserves the current beat phase so the cue never jumps. */
  setTempoSpm(spm: number): void {
    const clamped = Math.max(MIN_SPM, Math.min(MAX_SPM, Math.round(spm)));
    const p = 60000 / clamped;
    if (this.startedAt && this.lastNow) {
      const phase = ((this.lastNow - this.startedAt) % this.stepPeriodMs) / this.stepPeriodMs;
      this.startedAt = this.lastNow - phase * p;
      this.beatIndex = Math.floor((this.lastNow - this.startedAt) / p);
    }
    this.stepPeriodMs = p;
    this.cadenceTargetSpm = clamped;
  }

  reset(): void {
    this.stats = {
      steps: 0,
      beats: 0,
      cadenceSpm: 0,
      rhythmPct: 0,
      currentStreak: 0,
      bestStreak: 0,
      lastErrMs: null,
    };
    this.legs = { left: emptyLeg(0.3 * this.width), right: emptyLeg(0.7 * this.width) };
    this.startedAt = 0;
    this.beatIndex = -1;
    this.beatHit = false;
    this.stepTimes = [];
  }

  /** Resting-aware lift for one leg: knee/ankle elevation above the auto-calibrated floor, 0..1. */
  private updateLeg(leg: Leg, ankleY: number, kneeY: number, hipY: number, footX: number): void {
    if (Number.isFinite(footX)) leg.footX = footX;
    if (!leg.baseInit) {
      leg.baseY = ankleY;
      leg.baseInit = true;
    }
    // The resting floor is the lowest the foot rests at (largest y). Snap up when planted lower; drift
    // slowly otherwise so a changed stance re-calibrates over a few seconds rather than sticking.
    if (ankleY > leg.baseY) leg.baseY = ankleY;
    else leg.baseY += (ankleY - leg.baseY) * 0.004;

    const legLen = Math.max(leg.baseY - hipY, 0.15); // hip → planted foot, normalized
    const ankleLift = (leg.baseY - ankleY) / (0.42 * legLen);
    // The knee rests ~halfway up the leg, so subtract that baseline before measuring its rise.
    const kneeLift = (leg.baseY - kneeY - 0.5 * legLen) / (0.42 * legLen);
    leg.lift = Math.max(0, Math.min(1, Math.max(ankleLift, kneeLift)));
  }

  /** Advance one frame. `s` is the lower-body sample, or null when the legs aren't tracked. */
  update(s: GaitSample | null, now: number): void {
    if (this.width === 0 || this.height === 0) return;
    if (this.startedAt === 0) this.startedAt = now;
    this.lastNow = now;

    if (s) {
      this.updateLeg(this.legs.left, s.left.ankleY, s.left.kneeY, s.hipY, s.left.footX);
      this.updateLeg(this.legs.right, s.right.ankleY, s.right.kneeY, s.hipY, s.right.footX);
    } else {
      this.legs.left.lift = 0;
      this.legs.right.lift = 0;
    }

    // Metronome: a new beat alternates the cued foot and closes out the previous cue.
    const idx = Math.floor((now - this.startedAt) / this.stepPeriodMs);
    if (idx !== this.beatIndex) {
      if (this.beatIndex >= 0 && !this.beatHit) {
        // a cue elapsed unstepped → break the streak
        this.stats.currentStreak = 0;
      }
      this.beatIndex = idx;
      this.beatHit = false;
      this.cuedSide = idx % 2 === 0 ? this.lead : other(this.lead);
      this.stats.beats += 1;
    }

    // Re-arm each foot once it drops back down (rising-edge step detection).
    for (const side of ["left", "right"] as const) {
      if (this.legs[side].lift < RELEASE_LIFT) this.legs[side].armed = true;
    }

    // Score the cued foot if it crosses the lift threshold within the beat window.
    const beatStart = this.startedAt + idx * this.stepPeriodMs;
    const cued = this.legs[this.cuedSide];
    if (!this.beatHit && cued.armed && cued.lift >= HIT_LIFT && now - beatStart <= this.stepPeriodMs * HIT_WINDOW_FRAC) {
      this.beatHit = true;
      cued.armed = false;
      cued.flashAt = now;
      this.stats.steps += 1;
      this.stats.currentStreak += 1;
      this.stats.bestStreak = Math.max(this.stats.bestStreak, this.stats.currentStreak);
      this.stats.lastErrMs = Math.round(now - beatStart);
      this.stepTimes.push(now);
      if (this.stepTimes.length > 8) this.stepTimes.shift();
    }

    // Derived rhythm metrics.
    this.stats.rhythmPct = this.stats.beats ? this.stats.steps / this.stats.beats : 0;
    if (this.stepTimes.length >= 2) {
      const span = this.stepTimes[this.stepTimes.length - 1] - this.stepTimes[0];
      const intervals = this.stepTimes.length - 1;
      this.stats.cadenceSpm = span > 0 ? Math.round((intervals * 60000) / span) : 0;
    }
  }

  // ---- render ---------------------------------------------------------------------------------------

  /** Render the stage. Caller has already cleared `ctx` to the stage colour (paper/white). */
  draw(ctx: CanvasRenderingContext2D, now: number): void {
    const w = this.width;
    const h = this.height;
    this.drawGrid(ctx);
    this.drawBeat(ctx, now);

    const floorY = h * 0.82;
    ctx.strokeStyle = "rgba(18,19,17,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, floorY + 0.5);
    ctx.lineTo(w, floorY + 0.5);
    ctx.stroke();

    this.drawPad(ctx, "left", floorY, now);
    this.drawPad(ctx, "right", floorY, now);
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

  /** Beat indicator — a pulsing emerald ring at top-centre marking the tempo. */
  private drawBeat(ctx: CanvasRenderingContext2D, now: number): void {
    const cx = this.width / 2;
    const cy = this.height * 0.12;
    const beatStart = this.startedAt + this.beatIndex * this.stepPeriodMs;
    const phase = Math.max(0, Math.min(1, (now - beatStart) / this.stepPeriodMs));
    const pop = 1 - phase; // bright right on the beat, fading toward the next
    ctx.save();
    ctx.strokeStyle = "rgba(18,19,17,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, 13, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "#16a35b";
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.35 + 0.65 * pop;
    ctx.beginPath();
    ctx.arc(cx, cy, 6 + 7 * pop, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    // tempo label — live cadence target
    ctx.fillStyle = "rgba(18,19,17,0.40)";
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText(`STEP TO THE BEAT · ${this.cadenceTargetSpm} SPM`, cx, cy + 30);
  }

  private drawPad(ctx: CanvasRenderingContext2D, side: Side, floorY: number, now: number): void {
    const leg = this.legs[side];
    const cued = side === this.cuedSide;
    const padW = Math.max(120, this.width * 0.22);
    const padH = Math.max(46, this.height * 0.1);
    const half = padW / 2;
    const cx = Math.max(half + 8, Math.min(this.width - half - 8, leg.footX || (side === "left" ? 0.3 : 0.7) * this.width));
    const top = floorY - padH;
    const r = 8;

    // hit flash — solid emerald fading out
    const flash = leg.flashAt > 0 ? Math.max(0, 1 - (now - leg.flashAt) / 280) : 0;

    // pad body
    ctx.save();
    roundRect(ctx, cx - half, top, padW, padH, r);
    if (flash > 0) {
      ctx.fillStyle = `rgba(22,163,91,${0.18 * flash})`;
      ctx.fill();
    }
    // lift fill — a column that rises with the leg's elevation
    ctx.save();
    roundRect(ctx, cx - half, top, padW, padH, r);
    ctx.clip();
    const fillH = padH * leg.lift;
    ctx.fillStyle = cued ? "rgba(22,163,91,0.16)" : "rgba(18,19,17,0.08)";
    ctx.fillRect(cx - half, floorY - fillH, padW, fillH);
    ctx.restore();

    // outline
    roundRect(ctx, cx - half, top, padW, padH, r);
    ctx.lineWidth = cued ? 2 : 1;
    ctx.strokeStyle = cued ? "#16a35b" : "rgba(18,19,17,0.22)";
    ctx.stroke();
    ctx.restore();

    // cue phase bar across the top of the active pad (counts down the beat window)
    if (cued && !this.beatHit) {
      const beatStart = this.startedAt + this.beatIndex * this.stepPeriodMs;
      const remain = Math.max(0, 1 - (now - beatStart) / (this.stepPeriodMs * HIT_WINDOW_FRAC));
      ctx.fillStyle = "#16a35b";
      ctx.fillRect(cx - half, top - 4, padW * remain, 3);
    }

    // label
    ctx.fillStyle = cued ? "#0a6e3e" : "rgba(18,19,17,0.40)";
    ctx.font = "11px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText(side.toUpperCase(), cx, floorY + 16);
  }
}

function other(s: Side): Side {
  return s === "left" ? "right" : "left";
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
