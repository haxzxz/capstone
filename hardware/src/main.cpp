#include <Arduino.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WiFi.h>

namespace {
struct DeviceConfig {
  String wifiSsid;
  String wifiPassword;
  String backendUrl;
  uint8_t alertLedPin = 17;
  uint8_t readyLedPin = 18;
  uint8_t buzzerPin = 36;
  uint16_t buzzerToneHz = 2200;
  uint32_t alertDurationMs = 5000;
  uint32_t outputStepMs = 250;
  uint32_t backendPollMs = 500;
  uint32_t wifiRetryMs = 10000;
};

Preferences preferences;
DeviceConfig config;
DeviceConfig pendingConfig;

bool editingConfig = false;
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

String apiUrl(const char *path) {
  return config.backendUrl + path;
}

void loadConfig() {
  config.wifiSsid = preferences.getString("ssid", "");
  config.wifiPassword = preferences.getString("password", "");
  config.backendUrl = preferences.getString("api", "");
  config.alertLedPin = preferences.getUChar("alertPin", 17);
  config.readyLedPin = preferences.getUChar("readyPin", 18);
  config.buzzerPin = preferences.getUChar("buzzerPin", 36);
  config.buzzerToneHz = preferences.getUShort("tone", 2200);
  config.alertDurationMs = preferences.getUInt("duration", 5000);
  config.outputStepMs = preferences.getUInt("step", 250);
  config.backendPollMs = preferences.getUInt("poll", 500);
  config.wifiRetryMs = preferences.getUInt("retry", 10000);
}

bool validOutputPin(uint8_t pin) {
  return pin > 0 && pin <= 48 && pin != 19 && pin != 20 && pin != 45 && pin != 46;
}

bool validConfig(const DeviceConfig &candidate) {
  const bool pinsAreValid = validOutputPin(candidate.alertLedPin)
      && validOutputPin(candidate.readyLedPin)
      && validOutputPin(candidate.buzzerPin)
      && candidate.alertLedPin != candidate.readyLedPin
      && candidate.alertLedPin != candidate.buzzerPin
      && candidate.readyLedPin != candidate.buzzerPin;
  const bool timingsAreValid = candidate.alertDurationMs >= 100
      && candidate.alertDurationMs <= 60000
      && candidate.outputStepMs >= 50
      && candidate.outputStepMs <= 5000
      && candidate.backendPollMs >= 250
      && candidate.backendPollMs <= 60000
      && candidate.wifiRetryMs >= 1000
      && candidate.wifiRetryMs <= 120000
      && candidate.buzzerToneHz >= 100
      && candidate.buzzerToneHz <= 5000;
  const bool apiIsValid = candidate.backendUrl.length() == 0
      || (candidate.backendUrl.startsWith("http://") && !candidate.backendUrl.endsWith("/"));
  return pinsAreValid && timingsAreValid && apiIsValid;
}

void configureOutputs(const DeviceConfig &previous) {
  const uint8_t oldPins[] = {previous.alertLedPin, previous.readyLedPin, previous.buzzerPin};
  const uint8_t newPins[] = {config.alertLedPin, config.readyLedPin, config.buzzerPin};
  for (uint8_t oldPin : oldPins) {
    bool stillUsed = false;
    for (uint8_t newPin : newPins) stillUsed |= oldPin == newPin;
    if (!stillUsed) {
      digitalWrite(oldPin, LOW);
      pinMode(oldPin, INPUT);
    }
  }
  pinMode(config.alertLedPin, OUTPUT);
  pinMode(config.readyLedPin, OUTPUT);
  pinMode(config.buzzerPin, OUTPUT);
  digitalWrite(config.alertLedPin, LOW);
  digitalWrite(config.readyLedPin, HIGH);
  noTone(config.buzzerPin);
}

void connectWiFi() {
  if (config.wifiSsid.length() == 0) {
    Serial.println("Wi-Fi is not configured. Connect from the dashboard over USB to set it.");
    return;
  }
  WiFi.disconnect(false, false);
  WiFi.mode(WIFI_STA);
  Serial.printf("Connecting to Wi-Fi: %s\n", config.wifiSsid.c_str());
  WiFi.begin(config.wifiSsid.c_str(), config.wifiPassword.c_str());
  lastWiFiAttemptAt = millis();
  wifiAttemptInProgress = true;
}

void logWiFiEvent(WiFiEvent_t event, WiFiEventInfo_t info) {
  if (event == ARDUINO_EVENT_WIFI_STA_DISCONNECTED) {
    Serial.printf("Wi-Fi disconnected; reason code: %u\n",
                  static_cast<unsigned>(info.wifi_sta_disconnected.reason));
    return;
  }
  if (event == ARDUINO_EVENT_WIFI_STA_GOT_IP) {
    Serial.printf("Wi-Fi connected; ESP32 IP: %s\n", WiFi.localIP().toString().c_str());
  }
}

void printConfig() {
  Serial.printf("CFG|wifi_ssid|%s\n", config.wifiSsid.c_str());
  Serial.printf("CFG|wifi_password_set|%s\n", config.wifiPassword.length() == 0 ? "false" : "true");
  Serial.printf("CFG|backend_url|%s\n", config.backendUrl.c_str());
  Serial.printf("CFG|alert_led_pin|%u\n", config.alertLedPin);
  Serial.printf("CFG|ready_led_pin|%u\n", config.readyLedPin);
  Serial.printf("CFG|buzzer_pin|%u\n", config.buzzerPin);
  Serial.printf("CFG|buzzer_tone_hz|%u\n", config.buzzerToneHz);
  Serial.printf("CFG|alert_duration_ms|%lu\n", static_cast<unsigned long>(config.alertDurationMs));
  Serial.printf("CFG|output_step_ms|%lu\n", static_cast<unsigned long>(config.outputStepMs));
  Serial.printf("CFG|backend_poll_ms|%lu\n", static_cast<unsigned long>(config.backendPollMs));
  Serial.printf("CFG|wifi_retry_ms|%lu\n", static_cast<unsigned long>(config.wifiRetryMs));
  Serial.println("END_CONFIG");
}

bool setPendingValue(const String &key, const String &value) {
  if (key == "wifi_ssid") pendingConfig.wifiSsid = value;
  else if (key == "wifi_password") pendingConfig.wifiPassword = value;
  else if (key == "backend_url") pendingConfig.backendUrl = value;
  else if (key == "alert_led_pin") pendingConfig.alertLedPin = static_cast<uint8_t>(value.toInt());
  else if (key == "ready_led_pin") pendingConfig.readyLedPin = static_cast<uint8_t>(value.toInt());
  else if (key == "buzzer_pin") pendingConfig.buzzerPin = static_cast<uint8_t>(value.toInt());
  else if (key == "buzzer_tone_hz") pendingConfig.buzzerToneHz = value.toInt();
  else if (key == "alert_duration_ms") pendingConfig.alertDurationMs = value.toInt();
  else if (key == "output_step_ms") pendingConfig.outputStepMs = value.toInt();
  else if (key == "backend_poll_ms") pendingConfig.backendPollMs = value.toInt();
  else if (key == "wifi_retry_ms") pendingConfig.wifiRetryMs = value.toInt();
  else return false;
  return true;
}

void commitConfig() {
  if (!validConfig(pendingConfig)) {
    editingConfig = false;
    Serial.println("ERR|invalid_config");
    return;
  }

  const DeviceConfig previous = config;
  const bool wifiChanged = config.wifiSsid != pendingConfig.wifiSsid
      || config.wifiPassword != pendingConfig.wifiPassword;
  config = pendingConfig;

  preferences.putString("ssid", config.wifiSsid);
  preferences.putString("password", config.wifiPassword);
  preferences.putString("api", config.backendUrl);
  preferences.putUChar("alertPin", config.alertLedPin);
  preferences.putUChar("readyPin", config.readyLedPin);
  preferences.putUChar("buzzerPin", config.buzzerPin);
  preferences.putUShort("tone", config.buzzerToneHz);
  preferences.putUInt("duration", config.alertDurationMs);
  preferences.putUInt("step", config.outputStepMs);
  preferences.putUInt("poll", config.backendPollMs);
  preferences.putUInt("retry", config.wifiRetryMs);

  configureOutputs(previous);
  editingConfig = false;
  Serial.println("OK|COMMIT");
  if (wifiChanged || WiFi.status() != WL_CONNECTED) connectWiFi();
}

void handleSerialCommand(String line) {
  if (line.endsWith("\r")) line.remove(line.length() - 1);
  if (line == "GET_CONFIG") {
    printConfig();
  } else if (line == "BEGIN") {
    pendingConfig = config;
    editingConfig = true;
    Serial.println("OK|BEGIN");
  } else if (line == "COMMIT" && editingConfig) {
    commitConfig();
  } else if (line == "CANCEL") {
    editingConfig = false;
    Serial.println("OK|CANCEL");
  } else if (line.startsWith("SET|") && editingConfig) {
    const int separator = line.indexOf('|', 4);
    if (separator < 0) {
      Serial.println("ERR|malformed_set");
      return;
    }
    const String key = line.substring(4, separator);
    const String value = line.substring(separator + 1);
    if (setPendingValue(key, value)) Serial.printf("OK|%s\n", key.c_str());
    else Serial.println("ERR|unknown_setting");
  } else {
    Serial.println("ERR|unknown_command");
  }
}

void pollSerialConfiguration() {
  if (Serial.available()) handleSerialCommand(Serial.readStringUntil('\n'));
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
  noTone(config.buzzerPin);
  digitalWrite(config.alertLedPin, LOW);
  digitalWrite(config.readyLedPin, HIGH);
  Serial.println("Alert sequence finished");
}

void acknowledgeBackendAlert() {
  if (!backendAlert || WiFi.status() != WL_CONNECTED || config.backendUrl.length() == 0) return;
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
  if (config.backendUrl.length() == 0 || now - lastBackendPollAt < config.backendPollMs
      || WiFi.status() != WL_CONNECTED) return;
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
      Serial.printf("Backend poll failed for %s: %s\n", config.backendUrl.c_str(), http.errorToString(status).c_str());
      lastBackendFailureStatus = status;
    }
  } else {
    backendReachable = false;
    if (lastBackendFailureStatus != status) {
      Serial.printf("Backend poll for %s returned HTTP %d\n", config.backendUrl.c_str(), status);
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
  // ESP32 can remain in its connecting state beyond the retry interval. Calling
  // WiFi.begin() again in that state causes "sta is connecting, cannot set config".
  if (wifiAttemptInProgress) {
    constexpr uint32_t WIFI_CONNECT_TIMEOUT_MS = 30000;
    if (now - lastWiFiAttemptAt < WIFI_CONNECT_TIMEOUT_MS) return;
    Serial.println("Wi-Fi connection timed out; resetting the station before retrying.");
    WiFi.disconnect(false, false);
    wifiAttemptInProgress = false;
    lastWiFiAttemptAt = now;
    return;
  }
  if (config.wifiSsid.length() == 0 || now - lastWiFiAttemptAt < config.wifiRetryMs) return;
  lastWiFiAttemptAt = now;
  Serial.println("Retrying Wi-Fi connection...");
  WiFi.begin(config.wifiSsid.c_str(), config.wifiPassword.c_str());
  wifiAttemptInProgress = true;
}

void updateOutputs() {
  const uint32_t now = millis();
  if (!alertActive) {
    digitalWrite(config.alertLedPin, LOW);
    digitalWrite(config.readyLedPin, HIGH);
    return;
  }
  digitalWrite(config.readyLedPin, LOW);

  if (now - lastOutputStepAt >= config.outputStepMs) {
    lastOutputStepAt = now;
    outputOn = !outputOn;
    digitalWrite(config.alertLedPin, outputOn ? HIGH : LOW);
    if (outputOn) tone(config.buzzerPin, config.buzzerToneHz);
    else noTone(config.buzzerPin);
  }

  if (now - alertStartedAt >= config.alertDurationMs) {
    acknowledgeBackendAlert();
    stopAlert();
  }
}
}  // namespace

void setup() {
  Serial.begin(115200);
  Serial.setTimeout(100);
  preferences.begin("schoolzone", false);
  loadConfig();
  configureOutputs(config);
  WiFi.onEvent(logWiFiEvent);
  WiFi.mode(WIFI_STA);
  Serial.println("Ready for dashboard configuration over USB.");
  connectWiFi();
}

void loop() {
  pollSerialConfiguration();
  maintainWiFi();
  pollBackend();
  updateOutputs();
  delay(10);
}
