const chartDefinitions = [
  { key: "fps", title: "Processing speed", unit: "FPS", color: "#258c70", tone: "green", format: (value) => value.toFixed(1) },
  { key: "latencyMs", title: "Inference time", unit: "ms", color: "#547fc8", tone: "blue", format: (value) => Math.round(value).toString() },
  { key: "people", title: "People in view", unit: "people", color: "#d58b38", tone: "amber", format: (value) => Math.round(value).toString() },
];

function MetricChart({ definition, samples, live }) {
  const values = samples.map((sample) => sample[definition.key]).filter(Number.isFinite);
  const latest = values.at(-1);
  const maxValue = Math.max(1, ...values) * 1.2;
  const left = 16;
  const right = 304;
  const top = 14;
  const bottom = 118;
  const points = values.map((value, index) => {
    const x = values.length === 1 ? (left + right) / 2 : left + ((right - left) * index) / (values.length - 1);
    const y = bottom - ((bottom - top) * value) / maxValue;
    return [x, y];
  });
  const linePoints = points.map(([x, y]) => `${x},${y}`).join(" ");
  const fillPoints = points.length ? `${left},${bottom} ${linePoints} ${right},${bottom}` : "";

  return (
    <article className={`metric-chart tone-${definition.tone}`}>
      <div className="metric-chart-heading">
        <div><span>{definition.title}</span><small>{live ? "Live · last 30 seconds" : "Latest session"}</small></div>
        <span className={`chart-live-indicator${live ? " is-live" : " is-paused"}`}><i />{live ? "LIVE" : "PAUSED"}</span>
      </div>
      <div className="metric-chart-value">
        <strong>{latest == null ? "—" : definition.format(latest)}</strong><span>{definition.unit}</span>
      </div>
      <svg className="metric-chart-plot" viewBox="0 0 320 132" role="img" aria-label={`${definition.title} over the last 30 seconds`}>
        {[top, top + 35, top + 70, bottom].map((y) => <line key={y} x1={left} x2={right} y1={y} y2={y} className="chart-gridline" />)}
        {points.length > 1 && <polygon points={fillPoints} className="chart-area" />}
        {points.length > 1 && <polyline points={linePoints} className="chart-line" />}
        {points.length === 1 && <circle cx={points[0][0]} cy={points[0][1]} r="4" className="chart-point" />}
        {points.length > 1 && <circle cx={points.at(-1)[0]} cy={points.at(-1)[1]} r="4" className="chart-point" />}
      </svg>
      <div className="chart-axis"><span>{samples.length ? "30s ago" : "Waiting for camera data"}</span><span>Now</span></div>
    </article>
  );
}

export default function PerformanceDashboard({ samples = [], live = false }) {
  return (
    <section className="performance-dashboard" aria-label="Live system performance graphs">
      <div className="performance-heading">
        <div><div className="section-kicker">SYSTEM PERFORMANCE</div><h2>Live performance</h2></div>
        <span className="performance-window">{live ? "Rolling 30 second view" : "Latest session"}</span>
      </div>
      <div className="performance-chart-grid">
        {chartDefinitions.map((definition) => <MetricChart key={definition.key} definition={definition} samples={samples} live={live} />)}
      </div>
    </section>
  );
}
