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
}) {
  const live = status === "live";
  const offlineContent = statusLabels[status] ?? statusLabels.idle;

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

      <div className="camera-view">
        <video ref={videoRef} autoPlay playsInline muted className="camera-video" style={{ opacity: live ? 1 : 0 }} />
        {live && frameWidth && frameHeight && (
          <svg
            className="camera-detection-overlay"
            viewBox={`0 0 ${frameWidth} ${frameHeight}`}
            preserveAspectRatio="xMidYMid slice"
            role="img"
            aria-label={`${detections.length} people detected`}
          >
            {detections.map(({ box, confidence }, index) => {
              const [x1, y1, x2, y2] = box;
              return (
                <g key={`${index}-${box.join(",")}`}>
                  <rect x={x1} y={y1} width={x2 - x1} height={y2 - y1} />
                  <text x={x1 + 4} y={Math.max(18, y1 - 6)}>Person {Math.round(confidence)}%</text>
                </g>
              );
            })}
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
          <span>{live ? "Video input active" : "Awaiting video input"}</span>
        </div>
        <div className="feed-actions">
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
