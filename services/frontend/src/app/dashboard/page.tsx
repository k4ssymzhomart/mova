import Link from "next/link";

import MetricCard from "@/components/dashboard/MetricCard";
import PosePlaceholder from "@/components/dashboard/PosePlaceholder";
import StreamStatus from "@/components/dashboard/StreamStatus";
import TelemetryStrip from "@/components/dashboard/TelemetryStrip";

import "./dashboard.css";

/** /dashboard — the dark clinician console (migrated from the former root page). */
export default function DashboardPage() {
  return (
    <div className="dashboard-root">
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
            <Link
              href="/session"
              style={{
                display: "inline-block",
                border: "1px solid rgba(255,255,255,0.4)",
                padding: "6px 14px",
                fontFamily: "var(--font-mono, ui-monospace, monospace)",
                fontSize: 11,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "inherit",
                textDecoration: "none",
              }}
            >
              Start session →
            </Link>
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
          Decision support, not diagnosis · placeholder values until the model and live stream are
          connected.
        </footer>
      </main>
    </div>
  );
}
