#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFi.h>

#ifndef USE_BACKEND_API
#define USE_BACKEND_API 0
#endif

#ifndef BACKEND_API_URL
#define BACKEND_API_URL "http://host.wokwi.internal:8000"
#endif

namespace {
constexpr uint8_t ALERT_LED_PIN = 4;
constexpr uint8_t READY_LED_PIN = 5;
constexpr uint8_t BUZZER_PIN = 6;
constexpr uint8_t TEST_BUTTON_PIN = 7;
constexpr uint32_t ALERT_DURATION_MS = 5000;
constexpr uint32_t OUTPUT_STEP_MS = 250;
constexpr uint32_t BACKEND_POLL_MS = 500;
constexpr uint32_t WIFI_RETRY_MS = 10000;
constexpr char WIFI_SSID[] = "Wokwi-GUEST";
constexpr char WIFI_PASSWORD[] = "";

bool alertActive = false;
bool backendAlert = false;
uint32_t alertStartedAt = 0;
uint32_t lastOutputStepAt = 0;
uint32_t lastBackendPollAt = 0;
uint32_t lastWiFiAttemptAt = 0;
bool outputOn = false;
bool previousButtonState = HIGH;

String apiUrl(const char *path) {
  return String(BACKEND_API_URL) + path;
}

void beginAlert(bool receivedFromBackend) {
  if (alertActive) return;
  alertActive = true;
  backendAlert = receivedFromBackend;
  alertStartedAt = millis();
  lastOutputStepAt = 0;
  outputOn = false;
  Serial.println(receivedFromBackend ? "Backend alert received" : "Local test alert started");
}

void stopAlert() {
  alertActive = false;
  backendAlert = false;
  noTone(BUZZER_PIN);
  digitalWrite(ALERT_LED_PIN, LOW);
  digitalWrite(READY_LED_PIN, HIGH);
  Serial.println("Alert sequence finished");
}

void acknowledgeBackendAlert() {
#if USE_BACKEND_API
  if (!backendAlert || WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  http.setTimeout(1500);
  if (http.begin(apiUrl("/api/hardware-alert/finished"))) {
    const int status = http.POST("");
    Serial.printf("Backend alert acknowledgement: HTTP %d\n", status);
    http.end();
  }
#endif
}

void pollBackend() {
#if USE_BACKEND_API
  const uint32_t now = millis();
  if (now - lastBackendPollAt < BACKEND_POLL_MS || WiFi.status() != WL_CONNECTED) return;
  lastBackendPollAt = now;

  HTTPClient http;
  http.setTimeout(1500);
  if (!http.begin(apiUrl("/api/hardware-alert"))) return;
  const int status = http.GET();
  if (status == HTTP_CODE_OK) {
    const String body = http.getString();
    const bool activeOnServer = body.indexOf("\"active\":true") >= 0;
    if (activeOnServer && !alertActive) beginAlert(true);
    // A browser-side stop/ack can release the server latch before the local timer expires.
    if (!activeOnServer && alertActive && backendAlert) stopAlert();
  } else if (status < 0) {
    Serial.printf("Backend poll failed: %s\n", http.errorToString(status).c_str());
  } else {
    Serial.printf("Backend poll returned HTTP %d\n", status);
  }
  http.end();
#endif
}

void maintainWiFi() {
#if USE_BACKEND_API
  if (WiFi.status() == WL_CONNECTED) return;
  const uint32_t now = millis();
  if (now - lastWiFiAttemptAt < WIFI_RETRY_MS) return;
  lastWiFiAttemptAt = now;
  Serial.println("Connecting to Wokwi-GUEST...");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD, 6);
#endif
}

void updateOutputs() {
  const uint32_t now = millis();
  if (!alertActive) {
    digitalWrite(ALERT_LED_PIN, LOW);
    digitalWrite(READY_LED_PIN, HIGH);
    return;
  }

  if (now - lastOutputStepAt >= OUTPUT_STEP_MS) {
    lastOutputStepAt = now;
    outputOn = !outputOn;
    digitalWrite(ALERT_LED_PIN, outputOn ? HIGH : LOW);
    if (outputOn) tone(BUZZER_PIN, 2200);
    else noTone(BUZZER_PIN);
  }

  if (now - alertStartedAt >= ALERT_DURATION_MS) {
    acknowledgeBackendAlert();
    stopAlert();
  }
}
}  // namespace

void setup() {
  Serial.begin(115200);
  pinMode(ALERT_LED_PIN, OUTPUT);
  pinMode(READY_LED_PIN, OUTPUT);
  pinMode(TEST_BUTTON_PIN, INPUT_PULLUP);
  digitalWrite(ALERT_LED_PIN, LOW);
  digitalWrite(READY_LED_PIN, HIGH);
  noTone(BUZZER_PIN);

#if USE_BACKEND_API
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD, 6);
  lastWiFiAttemptAt = millis();
  Serial.printf("Polling backend at %s\n", BACKEND_API_URL);
#else
  Serial.println("Standalone Wokwi demo: press the blue button or A to test the alert outputs.");
#endif
}

void loop() {
  maintainWiFi();
  pollBackend();

  const bool buttonState = digitalRead(TEST_BUTTON_PIN);
  if (previousButtonState == HIGH && buttonState == LOW) beginAlert(false);
  previousButtonState = buttonState;

  updateOutputs();
  delay(10);
}
