export function RadarLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`logo ${compact ? "logo-compact" : ""}`} aria-label="HSE Radar">
      <svg viewBox="0 0 48 48" role="img" aria-hidden="true">
        <circle cx="24" cy="24" r="22" fill="#C9FF4F" />
        <circle cx="24" cy="24" r="12" fill="none" stroke="#0B1512" strokeWidth="2" />
        <circle cx="24" cy="24" r="4" fill="#0B1512" />
        <path d="M24 24L35 14" stroke="#0B1512" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      {!compact && <span><strong>HSE Radar</strong><small>CONTROL SYSTEM</small></span>}
    </div>
  );
}
