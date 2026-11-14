# Desktop app: local setup and operation

The desktop shell reuses the React dashboard and FastAPI/YOLO service. Electron starts one local API process, proxies the dashboard's API calls, and stops the service when the app closes. Camera video is captured by the desktop Chromium window and sent to the local backend in memory; this project does not save camera frames or video files.

## First-time Windows setup

1. Install Node.js 20 or newer and Python 3.11 or newer.
2. From the project folder, run `npm install` and `npm --prefix frontend install`.
3. Run `npm exec electron -- --version` once so Electron's Windows runtime is downloaded.
4. Run `npm run backend:setup` once. This prepares the Python environment and selects CUDA or CPU PyTorch.
5. Run `npm run desktop:start`. The command builds the dashboard and opens the desktop window. The YOLO model is loaded/downloaded on first inference if it is not already present.

For development, run `npm run desktop:dev` after the frontend has been built. The desktop app binds its API to 127.0.0.1 by default and uses a random available port. It does not open a public endpoint.

## Local data and privacy

The app writes its SQLite database, generated telemetry encryption key, and exported CSV files under Electron's user data folder (Windows: `%APPDATA%\school-zone-safety-monitor-desktop` or the path shown by **App → Open local data folder**). Detection frames are processed in memory and are not persisted. Detection events and one-per-frame metrics are persisted as described in the main README. Keep Windows account access restricted to approved operators and protect backups according to the approved research protocol.

Set `retentionDays` in `desktop-config.json` to the period approved for the study. `0` disables automatic deletion; it means records remain until an operator deletes them. When set above zero, the backend deletes older event and telemetry records on startup and periodically during inference. Before live research use, set this to match the UREC-approved retention period rather than relying on the default.

To delete local records, quit the app, then remove `school_zone.db`, `school_zone.db-shm`, and `school_zone.db-wal` from the local data folder. This also deletes saved events, totals, alert settings, and telemetry. Remove `telemetry.key` only if encrypted exports should no longer be decryptable. Delete exports separately if they are no longer required. Follow the approved protocol and backup/deletion rules.

## Desktop configuration

The app creates `desktop-config.json` under the local data folder on first launch:

- `allowEsp32LanAccess`: defaults to `false`; the API listens only on loopback. Set to `true` only on the designated trusted school LAN when the ESP32 needs to connect. The OS firewall may need a narrow local-network rule. Configure the firmware backend URL to the host's reserved LAN IP and the API port shown in the backend startup output. Do not forward that port from the router or expose it through a public tunnel.
- `apiPort`: defaults to `8000`; keep this aligned with the ESP32 firmware URL.
- `hardwareAlertsEnabled`: defaults to `false`; set to `true` only when the ESP32 is configured and the approved deployment calls for physical alerts.
- `retentionDays`: set to the UREC-approved data retention period in days; zero means no automatic cleanup.
- `pythonExecutable`: optional full path to a Python executable if it is not `backend/.venv/Scripts/python.exe`.
- `model`: local model filename or supported Ultralytics model name.
- `device`: `auto` (default), `cpu`, or a CUDA device such as `cuda:0`. Use `cpu` to avoid GPU/CUDA runtime problems.

Close and restart the desktop app after changing configuration. Dashboard alert thresholds remain editable in **Dashboard menu → Alert settings**. Hardware access exposes the backend to other devices on the local network and does not add user authentication; use it only on a trusted, access-controlled LAN.

## CUDA setup troubleshooting

An RTX 3050 is CUDA-capable (compute capability 8.6). The first CUDA probe may report that CUDA is unavailable because the initial `requirements.txt` install can bring in a CPU-only PyTorch build; the setup script then installs and probes a GPU-enabled build. The probe now runs a CUDA/cuDNN convolution before reporting success. If neither GPU wheel passes, setup installs CPU PyTorch so the app can still run.

If setup ends with CPU fallback, update the NVIDIA driver and rerun `npm run backend:setup`. CUDA 13.x needs a recent driver (NVIDIA lists 580 or newer for minor-version compatibility); the setup script also tries the CUDA 12.6 wheel for older supported drivers. A separate CUDA Toolkit installation is not required for the PyTorch wheels. See the [PyTorch Windows wheel options](https://pytorch.org/get-started/previous-versions/) and [NVIDIA CUDA driver compatibility table](https://docs.nvidia.com/deploy/cuda-compatibility/minor-version-compatibility.html).

If the GPU build still fails, set `device` to `cpu` in `desktop-config.json` to use the app while investigating, and share the final CUDA/cuDNN probe output plus `nvidia-smi` driver version for diagnosis.

## Packaging

This source project currently expects Node.js and the prepared Python environment on the designated computer. Producing a standalone installer with a bundled Python runtime and compatible PyTorch/CUDA libraries is a separate packaging step; it should be built and verified on the target Windows architecture and GPU environment.
