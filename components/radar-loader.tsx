export function RadarLoader({ overlay = false, label = "Radar ищет объекты…" }: { overlay?: boolean; label?: string }) {
  return <div className={overlay ? "radar-loader radar-loader-overlay" : "radar-loader"} role="status" aria-live="polite" aria-label={label}>
    <div className="radar-loader-mark" aria-hidden="true"><i/><b/><em/><span/></div>
    <strong>{label}</strong>
  </div>;
}
