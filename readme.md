# School Zone Safety Monitor

The React dashboard keeps the browser camera preview local and sends sampled frames to a Python API for YOLO person detection. The API returns detection boxes and live metrics; React draws the boxes over the live preview instead of downloading a new annotated image for every result.

## Future rebuild idea: local desktop application

This section records a possible future direction for the project. It is a planning note, not a description of the current implementation.

### Goal

If the project is rebuilt, consider making it a local-first desktop application for use on the designated on-site computer. The camera, user interface, YOLO inference, event database, and ESP32-S3 alert connection should operate on that computer and its local network. Remote access and cloud processing should be disabled by default. This may fit the research context and UREC review better by keeping camera frames and event data on-site, provided the final approved protocol and safeguards are followed.

### Current app versus desktop wrapper

- **Current local browser setup:** Run the Python FastAPI backend and React dashboard on the same computer, then open the dashboard at a localhost URL. The browser obtains camera access, shows the live preview, and sends sampled frames to the local API. The Python backend runs YOLO and stores event history in local SQLite. The ESP32 can connect to the backend over the school LAN. This already avoids sending frames to a cloud service when used entirely on that computer.
- **Desktop wrapper:** Package the existing React dashboard in a desktop shell and have the desktop app launch/manage the Python backend. Aim for a one-click startup and shutdown, a dedicated app window, clearer local configuration, and less need for operators to work in terminals or browser tabs. A wrapper can reuse much of the current frontend and backend; it does not by itself improve model accuracy, privacy, or ethics.
- **Possible later extension:** If the system should access the hosted computer's camera directly without browser media APIs, evaluate moving camera capture into a native or backend component. This is a larger architectural change than simply wrapping the current dashboard and should be assessed for camera compatibility and performance.

### Research ethics and privacy requirements to plan

Local execution is a data-location choice, not an ethics approval or a complete safeguard. Before use, align the implementation and operating procedure with the UREC-approved protocol. Document camera placement and purpose, participant notice/consent as required by the committee, whether footage is stored or only processed live, what event/telemetry data is retained, who can access the computer and database, retention duration, secure backup, and deletion procedures. Minimize collection of identifiable footage and avoid retaining it unless the approved protocol requires it. Keep the computer physically secured and account access limited to authorized operators. The current API has no built-in user login, so do not expose it through an unauthenticated network tunnel or public endpoint.

### Rebuild direction and open decisions

Keep the local browser deployment as a viable simpler option unless one-click operation, reduced operator setup, or tighter control over the app lifecycle justifies a desktop wrapper. If rebuilding, preserve the existing React interface, Python YOLO service, SQLite history, settings, exports, and ESP32 integration where practical. Prefer local-only API binding by default, persistent data in a clearly identified local application-data directory, explicit controls for starting/stopping camera processing, and visible status for camera, inference device, database, and hardware alerts. Decide whether the desktop app is Windows-only or cross-platform, whether the camera is selected in the browser UI or captured by the backend/native app, how updates and backups work, and which data the approved study actually needs to retain.

### Prompt to resume this idea later

> Help me rebuild the School Zone Safety Monitor as a local-first desktop app. Read the “Future rebuild idea: local desktop application” section in the README and inspect the current code before proposing or making changes. Keep camera processing, YOLO inference, SQLite data, dashboard, and ESP32-S3 integration on the designated computer/local network by default; do not add cloud processing or public remote access. Preserve existing features where practical. Plan for one-click startup/shutdown and operator-friendly status/configuration. Treat UREC requirements as constraints: design for data minimization, clear retention/deletion, restricted access, and no footage retention unless the approved protocol requires it. First identify architecture and migration steps, then implement the agreed scope.

## Run locally

Set up and start the backend in one terminal. The setup script detects the NVIDIA GPU architecture, checks whether the existing PyTorch can run on it, then selects a compatible CUDA wheel or a CPU fallback. The prebuilt wheels bundle the CUDA runtime, so a separate CUDA Toolkit installation (`nvcc`) is not needed.

