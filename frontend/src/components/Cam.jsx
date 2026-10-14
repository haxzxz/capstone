import { useEffect, useRef, useState } from "react";
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
  const canvasRef = useRef(null);
  const [serviceState, setServiceState] = useState("checking");
  const [serviceMessage, setServiceMessage] = useState("Checking Python detection service…");
  const [result, setResult] = useState(null);
  const [events, setEvents] = useState([]);
  const [cameraFps, setCameraFps] = useState(0);

  useEffect(() => {
    const video = camera.videoRef.current;
    if (camera.status !== "live" || !video) {
      setCameraFps(0);
      return undefined;
    }

    let callbackId;
    let sampleTimer;
    let frameCount = 0;
    let sampleStartedAt = performance.now();
    let previousTotalFrames = video.getVideoPlaybackQuality?.().totalVideoFrames ?? 0;

    if (video.requestVideoFrameCallback) {
      const countFrame = (now) => {
        frameCount += 1;
        const elapsed = now - sampleStartedAt;
        if (elapsed >= 1000) {
          setCameraFps(Math.round((frameCount * 1000) / elapsed));
          frameCount = 0;
          sampleStartedAt = now;
        }
        callbackId = video.requestVideoFrameCallback(countFrame);
      };
      callbackId = video.requestVideoFrameCallback(countFrame);
    } else {
      sampleTimer = window.setInterval(() => {
        const totalFrames = video.getVideoPlaybackQuality?.().totalVideoFrames;
        const now = performance.now();
        const elapsed = now - sampleStartedAt;
        if (totalFrames != null && elapsed > 0) {
          setCameraFps(Math.round(((totalFrames - previousTotalFrames) * 1000) / elapsed));
          previousTotalFrames = totalFrames;
          sampleStartedAt = now;
        }
      }, 1000);
    }

    return () => {
      if (callbackId != null) video.cancelVideoFrameCallback?.(callbackId);
      window.clearInterval(sampleTimer);
    };
  }, [camera.status, camera.videoRef]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    let busy = false;
    let timer;
    const processFrame = async () => {
      const video = camera.videoRef.current;
      if (!active || busy || camera.status !== "live" || !video || video.readyState < 2) return;
      busy = true;
      try {
        const canvas = canvasRef.current;
        const scale = Math.min(1, 640 / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
        const frame = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.78));
        if (!frame) return;
        const requestStartedAt = performance.now();
        const response = await fetch("/api/detect", { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: frame });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.detail || `Detection service returned ${response.status}`);
        }
        const data = await response.json();
        data.round_trip_ms = performance.now() - requestStartedAt;
        if (!active) return;
        setResult(data);
        setEvents(data.events || []);
        setServiceState("live");
        setServiceMessage("Python is processing the live camera feed.");
      } catch (error) {
        if (active) {
          setServiceState("error");
          setServiceMessage(error.message || "Unable to reach the Python detection service.");
        }
      } finally { busy = false; }
    };
    if (camera.status === "live") {
      processFrame();
      timer = window.setInterval(processFrame, 250);
    }
    return () => { active = false; window.clearInterval(timer); };
  }, [camera.status, camera.videoRef]);

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
              detections={result?.detections ?? []}
              frameWidth={result?.frame_width}
              frameHeight={result?.frame_height}
              cameraFps={cameraFps}
            />
            <StatsGrid stats={[
              { label: "Pedestrians detected", value: result?.total_people_seen ?? "—", note: result ? `${result.count} in current frame` : "Awaiting AI inference", icon: "scan", tone: "tone-blue" },
              { label: "Alerts triggered", value: events.length, note: "Recent detection events", icon: "alert", tone: "tone-amber" },
              { label: "Detection confidence", value: result?.average_confidence != null ? `${result.average_confidence}%` : "—", note: "Current frame average", icon: "pulse", tone: "tone-green" },
            ]} />
          </div>

          <aside className="insights-column" aria-label="AI recognition status">
            <AIRecognitionPanel
              modelName={result?.model || "YOLO11n"}
              modelDescription="Python person detection model · GPU inference"
              status={serviceState === "live" ? "LIVE" : serviceState === "error" ? "OFFLINE" : "CONNECTING"}
              statusMessage={serviceState === "live" ? "Detection feed active" : serviceState === "error" ? "Detection service unavailable" : "Connecting to Python service"}
              statusDetail={serviceMessage}
              detectionZone={result?.count ? "Person detected" : result ? "Clear" : "Waiting for feed"}
              schoolSchedule="Not configured"
              inferenceRate={result?.inference_fps ?? "—"}
              inferenceMs={result?.inference_ms}
              requestMs={result?.request_ms}
              roundTripMs={result?.round_trip_ms}
              zoneIntersections={result?.count ?? "—"}
            />
            <RecentDetectionsPanel events={events} unavailable={serviceState !== "live"} />
            <HardwareAlertNote />
          </aside>
        </section>
      </div>
      <canvas ref={canvasRef} hidden />
    </main>
  );
}
