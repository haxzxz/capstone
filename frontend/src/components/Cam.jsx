import { useEffect, useRef, useState } from "react";
import useCameraStream from "../hooks/useCameraStream.js";
import AIRecognitionPanel from "./AIRecognitionPanel.jsx";
import CameraFeed from "./CameraFeed.jsx";
import ClockBadge from "./ClockBadge.jsx";
import HardwareAlertNote from "./HardwareAlertNote.jsx";
import Header from "./Header.jsx";
import Icon from "./Icon.jsx";
import RecentDetectionsPanel from "./RecentDetectionsPanel.jsx";
import StatsGrid from "./StatsGrid.jsx";

const DETECTION_ZONE_STORAGE_KEY = "school-zone-detection-area";
const ALERT_SOUND_STORAGE_KEY = "school-zone-alert-sound-enabled";
const ALERT_SCHEDULE_STORAGE_KEY = "school-zone-daily-alert-time";
const ALERT_MODE_STORAGE_KEY = "school-zone-alert-manual-mode";
const LAST_SCHEDULED_ALERT_STORAGE_KEY = "school-zone-last-successful-alert";
const THEME_STORAGE_KEY = "school-zone-theme";

// The browser owns user preferences and media playback; the API owns detection state and dwell timing.
function loadDetectionZone() {
  try {
    const zone = JSON.parse(window.localStorage.getItem(DETECTION_ZONE_STORAGE_KEY));
    if (!zone || ![zone.x, zone.y, zone.width, zone.height].every(Number.isFinite)) return null;
    if (zone.x < 0 || zone.y < 0 || zone.width <= 0 || zone.height <= 0 || zone.x + zone.width > 1 || zone.y + zone.height > 1) return null;
    return zone;
  } catch {
    return null;
  }
}

