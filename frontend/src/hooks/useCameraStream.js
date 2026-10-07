import { useCallback, useEffect, useRef, useState } from "react";

const errorMessages = {
  NotAllowedError: "Camera permission was denied. Allow access in your browser settings and retry.",
  NotFoundError: "No camera was found. Connect a camera and try again.",
  NotReadableError: "The camera is being used by another app.",
  OverconstrainedError: "That camera is no longer available. Choose another camera.",
};

export default function useCameraStream() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const requestId = useRef(0);
  const [status, setStatus] = useState("starting");
  const [error, setError] = useState("");
  const [cameras, setCameras] = useState([]);
  const [cameraId, setCameraId] = useState("");

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const start = useCallback(async (deviceId = "") => {
    const currentRequest = ++requestId.current;
    releaseStream();
    setStatus("starting");
    setError("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId
          ? { deviceId: { exact: deviceId } }
          : { width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      if (currentRequest !== requestId.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (currentRequest !== requestId.current) return;
      setCameras(devices.filter((device) => device.kind === "videoinput"));
      setCameraId(stream.getVideoTracks()[0].getSettings().deviceId ?? "");
      setStatus("live");
    } catch (cameraError) {
      if (currentRequest !== requestId.current) return;
      setError(errorMessages[cameraError.name] ?? `Unable to start camera (${cameraError.name}).`);
      setStatus("error");
    }
  }, [releaseStream]);

  const stop = useCallback(() => {
    requestId.current++;
    releaseStream();
    setStatus("idle");
  }, [releaseStream]);

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera access requires a recent browser on HTTPS or localhost.");
      setStatus("error");
      return undefined;
    }
    start("");
    return () => {
      requestId.current++;
      releaseStream();
    };
  }, [start, releaseStream]);

  return { videoRef, status, error, cameras, cameraId, setCameraId, start, stop };
}
