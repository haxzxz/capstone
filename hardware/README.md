# Physical ESP32-S3 alert controller

This firmware is for the physical ESP32-S3, two indicator lights, and one passive piezo buzzer. USB-C powers the board, uploads firmware, and provides serial logs. The ESP32 uses Wi-Fi to poll the FastAPI service; USB alone does not carry alert requests.

## Wiring

Disconnect USB power before wiring.

| ESP32-S3 | Connection |
| --- | --- |
| GPIO 17 | 220 Ω resistor, then alert LED anode (long leg) |
| GPIO 18 | 220 Ω resistor, then ready LED anode (long leg) |
| GND | Both LED cathodes (short legs) |
| GPIO 36 | Piezo positive (+) |
| GND | Piezo negative (−) |

The firmware flashes the alert light and sounds the piezo for five seconds when the backend reports an active alert. The ready light stays on while idle and turns off during the alert. If the buzzer is not a passive piezo or draws more current than a GPIO can safely provide, use an appropriate driver circuit.

**Check the board variant before using GPIO 36:** some ESP32-S3 modules use GPIO 33–37 internally for octal flash or PSRAM, making GPIO 36 unavailable. If your board uses one of those modules, move the piezo signal wire to a free GPIO and update `BUZZER_PIN` to match.

## Configure and run

1. Upload the firmware from this PlatformIO project. It stores configuration in ESP32 non-volatile memory; Wi-Fi credentials are no longer embedded in `main.cpp`.
2. Start FastAPI with hardware alerts enabled:

   ```powershell
   $env:HARDWARE_ALERT_ENABLED = "1"
   uvicorn main:app --host 0.0.0.0 --port 8000
   ```

3. Run the React dashboard at `http://localhost:5173` in Chrome or Edge. Connect the ESP32 by USB-C and close PlatformIO's Serial Monitor so the browser can open its COM port.
4. In the dashboard's **ESP32 settings** panel, choose **Connect ESP32 by USB**, select the ESP32 serial port, enter the Wi-Fi network and password, set the computer's stable LAN address as the backend URL (for example `http://192.168.1.50:8000`), and confirm the GPIO assignments. Click **Save settings to ESP32**. The settings are stored on the board and survive power loss; the Wi-Fi password is not read back into the page.
5. After the board reconnects to Wi-Fi, start the camera. When an alert triggers, the alert light and piezo run for the configured duration.

Allow port 8000 through the computer's firewall for the private network. Keep the backend on a trusted local network; do not expose port 8000 directly to the public internet.

The dashboard can configure the board only while the computer is connected to it over USB. Use localhost or HTTPS in Chrome/Edge because the browser's USB serial feature requires a secure page context. Keep the USB cable connected for future edits; unplugging it after saving does not affect normal Wi-Fi alert operation.
