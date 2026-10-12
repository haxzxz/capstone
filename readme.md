# School Zone Safety Monitor

The React dashboard streams frames from the browser camera to a Python API. The API runs YOLO person detection and returns the annotated frame and live metrics.

## Run locally

Start the backend in one terminal:

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Start the frontend in another terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open the Vite URL (normally `http://localhost:5173`) and allow camera access. Vite forwards `/api` requests to the Python server. The first inference downloads the default `yolov8n.pt` model if it is not already available.

## Configuration

- `YOLO_MODEL`: model file or Ultralytics model name (default `yolov8n.pt`).
- `DETECTION_CONFIDENCE`: minimum person confidence from 0 to 1 (default `0.35`).
- `FRONTEND_ORIGINS`: comma-separated browser origins permitted by the API (default includes localhost:5173).

The dashboard sends JPEG frames up to 960 pixels wide approximately once per second while the camera is live. The Python API exposes `/api/health`, `/api/summary`, and `POST /api/detect`.