```powershell
cd backend
.\setup_backend.ps1
$env:HARDWARE_ALERT_ENABLED = "1"
uvicorn main:app --reload --host 0.0.0.0 --port 8000
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
- `DETECTION_CONFIDENCE`: minimum person confidence from 0 to 1 (default `0.65`, or 65%). Detections below this threshold are ignored.
- `ALERT_ONE_PERSON_DWELL_SECONDS`: how long one detected pedestrian must remain before the alert triggers (default `12`).
- `ALERT_TWO_PERSON_DWELL_SECONDS`: wait time for two detected pedestrians (default `8`).
- `ALERT_THREE_OR_MORE_DWELL_SECONDS`: wait time for three or more detected pedestrians (default `5`). If the group size changes during a countdown, elapsed time is preserved and the current count's wait time applies.
- `HARDWARE_ALERT_ENABLED`: set to `1` when the ESP32 should receive automatic and manual dashboard alerts (default `false`). The backend's `/api/health` response reports whether hardware alerts are enabled.
- Detection confidence, pedestrian dwell delays, and standby beep interval can be changed from **Dashboard menu → Alert settings**. These website changes are stored in the backend SQLite database and apply immediately. The hardware alert enable switch and ESP32 wiring/pin behavior remain deployment and firmware settings.
- The alert sound `backend/source/beep3.mp3` plays once when the countdown completes. No new countdown starts until the browser finishes playing the alert sound.
- `backend/source/beep1.mp3` repeats during standby and while an alert countdown is pending, with a fixed one-second delay after each beep finishes. Standby beeps resume after `beep3` finishes.
- `FRONTEND_ORIGINS`: comma-separated browser origins permitted by the API (default includes localhost:5173).
- `DATABASE_PATH`: SQLite database file path (default `backend/school_zone.db`). The backend creates the database and tables on startup. Detection totals and event history persist across restarts.
- `TELEMETRY_KEY_PATH`: location for the auto-generated Fernet key (default `backend/telemetry.key`). The backend creates it on first encrypted export and reuses it. Keep this file private and backed up, since it is needed to decrypt exports.
- `TELEMETRY_ENCRYPTION_KEY`: optional Fernet key override for deployments that manage secrets outside the project directory.



The Recent detections panel offers a CSV download for the full event history and an encrypted telemetry CSV download (`.csv.enc`). The telemetry export is encrypted with the configured Fernet key and must be decrypted before analysis.

## Deploy the dashboard online with on-site YOLO inference

This setup hosts the React dashboard as a static website (for example, a Render Static Site) while FastAPI, the YOLO model, and SQLite run on a computer at the site. The ESP32-S3 also connects to that on-site computer. This keeps inference and stored event data on-site, but the browser camera frames travel from the operator's browser to the on-site API.

### Network layout

```text
Operator browser -- HTTPS dashboard -- online static host
       |
       +-- HTTPS API connection (secure tunnel/VPN) --> On-site computer
                                                        FastAPI + YOLO + SQLite
ESP32-S3 ---------------- school LAN ----------------> FastAPI
```

The API must be securely reachable by every browser that uses the dashboard. A private address such as `http://192.168.1.50:8000` or `localhost:8000` is not reachable from the public website for remote users. Use a school-approved VPN or an authenticated HTTPS tunnel/API gateway that forwards traffic to the on-site service. Do not expose port `8000` directly to the public internet. The ESP32-S3 can use the computer's reserved private LAN address because it is on the same network.

### 1. Prepare the on-site computer

