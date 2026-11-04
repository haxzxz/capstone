import Icon from "./Icon.jsx";

/** Display the dashboard's local wall clock; alert scheduling uses this same browser timezone. */
export default function ClockBadge({ date = new Date() }) {
  return (
    <div className="clock-card">
      <Icon name="clock" size={17} />
      <span>{date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
      <i />
      {date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
    </div>
  );
}
