import { useEffect, useState } from "react";
import useCameraStream from "../hooks/useCameraStream.js";
import AIRecognitionPanel from "./AIRecognitionPanel.jsx";
import CameraFeed from "./CameraFeed.jsx";
import ClockBadge from "./ClockBadge.jsx";
import HardwareAlertNote from "./HardwareAlertNote.jsx";
import Header from "./Header.jsx";
import RecentDetectionsPanel from "./RecentDetectionsPanel.jsx";
import StatsGrid from "./StatsGrid.jsx";

export default function Cam() {
  const camera = useCameraStream();
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <main className="monitor-app">
      <Header aria-label="Customizable header area" />
      <div className="monitor-content">
        <div className="page-intro">
          <div>
            <div className="eyebrow"><span className="eyebrow-line" />SCHOOL ZONE SAFETY SYSTEM</div>
            <h1>Live monitoring</h1>
            <p>Real-time pedestrian safety monitoring and AI event overview.</p>
          </div>
          <ClockBadge date={clock} />
        </div>

        <section className="overview-grid" aria-label="Live camera and AI monitoring dashboard">
          <div className="camera-column">
            <CameraFeed
              videoRef={camera.videoRef}
              status={camera.status}
              error={camera.error}
              cameras={camera.cameras}
              cameraId={camera.cameraId}
              onCameraChange={(deviceId) => {
                camera.setCameraId(deviceId);
                camera.start(deviceId);
              }}
              onStart={() => camera.start(camera.cameraId)}
              onStop={camera.stop}
              clock={clock}
            />
            <StatsGrid />
          </div>

          <aside className="insights-column" aria-label="AI recognition status">
            <AIRecognitionPanel />
            <RecentDetectionsPanel />
            <HardwareAlertNote />
          </aside>
        </section>
      </div>
    </main>
  );
}