Install Python and follow the backend setup in [Run locally](#run-locally). Keep the computer powered on and connected to the network. Reserve its LAN IP address in the router so the ESP32-S3 endpoint remains stable. Bind FastAPI to the computer's network interfaces so the ESP32 can reach it; configure the selected VPN or HTTPS gateway to forward browser requests to that same on-site service. Use authentication and HTTPS for browser access.

From PowerShell, start the API with hardware alerts enabled and the dashboard's online origin permitted. Replace the example origin with the exact HTTPS URL of the deployed dashboard (no trailing slash):

```powershell
cd backend
$env:HARDWARE_ALERT_ENABLED = "1"
$env:FRONTEND_ORIGINS = "https://your-dashboard.example"
.\.venv\Scripts\uvicorn.exe main:app --host 0.0.0.0 --port 8000
```

The first model inference may download the model specified by `YOLO_MODEL` (default `yolo11m.pt`), so ensure the on-site computer has internet access for initial setup or place the model file there in advance. Keep `DATABASE_PATH` and the telemetry encryption key in persistent on-site storage and back them up securely.

Check service readiness from the on-site computer at `http://127.0.0.1:8000/api/health`. The `/api/summary` endpoint reports model and device status after startup. Keep the backend terminal or service running while the dashboard is in use.

### 2. Configure and deploy the frontend

In Render, create a **Static Site** from this repository and set:

- **Root Directory:** `frontend`
- **Build Command:** `npm install && npm run build`
- **Publish Directory:** `dist`

The deployed dashboard sends its `/api` requests to `VITE_API_BASE_URL`. In Render, open the Static Site's **Environment** settings and add `VITE_API_BASE_URL` with the HTTPS origin of the secure tunnel or VPN gateway, for example `https://api-your-site.example` (no trailing slash). Save and redeploy so Vite embeds the value in the static build. Do not enter `localhost`, a private LAN address, or the Render dashboard URL here. For local development, leave the variable unset; Vite then uses its existing `/api` proxy to `localhost:8000`.

Verify that the API gateway forwards `/api/*` to the on-site FastAPI server, that FastAPI's `FRONTEND_ORIGINS` exactly matches the dashboard origin, and that the camera permission prompt works on the HTTPS dashboard. Test from a device outside the school LAN if remote access is required. A public tunnel makes the API internet-reachable; protect it with an authenticated gateway or VPN and confirm the browser can authenticate API requests before using real camera footage. The current API does not implement its own user login or access token, so do not publish an unauthenticated tunnel.

### 3. Configure the ESP32-S3

For the physical ESP32-S3, follow [the hardware setup guide](hardware/README.md). Configure Wi-Fi credentials, the API address, and GPIO pins in `hardware/src/main.cpp`, then build and upload the firmware. USB-C is used for power, programming, and serial logs; Wi-Fi carries alert API requests.

Keep the API gateway and the backend URL hardcoded in the ESP32 firmware pointed at the same FastAPI instance. If the computer is unavailable, the online dashboard may load but live detection and hardware alerts will not work.

## Research instrument data

The SQLite `telemetry_records` table and **Export encrypted telemetry CSV** contain one record per processed frame: UTC timestamp, rolling inference FPS, mean person-detection confidence, whether a detection zone was configured, intrusion status and timestamp when that zone is configured, detection count, and model inference latency. The project treats the user-drawn detection zone as the crosswalk measurement area; without a configured zone, crosswalk intrusion is left blank rather than inferred from a full-frame detection.

The 15 FPS target can be compared with the logged rolling FPS. Detection confidence is not mAP@0.5; mAP requires labeled ground-truth evaluation data, which this live camera flow does not collect. End-to-end alert activation and GPIO latency are exported as blank fields until an alert/GPIO output is integrated and measured. The 80% mAP@0.5 and 2.0-second alert activation targets therefore must be evaluated separately before reporting endpoint results. ISO/IEC 25010 and TAM questionnaire responses are not generated by the camera telemetry logger.

To decrypt an exported telemetry file, run this from the `backend` folder and adjust the input/output paths as needed:

```python
from pathlib import Path
from cryptography.fernet import Fernet

cipher = Fernet(Path("telemetry.key").read_bytes().strip())
encrypted = Path("school-zone-telemetry.csv.enc").read_bytes()
Path("school-zone-telemetry.csv").write_bytes(cipher.decrypt(encrypted))
```

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

## ESP32-S3 alert hardware

The `hardware` folder contains PlatformIO firmware for the physical ESP32-S3 with a green ready LED, red alert LED, and passive piezo buzzer. See [the hardware setup guide](hardware/README.md) for wiring, Wi-Fi configuration, upload, and backend setup.

The dashboard sends JPEG frames up to 640 pixels wide and checks for a frame every 5 ms (a nominal 200 sampling checks per second) while the camera is live. The browser preview stays at the camera's own frame rate; AI detection runs on sampled frames and returns bounding boxes and metrics. The browser skips a sampling tick while a previous detection request is still in progress, so the actual inference rate is limited by frame encoding, API, model processing, camera frame rate, and browser timer scheduling. The backend selects a usable GPU automatically and falls back to CPU if CUDA is unavailable or fails the startup warmup. GPU availability, selected device, and PyTorch CUDA runtime are exposed by `/api/health` and `/api/summary`; detection responses include model inference, API processing, and processed-frame-rate metrics. The dashboard measures browser round-trip time separately.

While the camera is live, select **Edit detection area** and drag a rectangle over the feed. The API counts person detections whose box center falls inside that rectangle. The selected area is saved in the browser; use **Use full frame** to clear it.
