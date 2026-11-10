import { useEffect, useRef, useState } from "react";

const defaults = {
  wifiSsid: "",
  wifiPassword: "",
  backendUrl: "",
  alertLedPin: 17,
  readyLedPin: 18,
  buzzerPin: 36,
  buzzerToneHz: 2200,
  alertDurationMs: 5000,
  outputStepMs: 250,
  backendPollMs: 500,
  wifiRetryMs: 10000,
};

const settingKeys = {
  wifiSsid: "wifi_ssid",
  backendUrl: "backend_url",
  alertLedPin: "alert_led_pin",
  readyLedPin: "ready_led_pin",
  buzzerPin: "buzzer_pin",
  buzzerToneHz: "buzzer_tone_hz",
  alertDurationMs: "alert_duration_ms",
  outputStepMs: "output_step_ms",
  backendPollMs: "backend_poll_ms",
  wifiRetryMs: "wifi_retry_ms",
};

export default function HardwareSettings() {
  const [config, setConfig] = useState(defaults);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const portRef = useRef(null);
  const readerRef = useRef(null);
  const writerRef = useRef(null);
  const decoderRef = useRef(new TextDecoder());
  const lineBufferRef = useRef("");
  const lineQueueRef = useRef([]);
  const lineWaitersRef = useRef([]);

  const deliverLine = (line) => {
    const waiterIndex = lineWaitersRef.current.findIndex((waiter) => waiter.matches(line));
    if (waiterIndex >= 0) {
      const [waiter] = lineWaitersRef.current.splice(waiterIndex, 1);
      window.clearTimeout(waiter.timeoutId);
      waiter.resolve(line);
    } else if (/^(CFG\||END_CONFIG|OK\||ERR\|)/.test(line)) {
      lineQueueRef.current.push(line);
    }
  };

  const waitForLine = (matches, timeoutMs = 5000) => new Promise((resolve, reject) => {
    const queuedIndex = lineQueueRef.current.findIndex(matches);
    if (queuedIndex >= 0) {
      resolve(lineQueueRef.current.splice(queuedIndex, 1)[0]);
      return;
    }
    const waiter = { matches, resolve, reject, timeoutId: null };
    waiter.timeoutId = window.setTimeout(() => {
      lineWaitersRef.current = lineWaitersRef.current.filter((item) => item !== waiter);
      reject(new Error("No response from the ESP32. Check the USB connection and close PlatformIO's Serial Monitor."));
    }, timeoutMs);
    lineWaitersRef.current.push(waiter);
  });

  const startReading = async (reader, writer, port) => {
    let disconnectMessage = "USB disconnected. Reconnect the ESP32 to continue.";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        lineBufferRef.current += decoderRef.current.decode(value, { stream: true });
        const lines = lineBufferRef.current.split(/\r?\n/);
        lineBufferRef.current = lines.pop() || "";
        lines.forEach((line) => deliverLine(line.trim()));
      }
    } catch (error) {
      disconnectMessage = error.message || "USB connection was interrupted.";
    } finally {
      if (portRef.current === port) {
        portRef.current = null;
        readerRef.current = null;
        writerRef.current = null;
        setConnected(false);
        setMessage(disconnectMessage);
      }
      for (const waiter of lineWaitersRef.current) {
        window.clearTimeout(waiter.timeoutId);
        waiter.reject(new Error(disconnectMessage));
      }
      lineWaitersRef.current = [];
      try { reader.releaseLock(); } catch { /* The browser may already have released the reader. */ }
      try { writer.releaseLock(); } catch { /* The browser may already have released the writer. */ }
      try { await port.close(); } catch { /* A disconnected USB device may already be closed. */ }
    }
  };

  const writeLine = async (line) => {
    if (!writerRef.current) throw new Error("Connect the ESP32 over USB first.");
    await writerRef.current.write(new TextEncoder().encode(`${line}\n`));
  };

  const sendAndConfirm = async (command, expected) => {
    const response = waitForLine((line) => line === expected || line.startsWith("ERR|"));
    await writeLine(command);
    const line = await response;
    if (line.startsWith("ERR|")) throw new Error(`ESP32 rejected the setting (${line.slice(4)}).`);
  };

  const loadDeviceConfig = async () => {
    const received = {};
    const isConfigLine = (item) => item.startsWith("CFG|") || item === "END_CONFIG";
    let configLoaded = false;
    for (let attempt = 1; attempt <= 4 && !configLoaded; attempt += 1) {
      await writeLine("GET_CONFIG");
      try {
        while (true) {
          const line = await waitForLine(isConfigLine, 2500);
          if (line === "END_CONFIG") {
            configLoaded = true;
            break;
          }
          const firstSeparator = line.indexOf("|", 4);
          const key = line.slice(4, firstSeparator);
          const value = line.slice(firstSeparator + 1);
          received[key] = value;
        }
      } catch (error) {
        if (attempt === 4) throw error;
      }
    }
    if (!configLoaded) throw new Error("The ESP32 did not finish sending its settings. Reconnect and try again.");
    setConfig((current) => ({
      ...current,
      wifiSsid: received.wifi_ssid ?? "",
      wifiPassword: "",
      backendUrl: received.backend_url ?? "",
      alertLedPin: Number(received.alert_led_pin ?? defaults.alertLedPin),
      readyLedPin: Number(received.ready_led_pin ?? defaults.readyLedPin),
      buzzerPin: Number(received.buzzer_pin ?? defaults.buzzerPin),
      buzzerToneHz: Number(received.buzzer_tone_hz ?? defaults.buzzerToneHz),
      alertDurationMs: Number(received.alert_duration_ms ?? defaults.alertDurationMs),
      outputStepMs: Number(received.output_step_ms ?? defaults.outputStepMs),
      backendPollMs: Number(received.backend_poll_ms ?? defaults.backendPollMs),
      wifiRetryMs: Number(received.wifi_retry_ms ?? defaults.wifiRetryMs),
    }));
  };

  const connectDevice = async () => {
    if (!navigator.serial) {
      setMessage("USB setup needs Chrome or Edge on this computer. Open the dashboard at localhost or over HTTPS.");
      return;
    }
    setBusy(true);
    setMessage("Choose the ESP32 serial port. Close PlatformIO's Serial Monitor first if it is open.");
    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 });
      const reader = port.readable.getReader();
      const writer = port.writable.getWriter();
      portRef.current = port;
      readerRef.current = reader;
      writerRef.current = writer;
      lineBufferRef.current = "";
      lineQueueRef.current = [];
      decoderRef.current = new TextDecoder();
      void startReading(reader, writer, port);
      setMessage("Reading the saved ESP32 settings…");
      await loadDeviceConfig();
      if (portRef.current !== port) throw new Error("USB disconnected before settings could be read. Reconnect the ESP32 and try again.");
      setConnected(true);
      setMessage("Connected. Edit settings and save them to the ESP32.");
    } catch (error) {
      try {
        await readerRef.current?.cancel();
        readerRef.current?.releaseLock();
        writerRef.current?.releaseLock();
        await portRef.current?.close();
      } catch {
        // The browser may have already closed a failed or unplugged port.
      }
      readerRef.current = null;
      writerRef.current = null;
      portRef.current = null;
      const isBusyPort = error.name === "NetworkError" || error.name === "InvalidStateError";
      setMessage(isBusyPort
        ? "The USB port is busy or no longer available. Close PlatformIO's Serial Monitor, unplug and reconnect the ESP32, then try again."
        : error.message || "Could not connect to the ESP32.");
      setConnected(false);
    } finally {
      setBusy(false);
    }
  };

  const saveDeviceConfig = async (event) => {
    event.preventDefault();
    if (!writerRef.current) return;
    if (!config.wifiSsid.trim()) {
      setMessage("Enter the Wi-Fi network name before saving.");
      return;
    }
    const normalizedUrl = config.backendUrl.trim().replace(/\/+$/, "");
    if (!normalizedUrl.startsWith("http://")) {
      setMessage("Enter the computer's local API address, starting with http://.");
      return;
    }

    setBusy(true);
    setMessage("Saving settings to the ESP32…");
    try {
      await sendAndConfirm("BEGIN", "OK|BEGIN");
      const values = { ...config, backendUrl: normalizedUrl };
      for (const [formKey, deviceKey] of Object.entries(settingKeys)) {
        await sendAndConfirm(`SET|${deviceKey}|${values[formKey]}`, `OK|${deviceKey}`);
      }
      if (config.wifiPassword.length > 0) {
        await sendAndConfirm(`SET|wifi_password|${config.wifiPassword}`, "OK|wifi_password");
      }
      await sendAndConfirm("COMMIT", "OK|COMMIT");
      setConfig((current) => ({ ...current, backendUrl: normalizedUrl, wifiPassword: "" }));
      setMessage("Saved on the ESP32. It is reconnecting to Wi-Fi with the updated settings.");
    } catch (error) {
      await writeLine("CANCEL").catch(() => {});
      setMessage(error.message || "Could not save settings to the ESP32.");
    } finally {
      setBusy(false);
    }
  };

  const disconnectDevice = async () => {
    setBusy(true);
    const port = portRef.current;
    const reader = readerRef.current;
    const writer = writerRef.current;
    portRef.current = null;
    readerRef.current = null;
    writerRef.current = null;
    try {
      await reader?.cancel();
      reader?.releaseLock();
      writer?.releaseLock();
      await port?.close();
    } catch {
      // The device may already have been unplugged.
    }
    setConnected(false);
    setBusy(false);
    setMessage("USB disconnected. Settings already saved on the ESP32 remain there.");
  };

  useEffect(() => () => {
    const reader = readerRef.current;
    const writer = writerRef.current;
    const port = portRef.current;
    readerRef.current = null;
    writerRef.current = null;
    portRef.current = null;
    reader?.cancel().catch(() => {});
    writer?.releaseLock();
    reader?.releaseLock();
    port?.close().catch(() => {});
  }, []);

  const update = (key) => (event) => {
    const value = event.target.type === "number" ? Number(event.target.value) : event.target.value;
    setConfig((current) => ({ ...current, [key]: value }));
  };

  return (
    <section className="panel hardware-settings" aria-label="ESP32 hardware settings">
      <div className="panel-heading">
        <div><div className="section-kicker">DEVICE SETUP</div><h2>ESP32 settings</h2></div>
        <span className={`hardware-connection-chip${connected ? " is-connected" : ""}`}><i />{connected ? "USB connected" : "USB disconnected"}</span>
      </div>
      <p className="hardware-settings-copy">Configure Wi-Fi, the backend address, and output pins. Settings are saved on the ESP32 through USB-C.</p>
      <div className="hardware-settings-actions">
        <button className="hardware-connect-button" type="button" onClick={connected ? disconnectDevice : connectDevice} disabled={busy}>
          {busy ? "Please wait…" : connected ? "Disconnect USB" : "Connect ESP32 by USB"}
        </button>
      </div>
      {connected && <form className="hardware-settings-form" onSubmit={saveDeviceConfig}>
        <label>Wi-Fi network name<input autoComplete="off" value={config.wifiSsid} onChange={update("wifiSsid")} required /></label>
        <label>Wi-Fi password<input type="password" autoComplete="new-password" value={config.wifiPassword} onChange={update("wifiPassword")} placeholder="Leave blank to keep saved password" /></label>
        <label>Backend address<input value={config.backendUrl} onChange={update("backendUrl")} placeholder="http://192.168.1.50:8000" required /></label>
        <div className="hardware-pin-grid">
          <label>Alert light GPIO<input type="number" min="1" max="48" value={config.alertLedPin} onChange={update("alertLedPin")} required /></label>
          <label>Ready light GPIO<input type="number" min="1" max="48" value={config.readyLedPin} onChange={update("readyLedPin")} required /></label>
          <label>Piezo GPIO<input type="number" min="1" max="48" value={config.buzzerPin} onChange={update("buzzerPin")} required /></label>
        </div>
        <div className="hardware-pin-grid">
          <label>Alert duration (ms)<input type="number" min="100" max="60000" step="100" value={config.alertDurationMs} onChange={update("alertDurationMs")} required /></label>
          <label>Flash interval (ms)<input type="number" min="50" max="5000" step="50" value={config.outputStepMs} onChange={update("outputStepMs")} required /></label>
          <label>Piezo tone (Hz)<input type="number" min="100" max="5000" step="100" value={config.buzzerToneHz} onChange={update("buzzerToneHz")} required /></label>
        </div>
        <details className="hardware-advanced-settings">
          <summary>Advanced connection timing</summary>
          <div className="hardware-pin-grid">
            <label>Backend poll interval (ms)<input type="number" min="250" max="60000" step="250" value={config.backendPollMs} onChange={update("backendPollMs")} required /></label>
            <label>Wi-Fi retry interval (ms)<input type="number" min="1000" max="120000" step="1000" value={config.wifiRetryMs} onChange={update("wifiRetryMs")} required /></label>
          </div>
        </details>
        <button className="hardware-save-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Save settings to ESP32"}</button>
      </form>}
      {message && <p className="hardware-settings-message" role="status">{message}</p>}
      <small className="hardware-settings-note">Some ESP32-S3 board variants reserve GPIO 36 for flash or PSRAM; verify your board before using that pin for the piezo.</small>
      <small className="hardware-settings-note">USB setup works in Chrome or Edge on localhost or HTTPS. Wi-Fi credentials stay on the ESP32 and are not shown back in the dashboard.</small>
    </section>
  );
}
