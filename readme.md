# School Zone Safety Monitor

The React dashboard keeps the browser camera preview local and sends sampled frames to a Python API for YOLO person detection. The API returns detection boxes and live metrics; React draws the boxes over the live preview instead of downloading a new annotated image for every result.

## Run locally

Set up and start the backend in one terminal. The setup script detects the NVIDIA GPU architecture, checks whether the existing PyTorch can run on it, then selects a compatible CUDA wheel or a CPU fallback. The prebuilt wheels bundle the CUDA runtime, so a separate CUDA Toolkit installation (`nvcc`) is not needed.

```powershell
cd backend
.\setup_backend.ps1
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Start the frontend in another terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open the Vite URL (normally `http://localhost:5173`) and allow camera access. Vite forwards `/api` requests to the Python server. The first inference downloads the default `yolo11m.pt` model if it is not already available.

## Configuration

- `YOLO_MODEL`: model file or Ultralytics model name (default `yolo11m.pt`).
- `YOLO_DEVICE`: `auto`, a CUDA device index, or a PyTorch device name (default `auto`; uses a compatible GPU and falls back to CPU).
- `YOLO_IMAGE_SIZE`: inference image size in pixels (default `416`; use `640` for higher detection detail).
- `DETECTION_CONFIDENCE`: minimum person confidence from 0 to 1 (default `0.35`).
- `FRONTEND_ORIGINS`: comma-separated browser origins permitted by the API (default includes localhost:5173).

## Run YOLO11 directly on the camera

The standalone camera runner does not start FastAPI. From the `backend` directory, run:

```powershell
.venv\Scripts\python.exe yolo11_camera.py
```

It automatically uses CUDA device 0 when PyTorch can run on it and otherwise uses CPU. It defaults to YOLO11 medium and a 416-pixel inference size. Press `q` or Esc in the video window to quit. You can override settings, for example:

```powershell
.venv\Scripts\python.exe yolo11_camera.py --camera 1 --model yolo11n.pt --imgsz 640 --conf 0.4
```

Use `--device cpu` to force CPU inference, or pass a video file / stream URL with `--camera`.

The dashboard sends JPEG frames up to 640 pixels wide and checks for a new frame every 250 ms while the camera is live. The browser preview stays at the camera's own frame rate; AI detection runs on sampled frames and returns bounding boxes and metrics. The backend selects a usable GPU automatically and falls back to CPU if CUDA is unavailable or fails the startup warmup. GPU availability, selected device, and PyTorch CUDA runtime are exposed by `/api/health` and `/api/summary`; detection responses include model inference, API processing, and processed-frame-rate metrics. The dashboard measures browser round-trip time separately.

While the camera is live, select **Edit detection area** and drag a rectangle over the feed. The API counts person detections whose box center falls inside that rectangle. The selected area is saved in the browser; use **Use full frame** to clear it.
