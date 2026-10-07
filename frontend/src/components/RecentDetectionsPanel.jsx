import Icon from "./Icon.jsx";

export default function RecentDetectionsPanel({ events = [], unavailable = true, onViewLog }) {
  return (
    <section className="panel alerts-panel" aria-label="Recent detection events">
      <div className="panel-heading alerts-heading">
        <div><div className="section-kicker">EVENT ACTIVITY</div><h2>Recent detections</h2></div>
        <span className="event-count">{events.length}</span>
      </div>
      {events.length === 0 ? (
        <div className="empty-events">
          <div className="empty-icon"><Icon name="alert" size={19} /></div>
          <strong>{unavailable ? "No events to display" : "No detections yet"}</strong>
          <p>{unavailable ? "Detection events with timestamps, confidence, and zone results will appear here when the AI service is connected." : "New pedestrian detections will appear here."}</p>
        </div>
      ) : (
        <ul className="event-list">{events.map((event) => <li className="event-row" key={event.id}><span className="event-dot"/><div><strong>{event.label}</strong><small>{event.time} · {event.zoneResult}</small></div><b>{event.confidence}%</b></li>)}</ul>
      )}
      <button className="log-button" disabled={unavailable} onClick={onViewLog}><Icon name="refresh" size={15} />{unavailable ? "Event log unavailable" : "View event log"}</button>
    </section>
  );
}
