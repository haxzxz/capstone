import io
import json
import logging
import math
import os
import sqlite3
import time
from collections import deque
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from csv import writer
from io import StringIO

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from cryptography.fernet import Fernet
from PIL import Image
import torch
from ultralytics import YOLO


MODEL_PATH = os.getenv("YOLO_MODEL", "yolo11m.pt")
DEVICE_SETTING = os.getenv("YOLO_DEVICE", "auto").strip().lower()
IMAGE_SIZE = int(os.getenv("YOLO_IMAGE_SIZE", "416"))
CONFIDENCE_THRESHOLD = float(os.getenv("DETECTION_CONFIDENCE", "0.35"))
TELEMETRY_ENCRYPTION_KEY = os.getenv("TELEMETRY_ENCRYPTION_KEY", "").strip()
MAX_FRAME_BYTES = 8 * 1024 * 1024
DATABASE_PATH = Path(os.getenv("DATABASE_PATH", Path(__file__).with_name("school_zone.db")))
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
person_was_present = False


def connect_database():
    connection = sqlite3.connect(DATABASE_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_database():
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with closing(connect_database()) as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS detection_events (
                id TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                time TEXT NOT NULL,
                confidence INTEGER NOT NULL,
                zone_result TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS dashboard_stats (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                people_seen INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS telemetry_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp_utc TEXT NOT NULL,
                inference_fps REAL NOT NULL,
                mean_detection_confidence REAL,
                zone_configured INTEGER NOT NULL,
                crosswalk_intrusion INTEGER,
                intrusion_timestamp_utc TEXT,
                detection_count INTEGER NOT NULL,
                inference_latency_ms REAL NOT NULL,
                end_to_end_alert_latency_seconds REAL,
                gpio_output_activation_latency_ms REAL
            );
            INSERT OR IGNORE INTO dashboard_stats (id, people_seen) VALUES (1, 0);
            """
        )
        connection.commit()


def get_recent_events(limit=100):
    with closing(connect_database()) as connection:
        rows = connection.execute(
            "SELECT id, label, time, confidence, zone_result FROM detection_events ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [
        {"id": row["id"], "label": row["label"], "time": row["time"],
         "confidence": row["confidence"], "zoneResult": row["zone_result"]}
        for row in rows
    ]


def get_people_seen():
    with closing(connect_database()) as connection:
        row = connection.execute("SELECT people_seen FROM dashboard_stats WHERE id = 1").fetchone()
    return row["people_seen"]


def save_telemetry(timestamp, fps, detections, detection_zone, inference_ms):
    intrusion = bool(detections) if detection_zone else None
    mean_confidence = (
        sum(item["confidence"] for item in detections) / len(detections) if detections else None
    )
    with closing(connect_database()) as connection:
        connection.execute(
            """
            INSERT INTO telemetry_records (
                timestamp_utc, inference_fps, mean_detection_confidence, zone_configured,
                crosswalk_intrusion, intrusion_timestamp_utc, detection_count,
                inference_latency_ms, end_to_end_alert_latency_seconds,
                gpio_output_activation_latency_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
            """,
            (
                timestamp,
                fps,
                mean_confidence,
                int(detection_zone is not None),
                int(intrusion) if intrusion is not None else None,
                timestamp if intrusion else None,
                len(detections),
                inference_ms,
            ),
        )
        connection.commit()


initialize_database()


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
        "people_seen": get_people_seen(),
        "events": get_recent_events(),
    }


@app.get("/api/events/export")
def export_events():
    output = StringIO(newline="")
    csv_writer = writer(output)
    csv_writer.writerow(("Timestamp", "Event", "Confidence (%)", "Zone result"))
    with closing(connect_database()) as connection:
        rows = connection.execute(
            "SELECT id, label, confidence, zone_result FROM detection_events ORDER BY id ASC"
        ).fetchall()
    for row in rows:
        csv_writer.writerow((row["id"], row["label"], row["confidence"], row["zone_result"]))
    return Response(
        content="\ufeff" + output.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="school-zone-events.csv"'},
    )


@app.get("/api/telemetry/export")
def export_telemetry():
    output = StringIO(newline="")
    csv_writer = writer(output)
    csv_writer.writerow((
        "Timestamp UTC", "Inference FPS", "Mean detection confidence (%)",
        "Crosswalk zone configured", "Crosswalk intrusion", "Intrusion timestamp UTC",
        "Detection count", "Inference latency (ms)",
        "End-to-end alert activation latency (s)", "GPIO output activation latency (ms)",
    ))
    with closing(connect_database()) as connection:
        rows = connection.execute("SELECT * FROM telemetry_records ORDER BY id ASC").fetchall()
    for row in rows:
        csv_writer.writerow((
            row["timestamp_utc"], row["inference_fps"], row["mean_detection_confidence"],
            row["zone_configured"], row["crosswalk_intrusion"], row["intrusion_timestamp_utc"],
            row["detection_count"], row["inference_latency_ms"],
            row["end_to_end_alert_latency_seconds"], row["gpio_output_activation_latency_ms"],
        ))
    if not TELEMETRY_ENCRYPTION_KEY:
        raise HTTPException(status_code=503, detail="Set TELEMETRY_ENCRYPTION_KEY to export encrypted telemetry.")
    try:
        encrypted_csv = Fernet(TELEMETRY_ENCRYPTION_KEY.encode("ascii")).encrypt(
            ("\ufeff" + output.getvalue()).encode("utf-8")
        )
    except (ValueError, UnicodeEncodeError) as error:
        raise HTTPException(status_code=503, detail="TELEMETRY_ENCRYPTION_KEY must be a valid Fernet key.") from error
    return Response(
        content=encrypted_csv,
        media_type="application/octet-stream",
        headers={"Content-Disposition": 'attachment; filename="school-zone-telemetry.csv.enc"'},
    )


@app.post("/api/detect")
async def detect(request: Request):
    global person_was_present
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
    event = None
    if detections and not person_was_present:
        event = {
            "id": now,
            "label": f"{len(detections)} pedestrian" + ("s" if len(detections) != 1 else ""),
            "time": datetime.now().astimezone().strftime("%H:%M:%S"),
            "confidence": round(sum(item["confidence"] for item in detections) / len(detections)),
            "zoneResult": "Person detected",
        }
    person_was_present = bool(detections)

    with closing(connect_database()) as connection:
        connection.execute("UPDATE dashboard_stats SET people_seen = people_seen + ? WHERE id = 1", (len(detections),))
        if event:
            connection.execute(
                "INSERT INTO detection_events (id, label, time, confidence, zone_result) VALUES (?, ?, ?, ?, ?)",
                (event["id"], event["label"], event["time"], event["confidence"], event["zoneResult"]),
            )
        connection.commit()
    frame_times.append(time.monotonic())
    fps = 0
    if len(frame_times) > 1 and frame_times[-1] > frame_times[0]:
        fps = (len(frame_times) - 1) / (frame_times[-1] - frame_times[0])
    save_telemetry(now, fps, detections, detection_zone, inference_ms)
    request_ms = (time.perf_counter() - request_started_at) * 1000
    return {
        "timestamp": now,
        "model": MODEL_PATH,
        "device": api_device_name(active_device),
        "detections": detections,
        "count": len(detections),
        "average_confidence": round(sum(item["confidence"] for item in detections) / len(detections), 1) if detections else None,
        "total_people_seen": get_people_seen(),
        "inference_fps": round(fps, 1),
        "inference_ms": round(inference_ms, 1),
        "request_ms": round(request_ms, 1),
        "frame_width": image.width,
        "frame_height": image.height,
        "detection_zone": detection_zone,
        "events": get_recent_events(10),
    }
