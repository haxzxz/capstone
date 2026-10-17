import io
import json
import logging
import math
import os
import time
from collections import deque
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
import torch
from ultralytics import YOLO


MODEL_PATH = os.getenv("YOLO_MODEL", "yolo11m.pt")
DEVICE_SETTING = os.getenv("YOLO_DEVICE", "auto").strip().lower()
IMAGE_SIZE = int(os.getenv("YOLO_IMAGE_SIZE", "416"))
CONFIDENCE_THRESHOLD = float(os.getenv("DETECTION_CONFIDENCE", "0.35"))
MAX_FRAME_BYTES = 8 * 1024 * 1024
logger = logging.getLogger(__name__)

app = FastAPI(title="School Zone Camera Detection API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("FRONTEND_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

model = None
active_device = None
started_at = time.monotonic()
frame_times = deque(maxlen=30)
event_log = deque(maxlen=100)
people_seen = 0
person_was_present = False


def get_model():
    global model, active_device
    if model is None:
        automatic = DEVICE_SETTING == "auto"
        if automatic:
            target_device = "0" if torch.cuda.is_available() else "cpu"
        else:
            target_device = DEVICE_SETTING
            if (target_device.isdigit() or target_device.startswith("cuda")) and not torch.cuda.is_available():
                raise RuntimeError(
                    f"YOLO_DEVICE={DEVICE_SETTING} requests CUDA, but CUDA is unavailable to PyTorch. "
                    "Use YOLO_DEVICE=auto or cpu, or install a compatible CUDA-enabled PyTorch build."
                )

        try:
            loaded_model = _load_and_warm_model(target_device)
        except Exception:
            if not automatic or target_device == "cpu":
                raise
            logger.exception("CUDA model startup failed; falling back to CPU")
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            target_device = "cpu"
            loaded_model = _load_and_warm_model(target_device)

        active_device = target_device
        model = loaded_model
    return model


def _load_and_warm_model(device):
    loaded_model = YOLO(MODEL_PATH)
    loaded_model.to(f"cuda:{device}" if device.isdigit() else device)
    loaded_model.predict(
        Image.new("RGB", (IMAGE_SIZE, IMAGE_SIZE)),
        device=device,
        imgsz=IMAGE_SIZE,
        quantize=16 if is_cuda_device(device) else 32,
        classes=[0],
        verbose=False,
    )
    if is_cuda_device(device):
        torch.cuda.synchronize(cuda_device_index(device))
    return loaded_model


def is_cuda_device(device):
    return device.isdigit() or device.startswith("cuda")


def cuda_device_index(device):
    if device.isdigit():
        return int(device)
    if device == "cuda":
        return 0
    if device.startswith("cuda:") and device.split(":", 1)[1].isdigit():
        return int(device.split(":", 1)[1])
    return 0


def api_device_name(device):
    return f"cuda:{device}" if device and device.isdigit() else device


def parse_detection_zone(value):
    if not value or value == "null":
        return None
    try:
        zone = json.loads(value)
        x, y, width, height = (zone[key] for key in ("x", "y", "width", "height"))
        if not all(isinstance(item, (int, float)) and math.isfinite(item) for item in (x, y, width, height)):
            raise ValueError("Zone coordinates must be finite numbers.")
        if x < 0 or y < 0 or width <= 0 or height <= 0 or x + width > 1 or y + height > 1:
            raise ValueError("Zone must be a non-empty rectangle inside the camera frame.")
        return {"x": x, "y": y, "width": width, "height": height}
    except (json.JSONDecodeError, KeyError, TypeError, ValueError) as error:
        raise HTTPException(status_code=400, detail=f"Invalid detection zone: {error}") from error


def gpu_status():
    available = torch.cuda.is_available()
    index = cuda_device_index(active_device) if active_device and is_cuda_device(active_device) else 0
    return {
        "available": available,
        "device": torch.cuda.get_device_name(index) if available else None,
        "cuda_runtime": torch.version.cuda,
        "selected_device": api_device_name(active_device) if active_device else None,
    }

@app.get("/api/health")
def health():
    gpu = gpu_status()
    return {
        "status": "ready" if model is not None else "standby",
        "model": MODEL_PATH,
        "model_loaded": model is not None,
        "device": api_device_name(active_device) if model is not None else None,
        "gpu": gpu,
    }


@app.get("/api/summary")
def summary():
    return {
        "status": "ready" if model is not None else "standby",
        "model": MODEL_PATH,
        "device": api_device_name(active_device),
        "gpu": gpu_status(),
        "uptime_seconds": round(time.monotonic() - started_at),
        "people_seen": people_seen,
        "events": list(event_log),
    }


@app.post("/api/detect")
async def detect(request: Request):
    global people_seen, person_was_present
    request_started_at = time.perf_counter()
    image_bytes = await request.body()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="No camera frame was provided.")
    if len(image_bytes) > MAX_FRAME_BYTES:
        raise HTTPException(status_code=413, detail="Camera frame is too large.")
    try:
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception as error:
        raise HTTPException(status_code=400, detail="Frame must be a valid JPEG or PNG image.") from error
    detection_zone = parse_detection_zone(request.headers.get("x-detection-zone"))

    try:
        loaded_model = get_model()
        if is_cuda_device(active_device):
            torch.cuda.synchronize(cuda_device_index(active_device))
        inference_started_at = time.perf_counter()
        result = loaded_model.predict(
            image,
            conf=CONFIDENCE_THRESHOLD,
            device=active_device,
            imgsz=IMAGE_SIZE,
            quantize=16 if is_cuda_device(active_device) else 32,
            classes=[0],
            verbose=False,
        )[0]
        if is_cuda_device(active_device):
            torch.cuda.synchronize(cuda_device_index(active_device))
        inference_ms = (time.perf_counter() - inference_started_at) * 1000
    except Exception as error:
        logger.exception("YOLO detection failed (model=%s, device=%s)", MODEL_PATH, active_device or DEVICE_SETTING)
        raise HTTPException(status_code=503, detail=f"Detection model failed: {error}") from error

    detections = []
    for box in result.boxes:
        class_id = int(box.cls[0].item())
        label = result.names[class_id]
        if label != "person":
            continue
        confidence = float(box.conf[0].item())
        x1, y1, x2, y2 = [int(value) for value in box.xyxy[0].tolist()]
        if detection_zone:
            center_x = ((x1 + x2) / 2) / image.width
            center_y = ((y1 + y2) / 2) / image.height
            if not (
                detection_zone["x"] <= center_x <= detection_zone["x"] + detection_zone["width"]
                and detection_zone["y"] <= center_y <= detection_zone["y"] + detection_zone["height"]
            ):
                continue
        detections.append({"label": "Person", "confidence": round(confidence * 100, 1), "box": [x1, y1, x2, y2]})

    now = datetime.now(timezone.utc).isoformat()
    people_seen += len(detections)
    if detections and not person_was_present:
        event_log.appendleft({"id": now, "label": f"{len(detections)} pedestrian" + ("s" if len(detections) != 1 else ""),
                              "time": datetime.now().astimezone().strftime("%H:%M:%S"),
                              "confidence": round(sum(item["confidence"] for item in detections) / len(detections)),
                              "zoneResult": "Person detected"})
    person_was_present = bool(detections)

    frame_times.append(time.monotonic())
    fps = 0
    if len(frame_times) > 1 and frame_times[-1] > frame_times[0]:
        fps = (len(frame_times) - 1) / (frame_times[-1] - frame_times[0])
    request_ms = (time.perf_counter() - request_started_at) * 1000
    return {
        "timestamp": now,
        "model": MODEL_PATH,
        "device": api_device_name(active_device),
        "detections": detections,
        "count": len(detections),
        "average_confidence": round(sum(item["confidence"] for item in detections) / len(detections), 1) if detections else None,
        "total_people_seen": people_seen,
        "inference_fps": round(fps, 1),
        "inference_ms": round(inference_ms, 1),
        "request_ms": round(request_ms, 1),
        "frame_width": image.width,
        "frame_height": image.height,
        "detection_zone": detection_zone,
        "events": list(event_log)[:10],
    }
