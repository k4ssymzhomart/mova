// Sliding-window virtual-IMU buffer.
//
// MediaPipe runs at the webcam's variable ~30 fps; the models expect 200 frames at a fixed 50 Hz over
// 4 s. This pipeline turns each pose frame into one 6-channel virtual-IMU sample (using a 3-frame
// history for the central-difference accelerometer), rings them, and resamples the last 4 s to exactly
// 200 evenly-spaced points by linear interpolation — the browser-side analogue of the Phase-2
// align→50 Hz→window stage.

import type { Landmark } from "./landmarks";
import { type Mat3, type Side, type Vec3, accelFromPositions, forearmFrame, gyroFromFrames } from "./poseToImu";

const WIN = 200;
const RATE = 50;
const WIN_MS = (WIN / RATE) * 1000; // 4000 ms
const STEP_MS = 1000 / RATE; // 20 ms
const CH = 6;
const RING_MS = WIN_MS + 1200; // a little slack beyond the window

interface Sample {
  t: number;
  v: Float64Array; // [ax,ay,az,gx,gy,gz] — g, rad/s
}
interface FrameRec {
  t: number;
  R: Mat3;
  pos: Vec3;
}

export class VirtualImuPipeline {
  private frames: FrameRec[] = []; // rolling last-3 for central differences
  private ring: Sample[] = [];
  side: Side = "right";

  reset(): void {
    this.frames = [];
    this.ring = [];
  }

  /** Feed one MediaPipe world-landmark frame. Untracked frames are skipped (interp bridges gaps). */
  push(world: Landmark[], tMs: number): void {
    const frame = forearmFrame(world, this.side);
    if (!frame) return;
    this.frames.push({ t: tMs, R: frame.R, pos: frame.pos });
    if (this.frames.length > 3) this.frames.shift();
    if (this.frames.length === 3) {
      const [f0, f1, f2] = this.frames;
      const dtAccel = (f2.t - f0.t) / 2 / 1000;
      const dtGyro = (f2.t - f1.t) / 1000;
      const accel = accelFromPositions(f0.pos, f1.pos, f2.pos, f1.R, dtAccel); // m/s²
      const gyro = gyroFromFrames(f1.R, f2.R, dtGyro); // rad/s
      const v = new Float64Array(CH);
      v[0] = accel[0] / 9.80665;
      v[1] = accel[1] / 9.80665;
      v[2] = accel[2] / 9.80665;
      v[3] = gyro[0];
      v[4] = gyro[1];
      v[5] = gyro[2];
      this.ring.push({ t: f1.t, v });
    }
    const cutoff = tMs - RING_MS;
    while (this.ring.length && this.ring[0].t < cutoff) this.ring.shift();
  }

  /** Fraction of the 4 s window currently covered (0..1). */
  fill(now: number): number {
    if (this.ring.length < 2) return 0;
    return Math.min(1, (now - this.ring[0].t) / WIN_MS);
  }

  /** Resample the last 4 s to [200,6] row-major (t-major), or null if not yet full. */
  window(now: number): Float32Array | null {
    if (this.ring.length < 2 || this.fill(now) < 1) return null;
    const out = new Float32Array(WIN * CH);
    const start = now - WIN_MS;
    let j = 0;
    for (let k = 0; k < WIN; k += 1) {
      const tk = start + k * STEP_MS;
      while (j < this.ring.length - 2 && this.ring[j + 1].t < tk) j += 1;
      const a = this.ring[Math.min(j, this.ring.length - 1)];
      const b = this.ring[Math.min(j + 1, this.ring.length - 1)];
      const span = b.t - a.t;
      const w = span > 0 ? Math.min(1, Math.max(0, (tk - a.t) / span)) : 0;
      for (let c = 0; c < CH; c += 1) {
        out[k * CH + c] = a.v[c] + (b.v[c] - a.v[c]) * w;
      }
    }
    return out;
  }
}
