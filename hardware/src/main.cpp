#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFi.h>

namespace {
// Edit these values here, then build and upload the firmware again.
constexpr char WIFI_SSID[] = "hshs";
constexpr char WIFI_PASSWORD[] = "123456789";
constexpr char BACKEND_API_URL[] = "http://10.53.71.204:8000";

constexpr uint8_t READY_LED_PIN = 17;
constexpr uint8_t ALERT_LED_PIN = 18;
constexpr uint8_t BUZZER_PIN = 36;
constexpr uint16_t BUZZER_TONE_HZ = 8000;
// PWM duty cycle percent: 0 is silent; increase toward 100 for a stronger tone.
constexpr uint8_t BUZZER_VOLUME_PERCENT = 100;
constexpr uint8_t BUZZER_PWM_BITS = 8;
constexpr uint16_t BUZZER_PWM_MAX_DUTY = (1U << BUZZER_PWM_BITS) - 1;
static_assert(BUZZER_VOLUME_PERCENT <= 100, "Buzzer volume must be between 0 and 100 percent.");
constexpr uint32_t ALERT_DURATION_MS = 5000;
constexpr uint32_t OUTPUT_STEP_MS = 250;
constexpr uint32_t BACKEND_POLL_MS = 500;
constexpr uint32_t WIFI_RETRY_MS = 10000;
constexpr uint32_t WIFI_CONNECT_TIMEOUT_MS = 30000;

bool alertActive = false;
bool backendAlert = false;
bool outputOn = false;
bool wasConnected = false;
bool backendReachable = false;
bool wifiAttemptInProgress = false;
int lastBackendFailureStatus = 0;
uint32_t alertStartedAt = 0;
uint32_t lastOutputStepAt = 0;
uint32_t lastBackendPollAt = 0;
uint32_t lastWiFiAttemptAt = 0;

void setBuzzer(bool enabled) {
  const uint32_t duty = enabled
      ? (static_cast<uint32_t>(BUZZER_PWM_MAX_DUTY) * BUZZER_VOLUME_PERCENT + 50) / 100
      : 0;
  ledcWrite(BUZZER_PIN, duty);
}

String apiUrl(const char *path) {
  return String(BACKEND_API_URL) + path;
}

void logWiFiEvent(WiFiEvent_t event, WiFiEventInfo_t info) {
  if (event == ARDUINO_EVENT_WIFI_STA_DISCONNECTED) {
    Serial.printf("Wi-Fi disconnected; reason code: %u\n",
                  static_cast<unsigned>(info.wifi_sta_disconnected.reason));
  } else if (event == ARDUINO_EVENT_WIFI_STA_GOT_IP) {
    Serial.printf("Wi-Fi connected; ESP32 IP: %s; signal: %d dBm\n",
                  WiFi.localIP().toString().c_str(), WiFi.RSSI());
  }
}

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  Serial.printf("Connecting to Wi-Fi: %s\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWiFiAttemptAt = millis();
  wifiAttemptInProgress = true;
}

void beginAlert() {
  if (alertActive) return;
  alertActive = true;
  backendAlert = true;
  alertStartedAt = millis();
  lastOutputStepAt = 0;
  outputOn = false;
  Serial.println("Backend alert received");
}

void stopAlert() {
  alertActive = false;
  backendAlert = false;
  setBuzzer(false);
  digitalWrite(ALERT_LED_PIN, LOW);
  digitalWrite(READY_LED_PIN, backendReachable ? HIGH : LOW);
  Serial.println("Alert sequence finished");
}

void acknowledgeBackendAlert() {
  if (!backendAlert || WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  http.setTimeout(1500);
  if (http.begin(apiUrl("/api/hardware-alert/finished"))) {
    const int status = http.POST("");
    Serial.printf("Backend alert acknowledgement: HTTP %d\n", status);
    http.end();
  }
}

void pollBackend() {
  const uint32_t now = millis();
  if (now - lastBackendPollAt < BACKEND_POLL_MS || WiFi.status() != WL_CONNECTED) return;
  lastBackendPollAt = now;

  HTTPClient http;
  http.setTimeout(1500);
  if (!http.begin(apiUrl("/api/hardware-alert"))) return;
  const int status = http.GET();
  if (status == HTTP_CODE_OK) {
    if (!backendReachable) Serial.println("Backend API connected.");
    backendReachable = true;
    lastBackendFailureStatus = 0;
    const String body = http.getString();
    const bool activeOnServer = body.indexOf("\"active\":true") >= 0;
    if (activeOnServer && !alertActive) beginAlert();
    if (!activeOnServer && alertActive && backendAlert) stopAlert();
  } else if (status < 0) {
    backendReachable = false;
    if (lastBackendFailureStatus != status) {
      Serial.printf("Backend poll failed for %s: %s\n", BACKEND_API_URL,
                    http.errorToString(status).c_str());
      lastBackendFailureStatus = status;
    }
  } else {
    backendReachable = false;
    if (lastBackendFailureStatus != status) {
      Serial.printf("Backend poll returned HTTP %d\n", status);
      lastBackendFailureStatus = status;
    }
  }
  http.end();
}

void maintainWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    wifiAttemptInProgress = false;
    if (!wasConnected) {
      wasConnected = true;
      backendReachable = false;
    }
    return;
  }
  if (wasConnected) {
    wasConnected = false;
    backendReachable = false;
    Serial.println("Wi-Fi disconnected; reconnecting...");
  }

  const uint32_t now = millis();
  if (wifiAttemptInProgress) {
    if (now - lastWiFiAttemptAt < WIFI_CONNECT_TIMEOUT_MS) return;
    Serial.println("Wi-Fi connection timed out; resetting before retrying.");
    WiFi.disconnect(false, false);
    wifiAttemptInProgress = false;
    lastWiFiAttemptAt = now;
    return;
  }
  if (now - lastWiFiAttemptAt < WIFI_RETRY_MS) return;
  connectWiFi();
}

void updateOutputs() {
  const uint32_t now = millis();
  if (!alertActive) {
    digitalWrite(ALERT_LED_PIN, LOW);
    digitalWrite(READY_LED_PIN, backendReachable ? HIGH : LOW);
    return;
  }
  digitalWrite(READY_LED_PIN, LOW);

  if (now - lastOutputStepAt >= OUTPUT_STEP_MS) {
    lastOutputStepAt = now;
    outputOn = !outputOn;
    digitalWrite(ALERT_LED_PIN, outputOn ? HIGH : LOW);
    setBuzzer(outputOn);
  }

  if (now - alertStartedAt >= ALERT_DURATION_MS) {
    acknowledgeBackendAlert();
    stopAlert();
  }
}
}  // namespace

void setup() {
  Serial.begin(115200);
  pinMode(READY_LED_PIN, OUTPUT);
  pinMode(ALERT_LED_PIN, OUTPUT);
  if (!ledcAttach(BUZZER_PIN, BUZZER_TONE_HZ, BUZZER_PWM_BITS)) {
    Serial.println("Could not initialize the buzzer PWM output.");
  }
  digitalWrite(READY_LED_PIN, LOW);
  digitalWrite(ALERT_LED_PIN, LOW);
  setBuzzer(false);
  WiFi.onEvent(logWiFiEvent);
  Serial.printf("Backend alert controller starting: %s\n", BACKEND_API_URL);
  connectWiFi();
}

void loop() {
  maintainWiFi();
  pollBackend();
  updateOutputs();
  delay(10);
}
