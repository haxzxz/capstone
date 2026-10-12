import base64
import io
import os
import time
from collections import deque
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageDraw
from ultralytics import YOLO


MODEL_PATH = os.getenv("YOLO_MODEL", "yolov8n.pt")
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
        model = YOLO(MODEL_PATH)
    return model


@app.get("/api/health")
def health():
    return {"status": "ok", "model": MODEL_PATH, "model_loaded": model is not None}


@app.get("/api/summary")
def summary():
    return {
        "status": "ready" if model is not None else "standby",
        "model": MODEL_PATH,
        "uptime_seconds": round(time.monotonic() - started_at),
        "people_seen": people_seen,
        "events": list(event_log),
    }


@app.post("/api/detect")
async def detect(request: Request):
    global people_seen, person_was_present
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
        result = get_model().predict(image, conf=CONFIDENCE_THRESHOLD, verbose=False)[0]
    except Exception as error:
        raise HTTPException(status_code=503, detail=f"Detection model failed: {error}") from error

    draw = ImageDraw.Draw(image)
    detections = []
    for box in result.boxes:
        class_id = int(box.cls[0].item())
        label = result.names[class_id]
        if label != "person":
            continue
        confidence = float(box.conf[0].item())
        x1, y1, x2, y2 = [int(value) for value in box.xyxy[0].tolist()]
        detections.append({"label": "Person", "confidence": round(confidence * 100, 1), "box": [x1, y1, x2, y2]})
        draw.rectangle((x1, y1, x2, y2), outline=(32, 205, 151), width=max(2, image.width // 400))
        draw.rectangle((x1, max(0, y1 - 22), x1 + 96, y1), fill=(19, 105, 83))
        draw.text((x1 + 5, max(1, y1 - 19)), f"Person {confidence:.0%}", fill="white")

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
    output = io.BytesIO()
    image.save(output, format="JPEG", quality=82)
    annotated = base64.b64encode(output.getvalue()).decode("ascii")
    return {
        "timestamp": now,
        "model": MODEL_PATH,
        "detections": detections,
        "count": len(detections),
        "average_confidence": round(sum(item["confidence"] for item in detections) / len(detections), 1) if detections else None,
        "total_people_seen": people_seen,
        "inference_fps": round(fps, 1),
        "annotated_frame": f"data:image/jpeg;base64,{annotated}",
        "events": list(event_log)[:10],
    }