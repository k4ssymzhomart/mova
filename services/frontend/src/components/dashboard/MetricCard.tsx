type Props = {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
};

export default function MetricCard({ label, value, unit, hint }: Props) {
  const pending = value === "—";
  return (
    <div className="card">
      <div className="card-label">{label}</div>
      <div className={`metric-value ${pending ? "pending" : ""}`}>
        {value}
        {unit ? <span className="unit">{unit}</span> : null}
      </div>
      <div className="metric-foot">
        <span className="dot dot--idle" />
        {hint ?? "awaiting telemetry"}
      </div>
    </div>
  );
}