export default function Cam() {
  const camera = useCameraStream();
  const [clock, setClock] = useState(() => new Date());
  const canvasRef = useRef(null);
  const standbyTimerRef = useRef(null);
  const standbyAudioRef = useRef(null);
  const standbyPlayingRef = useRef(false);
  const standbyGenerationRef = useRef(0);
  const standbyWantedRef = useRef(false);
  const alertAudioRef = useRef(null);
  const alertPlayingRef = useRef(false);
  const alertPlaybackGenerationRef = useRef(0);
  const previousManualModeRef = useRef(false);
  const standbyDelayRef = useRef(1);
  const [serviceState, setServiceState] = useState("checking");
  const [serviceMessage, setServiceMessage] = useState("Checking Python detection service…");
  const [result, setResult] = useState(null);
  const [events, setEvents] = useState([]);
  const [cameraFps, setCameraFps] = useState(0);
  const [detectionZone, setDetectionZone] = useState(loadDetectionZone);
  const [editingZone, setEditingZone] = useState(false);
  const [alertSchedule, setAlertSchedule] = useState(() => {
    try { return window.localStorage.getItem(ALERT_SCHEDULE_STORAGE_KEY) || ""; }
    catch { return ""; }
  });
  const [scheduleAlertStatus, setScheduleAlertStatus] = useState("");
  const [manualMode, setManualMode] = useState(() => {
    try { return window.localStorage.getItem(ALERT_MODE_STORAGE_KEY) === "true"; }
    catch { return false; }
  });
  const [manualAlertActive, setManualAlertActive] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try { return window.localStorage.getItem(ALERT_SOUND_STORAGE_KEY) !== "false"; }
    catch { return true; }
  });
  const [darkMode, setDarkMode] = useState(() => {
    try { return window.localStorage.getItem(THEME_STORAGE_KEY) === "dark"; }
    catch { return false; }
  });

  useEffect(() => {
    try { window.localStorage.setItem(THEME_STORAGE_KEY, darkMode ? "dark" : "light"); }
    catch { /* Theme preference still applies for this session. */ }
  }, [darkMode]);

  const stopStandbySound = () => {
    // Invalidating the generation prevents a late ended/error callback from restarting a stopped loop.
    standbyGenerationRef.current += 1;
    window.clearTimeout(standbyTimerRef.current);
    standbyTimerRef.current = null;
    standbyPlayingRef.current = false;
    if (standbyAudioRef.current) {
      standbyAudioRef.current.onended = null;
      standbyAudioRef.current.onerror = null;
      standbyAudioRef.current.pause();
      standbyAudioRef.current.currentTime = 0;
    }
  };

  const startStandbySound = (delaySeconds) => {
    if (!soundEnabled || alertPlayingRef.current) return;
    if (standbyTimerRef.current !== null || standbyPlayingRef.current) return;
    const audio = standbyAudioRef.current || new Audio("/api/audio/beep1.mp3");
    standbyAudioRef.current = audio;
    const generation = ++standbyGenerationRef.current;
    const scheduleNext = () => {
      if (generation !== standbyGenerationRef.current) return;
      standbyPlayingRef.current = false;
      if (!standbyWantedRef.current || alertPlayingRef.current || !soundEnabled) return;
      if (standbyTimerRef.current !== null) return;
      standbyTimerRef.current = window.setTimeout(() => {
        standbyTimerRef.current = null;
        play();
      }, Math.max(0.1, delaySeconds) * 1000);
    };
    const play = () => {
      if (generation !== standbyGenerationRef.current) return;
      if (alertPlayingRef.current || !soundEnabled) return;
      standbyPlayingRef.current = true;
      audio.currentTime = 0;
      audio.onended = scheduleNext;
      audio.onerror = scheduleNext;
      audio.play().catch(scheduleNext);
    };
    play();
  };

  const playAlertSound = async (repeatUntilStopped = false) => {
    if (alertPlayingRef.current) return false;
    if (!soundEnabled) {
      await fetch("/api/alert-finished", { method: "POST" }).catch(() => {});
      return false;
    }
    stopStandbySound();
    const audio = alertAudioRef.current || new Audio("/api/audio/beep3.mp3");
    alertAudioRef.current = audio;
    const generation = ++alertPlaybackGenerationRef.current;
    audio.currentTime = 0;
    alertPlayingRef.current = true;
    setManualAlertActive(true);
    let playbackSucceeded = false;
    try {
      do {
        await new Promise((resolve, reject) => {
          audio.onended = resolve;
          audio.onerror = () => reject(new Error("Alert audio could not be played."));
          audio.play().then(() => { playbackSucceeded = true; }).catch(reject);
        });
        if (repeatUntilStopped && manualMode && alertPlayingRef.current) audio.currentTime = 0;
      } while (repeatUntilStopped && manualMode && alertPlayingRef.current);
    } catch {
      // A blocked or unavailable alert sound should not prevent standby mode.
    } finally {
      // Only the current playback may unlock the backend or restart standby audio.
      if (generation === alertPlaybackGenerationRef.current) {
        await fetch("/api/alert-finished", { method: "POST" }).catch(() => {});
        alertPlayingRef.current = false;
        setManualAlertActive(false);
        if (standbyWantedRef.current && soundEnabled) startStandbySound(standbyDelayRef.current);
      }
    }
    return playbackSucceeded;
  };

  const stopAlertSound = () => {
    const wasPlaying = alertPlayingRef.current;
    alertPlaybackGenerationRef.current += 1;
    alertPlayingRef.current = false;
    setManualAlertActive(false);
    if (alertAudioRef.current) {
      alertAudioRef.current.pause();
      alertAudioRef.current.currentTime = 0;
    }
    if (wasPlaying) fetch("/api/alert-finished", { method: "POST" }).catch(() => {});
  };

  useEffect(() => {
    try { window.localStorage.setItem(ALERT_SOUND_STORAGE_KEY, String(soundEnabled)); }
    catch { /* Sound preference still applies for this session. */ }
    if (!soundEnabled) {
      stopStandbySound();
      stopAlertSound();
    }
  }, [soundEnabled]);

  useEffect(() => {
    try {
      if (alertSchedule) window.localStorage.setItem(ALERT_SCHEDULE_STORAGE_KEY, alertSchedule);
      else window.localStorage.removeItem(ALERT_SCHEDULE_STORAGE_KEY);
      window.localStorage.setItem(ALERT_MODE_STORAGE_KEY, String(manualMode));
    } catch { /* Alert preferences still apply for this session. */ }
  }, [alertSchedule, manualMode]);

  useEffect(() => {
    const modeChanged = previousManualModeRef.current !== manualMode;
    previousManualModeRef.current = manualMode;
    if (manualMode) {
      standbyWantedRef.current = false;
      stopStandbySound();
    }
    if (modeChanged && alertPlayingRef.current) {
      stopAlertSound();
    }
    return undefined;
  }, [manualMode]);

  useEffect(() => {
    if (!alertSchedule) return undefined;
    let firedToday = false;
    let lastAttemptAt = 0;
    const [hour, minute] = alertSchedule.split(":").map(Number);
    let targetDate = new Date();
    targetDate.setHours(hour, minute, 0, 0);
    if (targetDate.getTime() < Date.now() - 2 * 60 * 1000) targetDate.setDate(targetDate.getDate() + 1);
    // Polling also recovers if the tab was briefly throttled around the target time.
    const checkScheduledAlert = () => {
      const now = new Date();
      if (now.toDateString() !== targetDate.toDateString()) {
        if (now > targetDate) {
          targetDate = new Date(now);
          targetDate.setHours(hour, minute, 0, 0);
          if (targetDate <= now) targetDate.setDate(targetDate.getDate() + 1);
        }
        return;
      }
      if (now < targetDate) return;
      const today = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, "0")}-${String(targetDate.getDate()).padStart(2, "0")}`;
      if (firedToday || now.getTime() - lastAttemptAt < 15000) return;
      try {
        if (window.localStorage.getItem(LAST_SCHEDULED_ALERT_STORAGE_KEY) === today) return;
      } catch { /* Keep an in-memory guard when browser storage is unavailable. */ }
      lastAttemptAt = now.getTime();
      void playAlertSound().then((played) => {
        if (played) {
          firedToday = true;
          try { window.localStorage.setItem(LAST_SCHEDULED_ALERT_STORAGE_KEY, today); }
          catch { /* The in-memory guard still prevents repeats this session. */ }
          setScheduleAlertStatus(`Scheduled alert played at ${alertSchedule}.`);
        } else {
          setScheduleAlertStatus("Scheduled time reached, but the alert sound did not play. Check that sound is on.");
        }
      });
    };
    const timer = window.setInterval(checkScheduledAlert, 1000);
    checkScheduledAlert();
    return () => window.clearInterval(timer);
  }, [alertSchedule, soundEnabled]);

  useEffect(() => {
    try {
      if (detectionZone) window.localStorage.setItem(DETECTION_ZONE_STORAGE_KEY, JSON.stringify(detectionZone));
      else window.localStorage.removeItem(DETECTION_ZONE_STORAGE_KEY);
    } catch {
      // The zone still works for this session when browser storage is unavailable.
    }
  }, [detectionZone]);

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
    fetch("/api/summary")
      .then((response) => {
        if (!response.ok) throw new Error("Detection service is unavailable");
        return response.json();
      })
      .then((data) => {
        if (active) setEvents(data.events || []);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    // A single in-flight request bounds memory and ensures displayed boxes belong to a recent frame.
    let busy = false;
    let timer;
    const processFrame = async () => {
      const video = camera.videoRef.current;
      // Do not queue stale frames: inference runs as fast as the previous request allows.
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
        const response = await fetch("/api/detect", {
          method: "POST",
          headers: {
            "Content-Type": "image/jpeg",
            "X-Detection-Zone": JSON.stringify(detectionZone),
          },
          body: frame,
        });
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
        const settings = data.alert_settings || {};
        standbyDelayRef.current = settings.standby_beep_delay_seconds || 1;
        standbyWantedRef.current = !manualMode && (data.alert_pending || data.count === 0);
        if (manualMode) {
          stopStandbySound();
          if (data.alert_trigger) fetch("/api/alert-finished", { method: "POST" }).catch(() => {});
        } else if (data.alert_trigger) {
          void playAlertSound();
        } else if (standbyWantedRef.current) {
          startStandbySound(settings.standby_beep_delay_seconds || 3);
        } else {
          stopStandbySound();
        }
      } catch (error) {
        if (active) {
          setServiceState("error");
          setServiceMessage(error.message || "Unable to reach the Python detection service.");
        }
      } finally { busy = false; }
    };
    if (camera.status === "live") {
      processFrame();
      timer = window.setInterval(processFrame, 5);
    }
    return () => {
      active = false;
      window.clearInterval(timer);
      stopStandbySound();
    };
  }, [camera.status, camera.videoRef, detectionZone, soundEnabled, manualMode]);

  return (
    <main className={`monitor-app${darkMode ? " theme-dark" : ""}`}>
      <Header aria-label="Customizable header area" />
      <div className="monitor-content">
        <div className="page-intro">
          <div>
            <div className="eyebrow"><span className="eyebrow-line" />SCHOOL ZONE SAFETY SYSTEM</div>
            <h1>Live monitoring</h1>
            <p>Real-time pedestrian safety monitoring and AI event overview.</p>
          </div>
          <div className="intro-status">
            <button
              type="button"
              className="theme-toggle"
              aria-label={`Switch to ${darkMode ? "light" : "dark"} mode`}
              aria-pressed={darkMode}
              title={`Switch to ${darkMode ? "light" : "dark"} mode`}
              onClick={() => setDarkMode((enabled) => !enabled)}
            >
              <Icon name={darkMode ? "sun" : "moon"} size={15} />
              <span>{darkMode ? "Light mode" : "Dark mode"}</span>
            </button>
            <button
              type="button"
              className={`sound-toggle ${soundEnabled ? "is-enabled" : ""}`}
              aria-label={`Alert sound ${soundEnabled ? "on" : "off"}`}
              aria-pressed={soundEnabled}
              title={`Turn alert sound ${soundEnabled ? "off" : "on"}`}
              onClick={() => setSoundEnabled((enabled) => !enabled)}
            >
              <Icon name={soundEnabled ? "volume" : "muted"} size={15} />
              <span>Sound {soundEnabled ? "on" : "off"}</span>
            </button>
            <ClockBadge date={clock} />
          </div>
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
              onStart={() => {
                standbyWantedRef.current = true;
                startStandbySound(standbyDelayRef.current);
                camera.start(camera.cameraId);
              }}
              onStop={() => { standbyWantedRef.current = false; stopStandbySound(); stopAlertSound(); camera.stop(); }}
              clock={clock}
              detections={result?.detections ?? []}
              frameWidth={result?.frame_width}
              frameHeight={result?.frame_height}
              cameraFps={cameraFps}
              detectionZone={detectionZone}
              editingZone={editingZone}
              onEditingZoneChange={setEditingZone}
              onDetectionZoneChange={setDetectionZone}
              onDetectionZoneReset={() => {
                setDetectionZone(null);
                setEditingZone(false);
              }}
            />
            <StatsGrid stats={[
              { label: "Pedestrians detected", value: result?.count ?? "—", note: result ? "Currently in camera view" : "Awaiting AI inference", icon: "scan", tone: "tone-blue" },
              { label: "Alerts triggered", value: events.length, note: "Recent detection events", icon: "alert", tone: "tone-amber" },
              { label: "Detection confidence", value: result?.average_confidence != null ? `${result.average_confidence}%` : "—", note: "Current frame average", icon: "pulse", tone: "tone-green" },
            ]} />
          </div>

          <aside className="insights-column" aria-label="AI recognition status">
            <AIRecognitionPanel
              modelName={result?.model || "YOLO11m"}
              modelDescription={result?.device ? `Python person detection model · ${result.device} inference` : "Python person detection model · automatic device selection"}
              status={serviceState === "live" ? "LIVE" : serviceState === "error" ? "OFFLINE" : "CONNECTING"}
              statusMessage={serviceState === "live" ? "Detection feed active" : serviceState === "error" ? "Detection service unavailable" : "Connecting to Python service"}
              statusDetail={serviceMessage}
              detectionZone={result?.count ? "Person detected" : result ? "Clear" : "Waiting for feed"}
              schoolSchedule={alertSchedule}
              onSchoolScheduleChange={(time) => { setAlertSchedule(time); setScheduleAlertStatus(""); }}
              scheduleAlertStatus={scheduleAlertStatus}
              manualMode={manualMode}
              onManualModeChange={setManualMode}
              onManualAlertStart={() => { standbyWantedRef.current = false; stopStandbySound(); void playAlertSound(true); }}
              onManualAlertStop={stopAlertSound}
              manualAlertActive={manualAlertActive}
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
