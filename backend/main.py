import io
import os
import time
from collections import deque
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
import torch
from ultralytics import YOLO


MODEL_PATH = os.getenv("YOLO_MODEL", "yolo11n.pt")
DEVICE = os.getenv("YOLO_DEVICE", "0")
IMAGE_SIZE = int(os.getenv("YOLO_IMAGE_SIZE", "416"))
CONFIDENCE_THRESHOLD = float(os.getenv("DETECTION_CONFIDENCE", "0.35"))
MAX_FRAME_BYTES = 8 * 1024 * 1024

app = FastAPI(title="School Zone Camera Detection API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("FRONTEND_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

model = None
started_at = time.monotonic()
frame_times = deque(maxlen=30)
event_log = deque(maxlen=100)
people_seen = 0
person_was_present = False


def get_model():
    global model
    if model is None:
        if not torch.cuda.is_available():
            raise RuntimeError(
                "CUDA is unavailable to PyTorch. Install a CUDA-enabled PyTorch build "
                "and verify that the NVIDIA driver is available."
            )
        loaded_model = YOLO(MODEL_PATH)
        loaded_model.to(f"cuda:{DEVICE}" if DEVICE.isdigit() else DEVICE)
        loaded_model.predict(
            Image.new("RGB", (IMAGE_SIZE, IMAGE_SIZE)),
            device=DEVICE,
            imgsz=IMAGE_SIZE,
            quantize=16,
            classes=[0],
            verbose=False,
        )
        torch.cuda.synchronize()
        model = loaded_model
    return model


def gpu_status():
    available = torch.cuda.is_available()
    return {
        "available": available,
        "device": torch.cuda.get_device_name(int(DEVICE)) if available and DEVICE.isdigit() else None,
        "cuda_runtime": torch.version.cuda,
    }

@app.get("/api/health")
def health():
    gpu = gpu_status()
    return {
        "status": "ok" if gpu["available"] else "gpu_unavailable",
        "model": MODEL_PATH,
        "model_loaded": model is not None,
        "device": f"cuda:{DEVICE}" if gpu["available"] else None,
        "gpu": gpu,
    }


@app.get("/api/summary")
def summary():
    return {
        "status": "ready" if model is not None else "standby",
        "model": MODEL_PATH,
        "device": f"cuda:{DEVICE}" if model is not None else None,
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

    try:
        loaded_model = get_model()
        torch.cuda.synchronize()
        inference_started_at = time.perf_counter()
        result = loaded_model.predict(
            image,
            conf=CONFIDENCE_THRESHOLD,
            device=DEVICE,
            imgsz=IMAGE_SIZE,
            quantize=16,
            classes=[0],
            verbose=False,
        )[0]
        torch.cuda.synchronize()
        inference_ms = (time.perf_counter() - inference_started_at) * 1000
    except Exception as error:
        raise HTTPException(status_code=503, detail=f"Detection model failed: {error}") from error

    detections = []
    for box in result.boxes:
        class_id = int(box.cls[0].item())
        label = result.names[class_id]
        if label != "person":
            continue
        confidence = float(box.conf[0].item())
        x1, y1, x2, y2 = [int(value) for value in box.xyxy[0].tolist()]
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
        "device": f"cuda:{DEVICE}",
        "detections": detections,
        "count": len(detections),
        "average_confidence": round(sum(item["confidence"] for item in detections) / len(detections), 1) if detections else None,
        "total_people_seen": people_seen,
        "inference_fps": round(fps, 1),
        "inference_ms": round(inference_ms, 1),
        "request_ms": round(request_ms, 1),
        "frame_width": image.width,
        "frame_height": image.height,
        "events": list(event_log)[:10],
    }
