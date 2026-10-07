import Icon from "./Icon.jsx";

const defaultStats = [
  { label: "Pedestrians detected", value: "—", note: "Awaiting AI inference", icon: "scan", tone: "tone-blue" },
  { label: "Alerts triggered", value: "—", note: "Event log unavailable", icon: "alert", tone: "tone-amber" },
  { label: "Detection confidence", value: "—", note: "YOLOv11 model feed", icon: "pulse", tone: "tone-green" },
];

function StatCard({ label, value, note, icon, tone }) {
  return (
    <article className="stat-card">
      <span className={`stat-icon ${tone}`}><Icon name={icon} size={17} /></span>
      <div className="stat-copy"><span className="stat-label">{label}</span><strong>{value}</strong><small>{note}</small></div>
    </article>
  );
}

export default function StatsGrid({ stats = defaultStats }) {
  return <section className="stats-grid" aria-label="Detection metrics">{stats.map((stat) => <StatCard key={stat.label} {...stat} />)}</section>;
}
