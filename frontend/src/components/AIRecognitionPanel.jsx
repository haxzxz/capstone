import { useState } from "react";
import Icon from "./Icon.jsx";

export default function AIRecognitionPanel({
  modelName = "YOLOv11",
  modelDescription = "Pedestrian detection model",
  status = "STANDBY",
  statusMessage = "Waiting for inference feed",
  statusDetail = "Camera is available; AI service is not connected.",
  detectionZone = "Not configured",
  schoolSchedule = "Not configured",
  inferenceRate = "—",
  inferenceMs,
  requestMs,
  roundTripMs,
  zoneIntersections = "—",
}) {
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);

  return (
    <section className="panel ai-panel" aria-label="AI recognition status">
      <div className="panel-heading">
        <div><div className="section-kicker">SYSTEM STATUS</div><h2>AI recognition</h2></div>
        <span className="ai-chip"><i />{status}</span>
      </div>
      <div className="model-card">
        <div className="model-mark"><Icon name="scan" size={20} /></div>
        <div className="model-info"><strong>{modelName}</strong><span>{modelDescription}</span></div>
        <span className="model-version">MODEL</span>
      </div>
      <div className="recognition-status">
        <span className="status-ring"><Icon name="pulse" size={19} /></span>
        <div><strong>{statusMessage}</strong><p>{statusDetail}</p></div>
      </div>
      <div className="panel-divider" />
      <div className="status-controls">
        <h3>System details</h3>
        <button
          className="status-details-toggle"
          type="button"
          aria-label={showTechnicalDetails ? "Hide technical details" : "Show technical details"}
          aria-expanded={showTechnicalDetails}
          title={showTechnicalDetails ? "Hide technical details" : "Show technical details"}
          onClick={() => setShowTechnicalDetails((shown) => !shown)}
        >
          <Icon name={showTechnicalDetails ? "eyeOff" : "eye"} size={21} />
        </button>
      </div>
      <div className="metric-list">
        <div><span>Detection zone</span><strong><i className="status-neutral" />{detectionZone}</strong></div>
        <div><span>School schedule</span><strong><i className="status-neutral" />{schoolSchedule}</strong></div>
        <div><span>Processed rate</span><strong>{inferenceRate} <small>FPS</small></strong></div>
        {showTechnicalDetails && <>
          <div><span>Model inference</span><strong>{inferenceMs ?? "—"} <small>ms</small></strong></div>
          <div><span>API processing</span><strong>{requestMs ?? "—"} <small>ms</small></strong></div>
          <div><span>Browser round trip</span><strong>{roundTripMs != null ? Math.round(roundTripMs) : "—"} <small>ms</small></strong></div>
          <div><span>Zone intersections</span><strong>{zoneIntersections} <small>events</small></strong></div>
        </>}
      </div>
    </section>
  );
}
