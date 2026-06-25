"use client";

// useLiveInference — the live inference bridge to the MOVA Python API backend.
//
// Streams pose-derived virtual-IMU windows ([200,6] = acc xyz + gyro xyz) to the backend's
// freezing-of-gait socket and maps each `FogPrediction` reply onto the live telemetry the session UI
// consumes. The socket origin is read STRICTLY from `NEXT_PUBLIC_BACKEND_WS_URL` (nothing hardcoded);
// the connection self-heals with exponential backoff. If the backend is unreachable — or the env var
// is unset, e.g. in local dev — the hook degrades to a clearly-flagged simulated readout so a training
// session never bricks.
//
// Backend contract (services/api/app/routers/predict.py + schemas.py):
//   • WS   `${NEXT_PUBLIC_BACKEND_WS_URL}/api/v1/predict/fog/stream`
//   • send `{ "window": number[][] /* [T,6] */, "sampling_rate": number }`
//   • recv `{ is_fog, confidence, timestamp, freeze_index, source }`  (or `{ error }`)
// `confidence` is the freeze probability (sigmoid around the Bachlin freeze-index threshold), which we
// surface directly as the 0..1 `risk`.

import { useCallback, useEffect, useRef, useState } from "react";

const CH = 6;
const STREAM_PATH = "/api/v1/predict/fog/stream";
const SAMPLING_RATE = 50;
const REPLY_TIMEOUT_MS = 1500; // drop a window if the backend doesn't answer in time
const CONNECT_TIMEOUT_MS = 3000; // run simulated meanwhile if the socket is slow to open
const BACKOFF_MIN_MS = 500;
const BACKOFF_MAX_MS = 10_000;

export type InferMode = "reach" | "gait";
export type Side = "left" | "right";
export type LiveStatus = "idle" | "loading" | "ready" | "unavailable" | "error";

// The backend prediction payload (app/schemas.py::FogPrediction).
interface FogPrediction {
  is_fog: boolean;
  confidence: number;
  timestamp: string;
  freeze_index: number | null;
  source: string;
}

export interface LivePrediction {
  har: { label: string; prob: number; top: { label: string; p: number }[] } | null;
  fog: { risk: number; valid: boolean } | null; // valid = lower-limb window (in-distribution for FoG)
  mode: InferMode;
  latencyMs: number;
  at: number;
  simulated?: boolean; // true when produced by the offline fallback, not the backend model
}

/** Backend socket URL from the public env var, or null when unconfigured. Trailing slashes trimmed so
 *  both `wss://host` and `wss://host/` resolve to the same endpoint. NEXT_PUBLIC_* is inlined at build. */
