// FoG episode detector — a small hysteresis state machine over the live FoG-risk stream.
//
// The FoG model emits a noisy per-window risk every inference tick (~600 ms). For the clinical
// fog_events table we want smoothed *episodes*, not per-window noise: enter when risk crosses a
// high threshold, stay open while it remains above a lower exit threshold, and close after it has
// stayed low for a debounce. Episodes shorter than a floor are discarded as spurious. Only
// in-distribution (gait / lower-limb) windows count — `valid=false` closes any open episode.

export interface FogEpisode {
  kind: "episode";
  started_at: string; // ISO 8601 wall-clock
  ended_at: string; // ISO 8601 wall-clock
  confidence: number; // peak risk reached during the episode (0..1)
  freeze_index: number; // proxy = peak risk (true Bachlin FI needs raw accel band power, not available client-side)
  source: string; // model id, e.g. "fog.onnx"
}

interface OpenEpisode {
  startWall: number; // Date.now() at onset
  peak: number;
  lastHighWall: number; // last time risk was >= exit threshold
}

export interface FogDetectorOptions {
  enter?: number; // onset threshold
  exit?: number; // sustain threshold (hysteresis)
  minOnMs?: number; // discard episodes shorter than this
  minOffMs?: number; // close after risk has been below `exit` for this long
  source?: string;
}

export class FogEpisodeDetector {
  private open: OpenEpisode | null = null;
  private readonly enter: number;
  private readonly exit: number;
  private readonly minOnMs: number;
  private readonly minOffMs: number;
  private readonly source: string;

  constructor(opts: FogDetectorOptions = {}) {
    this.enter = opts.enter ?? 0.6;
    this.exit = opts.exit ?? 0.4;
    this.minOnMs = opts.minOnMs ?? 600;
    this.minOffMs = opts.minOffMs ?? 1000;
    this.source = opts.source ?? "fog.onnx";
  }

  /**
   * Feed one risk reading. `valid` gates on in-distribution (gait) windows. Returns a freshly
   * *closed* episode if this reading ended one, otherwise null.
   */
  update(risk: number, valid: boolean, wall: number): FogEpisode | null {
    if (!valid) return this.finalize(wall); // leaving the in-distribution regime closes any open episode

    if (this.open) {
      this.open.peak = Math.max(this.open.peak, risk);
      if (risk >= this.exit) {
        this.open.lastHighWall = wall;
        return null;
      }
      // below the sustain threshold — close only once we've stayed low long enough
      if (wall - this.open.lastHighWall >= this.minOffMs) return this.close();
      return null;
    }

    if (risk >= this.enter) {
      this.open = { startWall: wall, peak: risk, lastHighWall: wall };
    }
    return null;
  }

  /** Close any episode still open (call once on stop). */
  finalize(_wall: number): FogEpisode | null {
    return this.open ? this.close() : null;
  }

  private close(): FogEpisode | null {
    const ep = this.open;
    this.open = null;
    if (!ep) return null;
    const end = Math.max(ep.lastHighWall, ep.startWall);
    if (end - ep.startWall < this.minOnMs) return null; // too short — spurious
    const peak = Math.round(ep.peak * 1000) / 1000;
    return {
      kind: "episode",
      started_at: new Date(ep.startWall).toISOString(),
      ended_at: new Date(end).toISOString(),
      confidence: peak,
      freeze_index: peak,
      source: this.source,
    };
  }
}
