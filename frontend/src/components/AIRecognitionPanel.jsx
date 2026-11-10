import { useState } from "react";
import Icon from "./Icon.jsx";

/** Present model/service metrics and provide schedule and manual alert controls. */
export default function AIRecognitionPanel({
  modelName = "YOLOv11",
  modelDescription = "Pedestrian detection model",
  status = "STANDBY",
  statusMessage = "Waiting for inference feed",
  statusDetail = "Camera is available; AI service is not connected.",
  detectionZone = "Not configured",
  schoolSchedule,
  onSchoolScheduleChange,
  scheduleAlertStatus = "",
  manualMode = false,
  onManualModeChange,
  onManualAlertStart,
  onManualAlertStop,
  manualAlertActive = false,
  manualAlertStatus = "",
  inferenceRate = "—",
  inferenceMs,
  requestMs,
  roundTripMs,
  zoneIntersections = "—",
}) {
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [scheduleDraft, setScheduleDraft] = useState(schoolSchedule || "");

  const saveSchedule = (event) => {
    // Keep the schedule in the parent so persistence and the daily timer have one source of truth.
    event.preventDefault();
    if (!scheduleDraft) return;
    onSchoolScheduleChange?.(scheduleDraft);
    setEditingSchedule(false);
  };

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
        <div className="school-schedule-row">
          <span>School schedule</span>
          <div className="school-schedule-value">
            <strong>{schoolSchedule ? `Daily at ${schoolSchedule}` : "Not configured"}</strong>
            <button className="schedule-configure-button" type="button" onClick={() => { setScheduleDraft(schoolSchedule || "08:00"); setEditingSchedule((editing) => !editing); }}>
              {editingSchedule ? "Cancel" : "Configure"}
            </button>
          </div>
        </div>
        {editingSchedule && <form className="schedule-form" onSubmit={saveSchedule}>
          <label htmlFor="school-alert-time">Daily alert time</label>
          <div><input id="school-alert-time" type="time" required value={scheduleDraft} onChange={(event) => setScheduleDraft(event.target.value)} />
            <button className="schedule-save-button" type="submit">Save time</button></div>
          {schoolSchedule && <button className="schedule-clear-button" type="button" onClick={() => { onSchoolScheduleChange?.(""); setEditingSchedule(false); }}>Turn off scheduled alert</button>}
          <small>Alert repeats daily while this dashboard is open.</small>
        </form>}
        <div><span>Processed rate</span><strong>{inferenceRate} <small>FPS</small></strong></div>
        {showTechnicalDetails && <>
          <div><span>Model inference</span><strong>{inferenceMs ?? "—"} <small>ms</small></strong></div>
          <div><span>API processing</span><strong>{requestMs ?? "—"} <small>ms</small></strong></div>
          <div><span>Browser round trip</span><strong>{roundTripMs != null ? Math.round(roundTripMs) : "—"} <small>ms</small></strong></div>
          <div><span>Zone intersections</span><strong>{zoneIntersections} <small>events</small></strong></div>
        </>}
      </div>
      {scheduleAlertStatus && <p className="schedule-alert-status" role="status">{scheduleAlertStatus}</p>}
      <div className="alert-mode-row">
        <div><strong>Alert mode</strong><small>{manualMode ? "Manual controls detection alerts; scheduled alerts still run." : "Detection alerts run automatically."}</small></div>
        <button className="alert-mode-toggle" type="button" aria-pressed={manualMode} onClick={() => onManualModeChange?.(!manualMode)}>
          {manualMode ? "Manual" : "Automatic"}
        </button>
      </div>
      {manualMode && <div className="manual-alert-controls">
        <button type="button" className="manual-alert-start" onClick={onManualAlertStart} disabled={manualAlertActive}>Trigger alert</button>
        <button type="button" className="manual-alert-stop" onClick={onManualAlertStop} disabled={!manualAlertActive}>Stop alert</button>
      </div>}
      {manualMode && manualAlertStatus && <p className="manual-alert-status" role="status">{manualAlertStatus}</p>}
    </section>
  );
}
