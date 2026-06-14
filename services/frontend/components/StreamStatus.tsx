"use client";

import { useEffect, useState } from "react";

const STATES = [
  { dot: "dot--idle", label: "AWAITING DEVICE", sub: "No IMU stream bound" },
  { dot: "dot--wait", label: "HANDSHAKING", sub: "Negotiating ws /api/v1/predict/fog/stream" },
  { dot: "dot--live", label: "LIVE", sub: "50 Hz · 6-channel acc + gyro" },
] as const;

export default function StreamStatus() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((p) => (p + 1) % STATES.length), 2600);
    return () => clearInterval(t);
  }, []);
  const s = STATES[i];
  return (
    <div className="card card--wide">
      <div className="card-label">Real-time stream</div>
      <div className="status-row">
        <span className={`dot ${s.dot}`} />
        <span>{s.label}</span>
      </div>
      <div className="status-sub">{s.sub}</div>
    </div>
  );
}
