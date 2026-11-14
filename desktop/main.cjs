const { app, BrowserWindow, Menu, dialog, session, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

if (!app.requestSingleInstanceLock()) app.quit();

const projectRoot = path.resolve(__dirname, "..");
const frontendRoot = path.join(projectRoot, "frontend");
const backendRoot = path.join(projectRoot, "backend");
const configFile = path.join(app.getPath("userData"), "desktop-config.json");
const cameraDisabledForTest = process.argv.includes("--test-no-camera");
let apiServer;
let backendProcess;
let windowRef;
let apiPort;
let uiPort;
let shuttingDown = false;

function loadConfig() {
  const defaults = {
    allowEsp32LanAccess: false,
    hardwareAlertsEnabled: false,
    retentionDays: 0,
    apiPort: 8000,
    pythonExecutable: "",
    model: "yolo11m.pt",
    device: "auto",
  };
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(configFile, "utf8")) };
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error(`Could not read desktop configuration at ${configFile}: ${error.message}`);
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, `${JSON.stringify(defaults, null, 2)}\n`, { flag: "wx" });
    return defaults;
  }
}

function choosePort(host, requestedPort) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(requestedPort, host, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function getPython(config) {
  if (config.pythonExecutable) return config.pythonExecutable;
  const venvPython = path.join(backendRoot, ".venv", "Scripts", "python.exe");
  return fs.existsSync(venvPython) ? venvPython : "python";
}

function startBackend(config) {
  const dataDir = app.getPath("userData");
  const bindHost = config.allowEsp32LanAccess ? "0.0.0.0" : "127.0.0.1";
  backendProcess = spawn(getPython(config), ["-m", "uvicorn", "main:app", "--host", bindHost, "--port", String(apiPort)], {
    cwd: backendRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      DATABASE_PATH: path.join(dataDir, "school_zone.db"),
      TELEMETRY_KEY_PATH: path.join(dataDir, "telemetry.key"),
      EXPORT_DIRECTORY: path.join(dataDir, "exports"),
      HARDWARE_ALERT_ENABLED: String(Boolean(config.hardwareAlertsEnabled)),
      DATA_RETENTION_DAYS: String(Math.max(0, Number(config.retentionDays) || 0)),
      YOLO_MODEL: config.model || "yolo11m.pt",
      YOLO_DEVICE: process.env.YOLO_DEVICE || config.device || "auto",
      FRONTEND_ORIGINS: "http://127.0.0.1",
    },
  });
  backendProcess.stdout.on("data", (chunk) => process.stdout.write(`[backend] ${chunk}`));
  backendProcess.stderr.on("data", (chunk) => process.stderr.write(`[backend] ${chunk}`));
  backendProcess.on("error", (error) => showStartupError(`Could not start Python backend: ${error.message}`));
  backendProcess.on("exit", (code) => {
    if (!shuttingDown && code !== 0) showStartupError(`The Python service stopped (exit code ${code}). Check that backend setup completed.`);
  });
}

function serveAndProxy() {
  const distRoot = path.join(frontendRoot, "dist");
  apiServer = http.createServer((request, response) => {
    const target = new URL(request.url, `http://127.0.0.1:${uiPort}`);
    if (target.pathname.startsWith("/api/")) {
      const proxy = http.request({ hostname: "127.0.0.1", port: apiPort, path: `${target.pathname}${target.search}`, method: request.method, headers: { ...request.headers, host: `127.0.0.1:${apiPort}` } }, (upstream) => {
        response.writeHead(upstream.statusCode || 502, upstream.headers);
        upstream.pipe(response);
      });
      proxy.on("error", () => { response.writeHead(503); response.end("Local detection service is unavailable."); });
      request.pipe(proxy);
      return;
    }
    const relative = decodeURIComponent(target.pathname === "/" ? "/index.html" : target.pathname);
    const filePath = path.resolve(distRoot, `.${relative}`);
    if (!filePath.startsWith(`${distRoot}${path.sep}`) && filePath !== path.join(distRoot, "index.html")) {
      response.writeHead(403); response.end("Forbidden"); return;
    }
    fs.readFile(filePath, (error, content) => {
      if (error) { response.writeHead(404); response.end("Not found"); return; }
      const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".mp3": "audio/mpeg" }[path.extname(filePath)] || "application/octet-stream";
      response.writeHead(200, { "Content-Type": mime, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" });
      if (path.basename(filePath) === "index.html") {
        response.end(content.toString("utf8").replace("</head>", "<script>window.__SCHOOL_ZONE_DESKTOP__=true</script></head>"));
      } else {
        response.end(content);
      }
    });
  });
  return new Promise((resolve, reject) => {
    apiServer.once("error", reject);
    apiServer.listen(0, "127.0.0.1", () => { uiPort = apiServer.address().port; resolve(); });
  });
}

function createWindow() {
  windowRef = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 980,
    minHeight: 700,
    title: "School Zone Safety Monitor",
    backgroundColor: "#f5f8fb",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  windowRef.loadURL(`http://127.0.0.1:${uiPort}/`);
  windowRef.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://127.0.0.1:")) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });
  windowRef.on("closed", () => { windowRef = null; });
}

async function showStartupError(message) {
  if (shuttingDown) return;
  await dialog.showMessageBox({ type: "error", title: "School Zone Safety Monitor", message, detail: `Setup guide: ${path.join(projectRoot, "DESKTOP.md")}` });
}

app.whenReady().then(async () => {
  const config = loadConfig();
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return !cameraDisabledForTest && permission === "media" && new URL(requestingOrigin).hostname === "127.0.0.1";
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const trustedDashboard = webContents.getURL().startsWith("http://127.0.0.1:");
    callback(!cameraDisabledForTest && trustedDashboard && permission === "media" && details.mediaTypes?.includes("video"));
  });
  const bindHost = config.allowEsp32LanAccess ? "0.0.0.0" : "127.0.0.1";
  apiPort = await choosePort(bindHost, Math.max(1024, Math.min(65535, Number(config.apiPort) || 8000)));
  await serveAndProxy();
  startBackend(config);
  createWindow();
}).catch((error) => showStartupError(`Desktop startup failed: ${error.message}`));

Menu.setApplicationMenu(Menu.buildFromTemplate([
  { label: "App", submenu: [
    { label: "Open local data folder", click: () => shell.openPath(app.getPath("userData")) },
    { label: "Open desktop configuration", click: () => shell.openPath(configFile) },
    { type: "separator" }, { role: "quit" },
  ] },
]));

app.on("before-quit", (event) => {
  if (shuttingDown) return;
  shuttingDown = true;
  if (!backendProcess || backendProcess.exitCode !== null || !backendProcess.pid) {
    if (apiServer) apiServer.close();
    return;
  }

  // Keep Electron alive until the Python/Uvicorn process tree has released model and GPU memory.
  event.preventDefault();
  let finished = false;
  const finishShutdown = () => {
    if (finished) return;
    finished = true;
    clearTimeout(forceTimer);
    if (apiServer) apiServer.close();
    app.quit();
  };
  backendProcess.once("exit", finishShutdown);
  const forceTimer = setTimeout(() => {
    if (backendProcess.exitCode === null) backendProcess.kill();
    setTimeout(finishShutdown, 1500).unref();
  }, 5000);
  forceTimer.unref();

  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(backendProcess.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
    killer.once("error", () => backendProcess.kill());
  } else {
    backendProcess.kill("SIGTERM");
  }
});
app.on("window-all-closed", () => app.quit());
