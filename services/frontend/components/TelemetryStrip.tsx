export default function TelemetryStrip() {
  const bars = Array.from({ length: 48 }, (_, i) => 18 + ((i * 37) % 70));
  return (
    <div className="card card--full">
      <div className="card-label">Gait telemetry · cadence / stride / symmetry</div>
      <div className="telemetry-bars" aria-hidden="true">
        {bars.map((h, i) => (
          <i key={i} className="shimmer" style={{ height: `${h}%` }} />
        ))}
      </div>
      <div className="metric-foot">
        <span className="dot dot--idle" />
        live waveform renders here once the stream is bound
      </div>
    </div>
  );
}
