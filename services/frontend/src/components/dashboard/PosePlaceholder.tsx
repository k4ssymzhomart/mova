export default function PosePlaceholder() {
  return (
    <div className="card card--pose">
      <div className="card-label">3D pose reconstruction</div>
      <div className="pose-stage" />
      <div className="pose-overlay">
        <svg width="116" height="150" viewBox="0 0 116 150" className="skeleton" aria-hidden="true">
          <g stroke="var(--muted)" strokeWidth="2" fill="none" strokeLinecap="round">
            <circle cx="58" cy="20" r="11" />
            <line x1="58" y1="31" x2="58" y2="84" />
            <line x1="58" y1="44" x2="30" y2="64" />
            <line x1="58" y1="44" x2="86" y2="64" />
            <line x1="58" y1="84" x2="38" y2="126" />
            <line x1="58" y1="84" x2="78" y2="126" />
          </g>
          <g fill="var(--accent)">
            <circle cx="58" cy="44" r="3" />
            <circle cx="58" cy="84" r="3" />
          </g>
        </svg>
        <div className="tag">3D pose · engine offline</div>
      </div>
    </div>
  );
}