function streamUrl(): string | null {
  const base = process.env.NEXT_PUBLIC_BACKEND_WS_URL;
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}${STREAM_PATH}`;
}

/** Flat [T*6] virtual-IMU buffer → [T,6] rows, the shape the backend's FogWindow validator expects. */
function reshape(raw: Float32Array): number[][] {
  const rows: number[][] = [];
  for (let i = 0; i + CH <= raw.length; i += CH) {
    rows.push([raw[i], raw[i + 1], raw[i + 2], raw[i + 3], raw[i + 4], raw[i + 5]]);
  }
  return rows;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// — Simulated fallback ————————————————————————————————————————————————————————
// When the backend can't be reached we still produce a live, plausible, clearly-labelled readout so the
// session stays interactive. FoG risk drifts on a slow sine; HAR is drawn from a mode-appropriate label
// pool. Everything is flagged `simulated: true`.
const MOCK_HAR: Record<InferMode, string[]> = {
  gait: ["walking", "stairs_up", "stairs_down", "standing", "knees_bending_crouching"],
  reach: ["frontal_elevation_arms", "lateral_elevation_arms", "arms_inner_rotation", "shoulders_high_rotation", "frontal_crossing_arms"],
};

function softmax(logits: number[]): number[] {
  const m = Math.max(...logits);
  const ex = logits.map((v) => Math.exp(v - m));
  const s = ex.reduce((a, b) => a + b, 0) || 1;
  return ex.map((v) => v / s);
}

function mockPredict(mode: InferMode, side: Side, tick: number): LivePrediction {
  const base = mode === "gait" ? 0.32 : 0.16;
  const phase = side === "left" ? 0 : Math.PI / 3; // small deterministic offset per side
  const wave = (Math.sin(tick / 9 + phase) + 1) / 2;
  const jitter = (Math.random() - 0.5) * 0.07;
  const risk = clamp01(base + wave * 0.4 + jitter);

  const labels = MOCK_HAR[mode];
  const lead = Math.floor(((Math.sin(tick / 17 + phase) + 1) / 2) * labels.length) % labels.length;
  const ranked = labels
    .map((label, i) => ({ label, p: i === lead ? 1.6 : Math.random() * 0.5 }))
    .sort((a, b) => b.p - a.p);
  const probs = softmax(ranked.map((r) => r.p));
  const top = ranked.map((r, i) => ({ label: r.label, p: probs[i] })).slice(0, 3);

  return {
    har: { label: top[0].label, prob: top[0].p, top },
    fog: { risk, valid: mode === "gait" },
    mode,
    latencyMs: 0,
    at: performance.now(),
    simulated: true,
  };
}

type StateChange = { status: LiveStatus; simulated: boolean };

// Imperative WebSocket controller. Kept off the React render path (lives in a ref) so reconnects and
// in-flight bookkeeping don't churn component state; it pushes status/simulated changes back via a
// callback. One window is in flight at a time, so replies (which the backend emits in receive order)
// correlate to sends without needing a correlation id the payload doesn't carry.
class LiveSocket {
  private ws: WebSocket | null = null;
  private pending: { resolve: (p: FogPrediction | null) => void; timer: number } | null = null;
  private backoff = BACKOFF_MIN_MS;
  private reconnectTimer: number | null = null;
  private closed = false;
  private readonly url: string | null;
  private readonly onState: (s: StateChange) => void;

  constructor(onState: (s: StateChange) => void) {
    this.url = streamUrl();
    this.onState = onState;
  }

  /** Begin the connection lifecycle, or go straight to simulated when no backend is configured. */
  start(): void {
    this.closed = false;
    if (!this.url) {
      this.onState({ status: "ready", simulated: true });
      return;
    }
    this.onState({ status: "loading", simulated: false });
    this.connect();
  }

  private connect(): void {
    if (this.closed || !this.url) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    // If the socket is slow to open, run simulated in the meantime; this same socket may still open.
    const connectTimer = window.setTimeout(() => this.onState({ status: "ready", simulated: true }), CONNECT_TIMEOUT_MS);
    ws.onopen = () => {
      window.clearTimeout(connectTimer);
      this.backoff = BACKOFF_MIN_MS;
      this.onState({ status: "ready", simulated: false });
    };
    ws.onmessage = (ev) => this.handleMessage(ev);
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* close() can throw if already closing */
      }
    };
    ws.onclose = () => {
      window.clearTimeout(connectTimer);
      if (this.ws === ws) this.ws = null;
      this.settlePending(null);
      this.scheduleReconnect();
    };
  }

  private handleMessage(ev: MessageEvent): void {
    let data: unknown;
    try {
      data = JSON.parse(typeof ev.data === "string" ? ev.data : "");
    } catch {
      return;
    }
    // Backend emits either a FogPrediction or `{ error }`; only the former carries `confidence`.
    const ok = !!data && typeof data === "object" && typeof (data as { confidence?: unknown }).confidence === "number";
    this.settlePending(ok ? (data as FogPrediction) : null);
  }

  private settlePending(value: FogPrediction | null): void {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    window.clearTimeout(p.timer);
    p.resolve(value);
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    // Backend unreachable → degrade to simulated and keep retrying with growing backoff.
    this.onState({ status: "ready", simulated: true });
    const delay = this.backoff;
    this.backoff = Math.min(BACKOFF_MAX_MS, this.backoff * 2);
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
  }

  isLive(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  /** Send one window; resolves with the backend prediction, or null if not connected / busy / timed out. */
  send(frame: number[][]): Promise<FogPrediction | null> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || this.pending) return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        if (this.pending?.timer === timer) {
          this.pending = null;
          resolve(null);
        }
      }, REPLY_TIMEOUT_MS);
      this.pending = { resolve, timer };
      try {
        ws.send(JSON.stringify({ window: frame, sampling_rate: SAMPLING_RATE }));
      } catch {
        this.settlePending(null);
      }
    });
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer != null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.settlePending(null);
    try {
      this.ws?.close();
    } catch {
      /* already closing */
    }
    this.ws = null;
  }
}

export function useLiveInference() {
  const [status, setStatus] = useState<LiveStatus>("idle");
  const [simulated, setSimulated] = useState(false);
  const [ready, setReady] = useState(false);
  const socketRef = useRef<LiveSocket | null>(null);
  const tickRef = useRef(0);

  const ensure = useCallback((): LiveSocket => {
    if (!socketRef.current) {
      socketRef.current = new LiveSocket(({ status: s, simulated: sim }) => {
        setStatus(s);
        setSimulated(sim);
        setReady(true);
      });
    }
    return socketRef.current;
  }, []);

  // Open (or reopen) the backend socket for this session. Safe to call repeatedly.
  const loadAll = useCallback(async () => {
    ensure().start();
  }, [ensure]);

  // Score one virtual-IMU window. Tries the backend socket; on any miss (no backend, not yet connected,
  // busy, or a timed-out reply) falls back to a clearly-flagged simulated readout so the loop never stalls.
  const infer = useCallback(
    async (raw: Float32Array, mode: InferMode = "reach", side: Side = "right"): Promise<LivePrediction | null> => {
      const sock = ensure();
      if (sock.isLive()) {
        const t0 = performance.now();
        const pred = await sock.send(reshape(raw));
        if (pred) {
          return {
            har: null, // the backend stream is FoG-only; HAR is not part of this contract
            fog: { risk: clamp01(pred.confidence), valid: mode === "gait" },
            mode,
            latencyMs: performance.now() - t0,
            at: performance.now(),
            simulated: false,
          };
        }
      }
      return mockPredict(mode, side, ++tickRef.current);
    },
    [ensure],
  );

  // Tear the socket down on unmount so we don't leak a reconnect loop across route changes.
  useEffect(
    () => () => {
      socketRef.current?.close();
      socketRef.current = null;
    },
    [],
  );

  return { status, ready, simulated, loadAll, infer };
}
