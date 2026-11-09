import Icon from "./Icon.jsx";

/** Display the dashboard's local wall clock; alert scheduling uses this same browser timezone. */
export default function ClockBadge({ date = new Date() }) {
  return (
    <div className="clock-card">
      <Icon name="clock" size={17} />
      <span className="clock-time">{date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
      <span className="clock-time-compact">{date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      <i />
      <span className="clock-date">{date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</span>
    </div>
  );
}
