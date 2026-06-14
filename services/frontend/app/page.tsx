import MetricCard from "@/components/MetricCard";
import PosePlaceholder from "@/components/PosePlaceholder";
import StreamStatus from "@/components/StreamStatus";
import TelemetryStrip from "@/components/TelemetryStrip";

export default function Page() {
  return (
    <main className="shell">
      <header className="header">
        <div className="brand">
          <div className="brand-mark" />
          <div>
            <h1>Mova · Clinician Console</h1>
            <p>IMU rehabilitation · freezing-of-gait monitoring</p>
          </div>
        </div>
        <div className="header-meta">
          SESSION —
          <br />
          MODEL: mock · v0.1.0
        </div>
      </header>

      <section className="bento">
        <PosePlaceholder />
        <StreamStatus />
        <MetricCard label="Cadence" value="—" unit="spm" hint="steps / minute" />
        <MetricCard label="Gait symmetry" value="—" unit="%" hint="left / right index" />
        <MetricCard label="Stride length" value="—" unit="m" hint="per stride" />
        <MetricCard label="Freeze index" value="—" hint="Bachlin FI · 3–8 Hz" />
        <TelemetryStrip />
      </section>

      <footer className="footer">
        <span className="dot dot--idle" />
        Decision support, not diagnosis · placeholder values until the model and live stream are connected.
      </footer>
    </main>
  );
}
