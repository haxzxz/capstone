# Physical ESP32-S3 alert controller

This firmware is for the physical ESP32-S3, green and red LEDs driven through transistors, and a passive piezo buzzer. USB-C powers and programs the board and provides serial logs. The ESP32 uses Wi-Fi to poll FastAPI; USB does not carry alert requests.

## Wiring

Disconnect USB power before wiring.

| ESP32-S3 | Connection |
| --- | --- |
| GPIO 17 | Green LED transistor control input |
| GPIO 18 | Red LED transistor control input |
| GPIO 36 | Piezo positive (+) |
| GND | Piezo negative (−) |

The green LED indicates the board can reach the backend. During an alert, green turns off while red flashes and the piezo sounds for five seconds. Adjust `BUZZER_VOLUME_PERCENT` near the top of `src/main.cpp` from `0` (silent) to `100` (strongest PWM setting), then upload again. Perceived loudness may not change linearly with the number. The firmware expects a passive piezo. The LED transistors should be wired as drivers with a shared ground; do not power the LEDs directly from the GPIO pins. Some ESP32-S3 board variants reserve GPIO 36 for flash or PSRAM. If yours does, choose a free GPIO and change `BUZZER_PIN` in `src/main.cpp` to match.

## Configure and run

1. The Wi-Fi name, password, and backend URL are hardcoded near the top of `src/main.cpp`. Update `WIFI_SSID`, `WIFI_PASSWORD`, and `BACKEND_API_URL` there to match your network and computer's stable LAN address on port 8000.
2. The current pin assignments are green GPIO 17, red GPIO 18, and buzzer GPIO 36. If your wires differ, update `READY_LED_PIN`, `ALERT_LED_PIN`, and `BUZZER_PIN` in the same file.
3. Build and upload this PlatformIO project again. Any change to these settings requires another upload.
4. In PowerShell, start FastAPI with hardware alerts enabled:

   ```powershell
   cd backend
   $env:HARDWARE_ALERT_ENABLED = "1"
   uvicorn main:app --host 0.0.0.0 --port 8000
   ```

5. Open PlatformIO's Serial Monitor at 115200 baud. Look for `Wi-Fi connected` and `Backend API connected.` The disconnect reason code is printed when Wi-Fi drops. Close the monitor before uploading again.
6. Start the dashboard and camera. When its alert condition triggers, the ESP32 flashes the red LED and sounds the piezo; green turns off. It then acknowledges the alert.

Allow port 8000 through the computer's firewall for the private network. Keep the backend on a trusted local network; do not expose port 8000 directly to the public internet.
