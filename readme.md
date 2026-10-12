# School Zone Safety Monitor

The React dashboard streams frames from the browser camera to a Python API. The API runs YOLO person detection and returns the annotated frame and live metrics.

## Run locally

Start the backend in one terminal. The NVIDIA Windows driver provides CUDA support; a separate CUDA Toolkit installation (`nvcc`) is not needed for the prebuilt PyTorch wheel.

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu132
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Start the frontend in another terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open the Vite URL (normally `http://localhost:5173`) and allow camera access. Vite forwards `/api` requests to the Python server. The first inference downloads the default `yolo11n.pt` model if it is not already available.

## Configuration

- `YOLO_MODEL`: model file or Ultralytics model name (default `yolo11n.pt`).
- `YOLO_DEVICE`: CUDA device index or PyTorch device name (default `0`).
- `YOLO_IMAGE_SIZE`: inference image size in pixels (default `416`; use `640` for higher detection detail).
- `DETECTION_CONFIDENCE`: minimum person confidence from 0 to 1 (default `0.35`).
- `FRONTEND_ORIGINS`: comma-separated browser origins permitted by the API (default includes localhost:5173).

## Run YOLO11 directly on the camera

The standalone camera runner does not start FastAPI. From the `backend` directory, run:

```powershell
.venv\Scripts\python.exe yolo11_camera.py
```

It uses CUDA device 0, the YOLO11 nano model, and a 416-pixel inference size by default. Press `q` or Esc in the video window to quit. You can override settings, for example:

```powershell
.venv\Scripts\python.exe yolo11_camera.py --camera 1 --model yolo11s.pt --imgsz 640 --conf 0.4
```

Use `--device cpu` to run without CUDA, or pass a video file / stream URL with `--camera`.

The dashboard sends JPEG frames up to 640 pixels wide and checks for a new frame every 250 ms while the camera is live. The backend explicitly loads and runs YOLO11 nano on CUDA device 0 with a 416-pixel inference size and FP16 precision. GPU availability, model device, and PyTorch CUDA runtime are exposed by `/api/health` and `/api/summary`; detection responses include model inference, API processing, browser round-trip, and processed-frame-rate metrics.
