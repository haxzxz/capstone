# ESP32-S3 alert controller (Wokwi)

This PlatformIO project simulates the alert outputs on an ESP32-S3: a blinking red alert LED, an alternating buzzer tone, and a green ready LED. The blue button (or the `A` key while the diagram is focused) starts a five-second local test.

## Run the standalone simulation

Open the `wokwi` folder as a PlatformIO project in VS Code with the Wokwi extension, build the `esp32-s3-devkitc-1` environment, then start the simulator. The default build is standalone and needs no WiFi credentials or backend service.

## Connect to the FastAPI backend

The backend exposes `GET /api/hardware-alert`, which reports whether an alert is active. The ESP32 polls this endpoint and posts to `/api/hardware-alert/finished` after its light/sound sequence completes.

1. Run FastAPI on the host at port 8000 with hardware alerts enabled and bound to an interface reachable by the private gateway: `$env:HARDWARE_ALERT_ENABLED='1'; uvicorn main:app --host 0.0.0.0 --port 8000` from `backend` in PowerShell.
2. Enable the Wokwi Private IoT Gateway in the Wokwi extension. The public gateway cannot reach services on the developer machine.
3. In `platformio.ini`, change `USE_BACKEND_API=0` to `USE_BACKEND_API=1`, then rebuild.
4. Keep `BACKEND_API_URL` in `src/main.cpp` set to `http://host.wokwi.internal:8000` or replace it with a reachable backend URL.

The hardware alert latch is independent from browser audio playback, so the ESP32 can receive the alert even when dashboard sound is turned off. With hardware alerts enabled, the backend keeps the alert controller locked until the device clears the latch by posting the completion endpoint. When the MCU is unavailable, the alert remains latched until it reconnects and acknowledges it.

## Wiring

| ESP32-S3 pin | Part | Purpose |
| --- | --- | --- |
| GPIO 4 | 220 Ω resistor then red LED anode | Alert indicator |
| GPIO 5 | 220 Ω resistor then green LED anode | Ready indicator |
| GPIO 6 | Buzzer positive | Sound output |
| GPIO 7 | Button contact | Local test trigger (active low) |
| GND | LED cathodes, buzzer negative, button contact | Common ground |

Wokwi component references: [ESP32-S3 DevKitC-1](https://docs.wokwi.com/parts/board-esp32-s3-devkitc-1), [LED](https://docs.wokwi.com/parts/wokwi-led), [buzzer](https://docs.wokwi.com/parts/wokwi-buzzer), and [pushbutton](https://docs.wokwi.com/parts/wokwi-pushbutton).

For physical hardware, keep the LED series resistors and drive any buzzer or lamp that exceeds a GPIO pin's current rating through a suitable transistor/driver stage.
