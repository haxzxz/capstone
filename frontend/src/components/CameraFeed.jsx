import { useRef, useState } from "react";
import Icon from "./Icon.jsx";

const statusLabels = {
  starting: { badge: "CONNECTING", title: "Connecting to camera", detail: "Waiting for camera access…" },
  error: { badge: "CAMERA ERROR", title: "Camera unavailable" },
  idle: { badge: "STREAM OFFLINE", title: "Camera is offline", detail: "Turn on the camera to resume the live view." },
};

export default function CameraFeed({
  videoRef,
  status,
  error,
  cameras,
  cameraId,
  onCameraChange,
  onStart,
  onStop,
  clock,
  detections = [],
  frameWidth,
  frameHeight,
  cameraFps = 0,
  detectionZone,
  editingZone,
  onEditingZoneChange,
  onDetectionZoneChange,
  onDetectionZoneReset,
}) {
  const live = status === "live";
  const offlineContent = statusLabels[status] ?? statusLabels.idle;
  const cameraViewRef = useRef(null);
  const dragStartRef = useRef(null);
  const [draftZone, setDraftZone] = useState(null);
  const viewWidth = frameWidth || videoRef.current?.videoWidth || 640;
  const viewHeight = frameHeight || videoRef.current?.videoHeight || 360;

  const pointerToNormalized = (event) => {
    const rect = cameraViewRef.current.getBoundingClientRect();
    const video = videoRef.current;
    const sourceWidth = video?.videoWidth || viewWidth;
    const sourceHeight = video?.videoHeight || viewHeight;
    const scale = Math.max(rect.width / sourceWidth, rect.height / sourceHeight);
    const renderedWidth = sourceWidth * scale;
    const renderedHeight = sourceHeight * scale;
    const cropX = (renderedWidth - rect.width) / 2;
    const cropY = (renderedHeight - rect.height) / 2;
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left + cropX) / renderedWidth)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top + cropY) / renderedHeight)),
    };
  };

  const updateDraftZone = (point) => {
    const start = dragStartRef.current;
    if (!start) return;
    setDraftZone({
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    });
  };

  const finishZoneDrag = (event) => {
    if (!dragStartRef.current) return;
    const start = dragStartRef.current;
    const end = pointerToNormalized(event);
    const nextZone = {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    };
    dragStartRef.current = null;
    setDraftZone(null);
    if (nextZone.width >= 0.02 && nextZone.height >= 0.02) {
      onDetectionZoneChange(nextZone);
      onEditingZoneChange(false);
    }
  };

  const cancelZoneEditing = () => {
    dragStartRef.current = null;
    setDraftZone(null);
    onEditingZoneChange(false);
  };

  return (
    <section className="camera-card" aria-label="Live camera feed">
      <div className="camera-toolbar">
        <div className="camera-name">
          <span className={`live-dot ${live ? "is-live" : ""}`} />
          <div><strong>CAM 01</strong><small>School zone camera</small></div>
        </div>
        <div className="camera-toolbar-right">
          <span className={`stream-badge ${live ? "stream-badge-live" : ""}`}>
            {live ? "STREAM LIVE" : offlineContent.badge}
          </span>
          <span className="resolution">{live ? "LIVE FEED" : "NO SIGNAL"}</span>
        </div>
      </div>

      <div className="camera-view" ref={cameraViewRef}>
        <video ref={videoRef} autoPlay playsInline muted className="camera-video" style={{ opacity: live ? 1 : 0 }} />
        {live && (
          <svg
            className="camera-detection-overlay"
            viewBox={`0 0 ${viewWidth} ${viewHeight}`}
            preserveAspectRatio="xMidYMid slice"
            role={editingZone ? "application" : "img"}
            aria-label={editingZone ? "Drag on the camera image to draw the detection area" : `${detections.length} people detected`}
            style={{ pointerEvents: editingZone ? "auto" : "none", touchAction: editingZone ? "none" : "auto", cursor: editingZone ? "crosshair" : "default" }}
            onPointerDown={(event) => {
              if (!editingZone) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              dragStartRef.current = pointerToNormalized(event);
              setDraftZone({ ...dragStartRef.current, width: 0, height: 0 });
            }}
            onPointerMove={(event) => {
              if (editingZone && dragStartRef.current) updateDraftZone(pointerToNormalized(event));
            }}
            onPointerUp={finishZoneDrag}
            onPointerCancel={cancelZoneEditing}
          >
            {editingZone && <rect x="0" y="0" width={viewWidth} height={viewHeight} className="zone-editor-hit-area" />}
            {detections.map(({ box, confidence }, index) => {
              const [x1, y1, x2, y2] = box;
              return (
                <g key={`${index}-${box.join(",")}`}>
                  <rect x={x1} y={y1} width={x2 - x1} height={y2 - y1} />
                  <text x={x1 + 4} y={Math.max(18, y1 - 6)}>Person {Math.round(confidence)}%</text>
                </g>
              );
            })}
            {detectionZone && !draftZone && (
              <g className="detection-zone-shape">
                <rect x={detectionZone.x * viewWidth} y={detectionZone.y * viewHeight} width={detectionZone.width * viewWidth} height={detectionZone.height * viewHeight} />
                <text x={detectionZone.x * viewWidth + 8} y={detectionZone.y * viewHeight + 22}>DETECTION AREA</text>
              </g>
            )}
            {draftZone && (
              <rect className="detection-zone-draft" x={draftZone.x * viewWidth} y={draftZone.y * viewHeight} width={draftZone.width * viewWidth} height={draftZone.height * viewHeight} />
            )}
            {editingZone && <text className="zone-editor-instruction" x={viewWidth / 2} y={28} textAnchor="middle">Drag to draw the detection area</text>}
          </svg>
        )}
        <div className="view-vignette" />
        {live && <div className="view-grid" />}
        {!live && (
          <div className="camera-placeholder">
            <div className="placeholder-symbol"><Icon name={status === "error" ? "alert" : "camera"} size={25} /></div>
            <strong>{offlineContent.title}</strong>
            <p>{status === "error" ? error : offlineContent.detail}</p>
            <button className="primary-button" onClick={onStart}>Start camera</button>
          </div>
        )}
        {live && <div className="feed-overlay"><span><i />REC</span><span className="camera-fps">CAM {cameraFps || "—"} FPS</span><span>{clock.toLocaleTimeString([], { hour12: false })}</span></div>}
        {live && <button className="expand-button" title="Fullscreen" onClick={() => videoRef.current?.parentElement?.requestFullscreen?.()}><Icon name="expand" /></button>}
      </div>

      <div className="camera-controls">
        <div className="feed-meta">
          <span><i className={live ? "meta-green" : ""} />{live ? "Camera connected" : "No camera signal"}</span>
          <span className="meta-divider" />
          <span>{live ? (detectionZone ? "Custom detection area" : "Detecting full frame") : "Awaiting video input"}</span>
        </div>
        <div className="feed-actions">
          {live && (
            <>
              <button className={`camera-action ${editingZone ? "camera-action-stop" : ""}`} onClick={() => editingZone ? cancelZoneEditing() : onEditingZoneChange(true)}>
                {editingZone ? "Cancel area" : "Edit detection area"}
              </button>
              {detectionZone && !editingZone && <button className="camera-action" onClick={onDetectionZoneReset}>Use full frame</button>}
            </>
          )}
          {cameras.length > 1 && (
            <select aria-label="Select camera" value={cameraId} onChange={(event) => onCameraChange(event.target.value)}>
              {cameras.map((camera, index) => <option key={camera.deviceId} value={camera.deviceId}>{camera.label || `Camera ${index + 1}`}</option>)}
            </select>
          )}
          <button className={`camera-action ${live ? "camera-action-stop" : ""}`} onClick={live ? onStop : onStart}>
            <span />{live ? "Stop feed" : "Start feed"}
          </button>
        </div>
      </div>
    </section>
  );
}
