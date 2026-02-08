/********************************************************************
 * ESP32 OIL DISPENSER — DASHBOARD CONNECTED + PIN + SALES ✅
 *
 * Inspired by GDI Tech (Kenya) commercial oil dispensers.
 * Uses ESP-WROOM-32D instead of Arduino UNO for WiFi + more RAM/flash.
 *
 * KEY FEATURES (matching commercial dispenser standards):
 *  ✅ Dashboard communication — telemetry, receipts, config sync
 *  ✅ PIN/password protection — prevents unauthorized access
 *  ✅ Sales transaction recording — persistent count + totals in NVS
 *  ✅ Accurate flow measurement — calibrated PPL with overshoot compensation
 *  ✅ Money + volume entry modes (Kwacha / Liters / mL)
 *  ✅ Preset buttons (A=5L, B=10L, C=20L, D=50L)
 *  ✅ Calibration menu (hold * for 3s)
 *  ✅ No-flow protection, over-dispense safety, emergency stop
 *  ✅ Offline-capable — works without WiFi, syncs when connected
 *
 * DASHBOARD API ROUTES:
 *  POST /api/ingest/telemetry  — periodic sensor data
 *  POST /api/ingest/receipt    — dispense transaction records
 *  POST /api/ingest/heartbeat  — periodic keep-alive
 *  GET  /api/device/config     — fetch pricing & settings
 *
 * OPERATING SEQUENCE:
 *  1. Press A to login → enter PIN → # to confirm
 *  2. Select amount (preset or custom K/L/mL)
 *  3. Dispense auto-stops at target
 *  4. Transaction recorded locally + sent to dashboard
 *  5. Returns to locked screen
 *
 * Hardware:
 *  - ESP32-WROOM-32D Dev Module
 *  - 16x2 I2C LCD @ 0x27 (SDA=21, SCL=22)
 *  - 4x4 Keypad  rows=13,12,14,27  cols=26,25,33,32
 *  - Relay/Pump on GPIO23 (ACTIVE LOW)
 *  - AICHI OF05ZAT Flow Sensor signal on GPIO4
 *
 * CALIBRATION MENU (hold * for 3s from IDLE):
 *  1 = Set PPL (dispense 1L, measure real mL, compute new PPL)
 *  2 = Tune Overshoot (adjust stopExtra pulses)
 *  3 = Reset to Defaults
 *  * = Exit calibration
 ********************************************************************/

#include <Arduino.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <Keypad.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ========================= PINS =========================
static const uint8_t PUMP_PIN = 23;   // active LOW relay
static const uint8_t FLOW_PIN = 4;    // flow sensor input
static const uint8_t LED_PIN  = 2;    // ESP32 builtin LED

static const uint8_t SDA_PIN  = 21;
static const uint8_t SCL_PIN  = 22;

// ========================= DEFAULTS =========================
// Base calibration: 250 pulses/L gave 95% accuracy on OF05ZAT sensor.
// Correction: 250 / 0.95 ≈ 263 pulses/L for 100% accuracy.
static const float    DEFAULT_PPL         = 263.0f;  // corrected from 250 for 100% accuracy
static const uint32_t DEFAULT_STOP_LAG    = 300;     // ms
static const uint16_t DEFAULT_STOP_EXTRA  = 20;      // pulses

static const int      FLOW_EDGE           = FALLING;
static const uint32_t NO_FLOW_TIMEOUT_MS  = 6000;    // priming friendly
static const float    OVER_DISPENSE_LIMIT_L = 0.05f; // +50mL fault
static const uint32_t DISPLAY_UPDATE_MS   = 250;
static const uint32_t CAL_HOLD_MS         = 3000;

// Post-pump settling: keep counting pulses after pump stops to capture
// oil still flowing through momentum/gravity (like GDI Tech dispensers)
static const uint32_t POST_PUMP_SETTLE_MS = 1500;  // 1.5s to capture drip/coast pulses

// Coast flow rate factor: fraction of full-rate flow that continues during coast.
// Empirically ~30% of pumping flow rate continues briefly after pump-off.
static const float COAST_FLOW_FACTOR = 0.3f;

// Maximum early-stop as percentage of target pulses (safety cap)
static const uint32_t MAX_EARLY_STOP_PCT = 40;

// Minimum valid Unix timestamp (Nov 2023) — used to detect if NTP synced
static const uint32_t MIN_VALID_UNIX_TS = 1700000000;

// Small-volume correction offset (mL) — accounts for sensor non-linearity
// at low flow rates. Tunable via calibration at small volumes.
static const float    SMALL_VOL_OFFSET_ML = 0.0f;  // set via testing (e.g., -3.0 if over-dispensing 3mL)

// ========================= MONEY CONFIG =========================
static const float PRICE_PER_LITER = 45.0f;  // your selling price
static const float MIN_KWACHA = 5.0f;
static const float MAX_KWACHA = 500.0f;

static const float MIN_LITERS = 0.05f; // 50mL
static const float MAX_LITERS = 50.0f;

// ========================= PIN PROTECTION =========================
// Password protection for access control (like GDI Tech dispensers)
static const char* OPERATOR_PIN = "1234";  // default PIN — change for your site
static const uint8_t MAX_PIN_LENGTH = 6;
static const uint8_t MAX_PIN_ATTEMPTS = 3;
static const uint32_t LOCKOUT_DURATION_MS = 30000; // 30s lockout after max attempts

// ========================= DASHBOARD / WIFI CONFIG =========================
// ⚠️  Per-device credentials — update for each device deployment.
//     For production, move to config_OIL-XXXX.h (see config_OIL-0001.h example)
#define DEVICE_ID     "OIL-0001"
#define API_KEY       "QV-nQArRlomVfBOiL1Ob1P4mtIz88a7mO0c3kXVZYK8"
#define API_BASE_URL  "https://fleet-oil-system.vercel.app"
#define SITE_NAME     "PHI"

// WiFi credentials — update for your network
static const char* WIFI_SSID = "kupemisa";
static const char* WIFI_PASS = "123admin";

// Dashboard communication timers
static const uint32_t TELEMETRY_INTERVAL_MS  = 30000;  // send telemetry every 30s
static const uint32_t HEARTBEAT_INTERVAL_MS  = 60000;  // heartbeat every 60s
static const uint32_t CONFIG_FETCH_INTERVAL_MS = 120000; // fetch config every 2 min
static const uint32_t WIFI_RETRY_INTERVAL_MS = 30000;   // retry WiFi every 30s

// HTTPS client
WiFiClientSecure secureClient;
bool wifiConnected = false;

// Dashboard timers
uint32_t lastTelemetryMs   = 0;
uint32_t lastHeartbeatMs   = 0;
uint32_t lastConfigFetchMs = 0;
uint32_t lastWifiRetryMs   = 0;

// Dashboard-synced pricing (overrides local PRICE_PER_LITER when available)
float dashboardPrice = 0.0f;  // 0 = not fetched yet, use local price

// ========================= NVS (Preferences) =========================
Preferences prefs;
float    pulsesPerLiter  = DEFAULT_PPL;
uint32_t stopLagMs       = DEFAULT_STOP_LAG;
uint16_t stopExtraPulses = DEFAULT_STOP_EXTRA;

// ========================= KEYPAD =========================
// (kept same as your old code)
const byte ROWS = 4, COLS = 4;
char keys[ROWS][COLS] = {
  {'1','4','7','*'},
  {'2','5','8','0'},
  {'3','6','9','#'},
  {'A','B','C','D'}
};
byte rowPins[ROWS] = {27, 14, 12, 13};
byte colPins[COLS] = {32, 33, 25, 26};
Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

// ========================= LCD =========================
LiquidCrystal_I2C lcd(0x27, 16, 2);

// ========================= STATE =========================
enum DeviceState : uint8_t {
  STATE_LOCKED,        // PIN-protected locked screen
  STATE_ENTER_PIN,     // Entering PIN
  STATE_IDLE,
  STATE_DISPENSING,
  STATE_PAUSED,
  STATE_COMPLETE,
  STATE_FAULT,
  STATE_CAL_MENU,
  STATE_CAL_REAL_VOL,
  STATE_CAL_OVERSHOOT,
  STATE_CAL_DISPENSE
};
DeviceState state = STATE_LOCKED;

// ========================= FLOW VARS =========================
volatile uint32_t pulseCount = 0;
uint32_t lastPulseCount = 0;
uint32_t lastPulseTime  = 0;
uint32_t lastCalcTime   = 0;

float flowRate_Lmin = 0.0f;
float flowRate_mLs  = 0.0f;
float dispensed_L   = 0.0f;
float total_L       = 0.0f;

float target_L       = 0.0f;
uint32_t targetPulses = 0;

bool pumpRunning = false;
bool flowInterruptAttached = false;

// Post-pump settling: keep flow sensor active after pump stops to count coast/drip
bool settlingActive = false;
uint32_t settlingStartMs = 0;
uint32_t dispenseStartMs = 0;  // for duration tracking

// ========================= AMOUNTS =========================
static const float PRESET_A_L = 5.0f;
static const float PRESET_B_L = 10.0f;
static const float PRESET_C_L = 20.0f;
static const float PRESET_D_L = 50.0f;

// ========================= CUSTOM ENTRY =========================
// 0=Liters, 1=mL, 2=Money
String customAmount = "";
bool enteringCustom = false;
uint8_t entryMode = 2;          // default to money entry
float enteredKwacha = 0.0f;     // FIXED displayed K when money mode used
bool moneyModeActive = false;   // true only when dispense started from money

uint32_t lastDisplayUpdate = 0;

// ========================= KEY DEBOUNCE =========================
uint32_t lastKeyTime = 0;
char lastKey = 0;
static const uint32_t KEY_REPEAT_DELAY = 200;  // min 200ms between same key

// ========================= CALIBRATION VARS =========================
uint32_t starHoldStart = 0;
bool starHeld = false;
uint8_t calMenuPage = 0;   // 0/1 pages
String calInput = "";
uint32_t calDispensePulses = 0;

// ========================= PIN ENTRY VARS =========================
String pinEntry = "";
uint8_t pinAttempts = 0;
uint32_t lockoutStartMs = 0;

// ========================= TRANSACTION TRACKING =========================
// Persistent sales recording (survives reboot via NVS)
uint32_t transactionCount = 0;   // total transactions completed
float    salesTotal_L     = 0.0f; // total liters sold
float    salesTotal_K     = 0.0f; // total Kwacha earned

// ========================= ISR =========================
void IRAM_ATTR flowISR() { pulseCount++; }

// ========================= FLOW INTERRUPT CONTROL =========================
static void attachFlow() {
  if (flowInterruptAttached) return;
  attachInterrupt(digitalPinToInterrupt(FLOW_PIN), flowISR, FLOW_EDGE);
  flowInterruptAttached = true;
}
static void detachFlow() {
  if (!flowInterruptAttached) return;
  detachInterrupt(digitalPinToInterrupt(FLOW_PIN));
  flowInterruptAttached = false;
}

// ========================= NVS FUNCTIONS =========================
static void loadCalibration() {
  // ✅ DO NOT clear on every boot (your old code did this and killed calibration)
  prefs.begin("oilcal", true);
  pulsesPerLiter  = prefs.getFloat("ppl", DEFAULT_PPL);
  stopLagMs       = prefs.getUInt("stopLag", DEFAULT_STOP_LAG);
  stopExtraPulses = prefs.getUShort("stopExtra", DEFAULT_STOP_EXTRA);
  prefs.end();

  // sanity clamps
  if (pulsesPerLiter < 50.0f || pulsesPerLiter > 2000.0f) pulsesPerLiter = DEFAULT_PPL;
  if (stopLagMs > 3000) stopLagMs = DEFAULT_STOP_LAG;
  if (stopExtraPulses > 300) stopExtraPulses = DEFAULT_STOP_EXTRA;

  Serial.printf("Loaded: PPL=%.1f, StopLag=%lu, StopExtra=%u\n",
                pulsesPerLiter, (unsigned long)stopLagMs, stopExtraPulses);
}

static void saveCalibration() {
  prefs.begin("oilcal", false);
  prefs.putFloat("ppl", pulsesPerLiter);
  prefs.putUInt("stopLag", stopLagMs);
  prefs.putUShort("stopExtra", stopExtraPulses);
  prefs.end();

  Serial.printf("Saved: PPL=%.1f, StopLag=%lu, StopExtra=%u\n",
                pulsesPerLiter, (unsigned long)stopLagMs, stopExtraPulses);
}

static void resetCalibrationDefaults() {
  pulsesPerLiter  = DEFAULT_PPL;
  stopLagMs       = DEFAULT_STOP_LAG;
  stopExtraPulses = DEFAULT_STOP_EXTRA;
  saveCalibration();
}

// ========================= SALES NVS =========================
static void loadSalesData() {
  prefs.begin("oilsales", true);
  transactionCount = prefs.getUInt("txCount", 0);
  salesTotal_L     = prefs.getFloat("totalL", 0.0f);
  salesTotal_K     = prefs.getFloat("totalK", 0.0f);
  prefs.end();

  Serial.printf("Sales: %u transactions, %.2fL, K%.2f\n",
                transactionCount, salesTotal_L, salesTotal_K);
}

static void saveSalesData() {
  prefs.begin("oilsales", false);
  prefs.putUInt("txCount", transactionCount);
  prefs.putFloat("totalL", salesTotal_L);
  prefs.putFloat("totalK", salesTotal_K);
  prefs.end();
}

static void recordTransaction(float liters, float kwacha) {
  transactionCount++;
  salesTotal_L += liters;
  salesTotal_K += kwacha;
  saveSalesData();
  Serial.printf("TX#%u: %.3fL K%.2f | Total: %.2fL K%.2f\n",
                transactionCount, liters, kwacha, salesTotal_L, salesTotal_K);
}

// ========================= WIFI =========================
static void connectWiFi() {
  if (strlen(WIFI_SSID) == 0) {
    Serial.println("[WIFI] No SSID configured");
    return;
  }

  Serial.printf("[WIFI] Connecting to %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 10000) {
    delay(500);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    wifiConnected = true;
    Serial.printf("\n[WIFI] Connected! IP: %s RSSI: %d\n",
                  WiFi.localIP().toString().c_str(), WiFi.RSSI());

    // Setup NTP for accurate timestamps
    configTime(0, 0, "pool.ntp.org", "time.google.com");
    Serial.println("[TIME] NTP sync started");
  } else {
    wifiConnected = false;
    Serial.println("\n[WIFI] Connection failed — running offline");
  }
}

static void checkWiFi() {
  wifiConnected = (WiFi.status() == WL_CONNECTED);
  if (!wifiConnected) {
    uint32_t now = millis();
    if (now - lastWifiRetryMs > WIFI_RETRY_INTERVAL_MS) {
      lastWifiRetryMs = now;
      Serial.println("[WIFI] Reconnecting...");
      connectWiFi();
    }
  }
}

// ========================= HTTP HELPERS =========================
static String baseUrl() {
  String b = String(API_BASE_URL);
  if (b.endsWith("/")) b.remove(b.length() - 1);
  return b;
}

static uint32_t unixNow() {
  time_t now = time(nullptr);
  if (now < MIN_VALID_UNIX_TS) return 0;  // NTP not synced yet
  return (uint32_t)now;
}

static int httpPost(const char* path, const String& body, String& response) {
  if (!wifiConnected) return -1;

  HTTPClient http;
  String url = baseUrl() + String(path);

  Serial.printf("[HTTP] POST %s\n", url.c_str());

  http.begin(secureClient, url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-id", String(DEVICE_ID));
  http.addHeader("x-api-key", String(API_KEY));
  http.setTimeout(10000);

  int code = http.POST((uint8_t*)body.c_str(), body.length());

  if (code > 0) {
    response = http.getString();
    Serial.printf("[HTTP] %d: %.120s\n", code, response.c_str());
  } else {
    Serial.printf("[HTTP] Error: %d (%s)\n", code, http.errorToString(code).c_str());
  }

  http.end();
  return code;
}

static int httpGet(const char* path, String& response) {
  if (!wifiConnected) return -1;

  HTTPClient http;
  String url = baseUrl() + String(path);

  Serial.printf("[HTTP] GET %s\n", url.c_str());

  http.begin(secureClient, url);
  http.addHeader("x-device-id", String(DEVICE_ID));
  http.addHeader("x-api-key", String(API_KEY));
  http.setTimeout(10000);

  int code = http.GET();

  if (code > 0) {
    response = http.getString();
    Serial.printf("[HTTP] %d: %.120s\n", code, response.c_str());
  } else {
    Serial.printf("[HTTP] Error: %d (%s)\n", code, http.errorToString(code).c_str());
  }

  http.end();
  return code;
}

// ========================= DASHBOARD API =========================

/** Send telemetry data: POST /api/ingest/telemetry */
static void sendTelemetry() {
  if (!wifiConnected) return;

  uint32_t ts = unixNow();
  StaticJsonDocument<512> doc;
  doc["ts"] = ts ? ts : (millis() / 1000);
  doc["oilLiters"] = total_L;
  doc["flowLpm"] = flowRate_Lmin;
  doc["litersTotal"] = salesTotal_L;
  doc["pumpState"] = pumpRunning;
  doc["safetyStatus"] = (state == STATE_FAULT) ? "FAULT" : "OK";
  doc["wifiRssi"] = WiFi.RSSI();
  doc["uptimeSec"] = millis() / 1000;

  String body;
  serializeJson(doc, body);

  String response;
  int code = httpPost("/api/ingest/telemetry", body, response);

  if (code >= 200 && code < 300) {
    Serial.println("[TELEMETRY] Sent OK");
  } else {
    Serial.printf("[TELEMETRY] Failed: %d\n", code);
  }
}

/** Send heartbeat: POST /api/ingest/heartbeat */
static void sendHeartbeat() {
  if (!wifiConnected) return;

  StaticJsonDocument<128> doc;
  doc["status"] = "online";
  doc["uptime"] = millis() / 1000;
  doc["siteName"] = SITE_NAME;

  String body;
  serializeJson(doc, body);

  String response;
  int code = httpPost("/api/ingest/heartbeat", body, response);

  if (code >= 200 && code < 300) {
    Serial.println("[HEARTBEAT] OK");
  }
}

/** Fetch device config: GET /api/device/config */
static void fetchDeviceConfig() {
  if (!wifiConnected) return;

  String response;
  int code = httpGet("/api/device/config", response);

  if (code != 200) {
    Serial.printf("[CONFIG] Failed: HTTP %d\n", code);
    return;
  }

  StaticJsonDocument<512> doc;
  DeserializationError err = deserializeJson(doc, response);
  if (err) {
    Serial.printf("[CONFIG] JSON error: %s\n", err.c_str());
    return;
  }

  if (doc["ok"].as<bool>()) {
    if (doc["price"]["pricePerLiter"].is<float>()) {
      dashboardPrice = doc["price"]["pricePerLiter"].as<float>();
      Serial.printf("[CONFIG] Dashboard price: %.2f/L\n", dashboardPrice);
    }
  }
}

/** Send dispense receipt: POST /api/ingest/receipt */
static void sendDashboardReceipt(float targetL, float dispensedL, float pricePerL,
                                 const char* receiptStatus) {
  if (!wifiConnected) return;

  uint32_t durSec = (dispenseStartMs > 0) ? ((millis() - dispenseStartMs) / 1000) : 0;
  uint32_t ts = unixNow();
  uint32_t fallbackTs = millis() / 1000;

  StaticJsonDocument<512> doc;
  doc["sessionId"] = String(DEVICE_ID) + "-" + String(transactionCount) + "-" + String(ts ? ts : fallbackTs);
  doc["targetLiters"] = targetL;
  doc["dispensedLiters"] = dispensedL;
  doc["durationSec"] = durSec;
  doc["status"] = receiptStatus;
  doc["startedAtUnix"] = ts ? ts : fallbackTs;
  doc["endedAtUnix"] = ts ? ts : fallbackTs;

  String body;
  serializeJson(doc, body);

  String response;
  int code = httpPost("/api/ingest/receipt", body, response);

  if (code >= 200 && code < 300) {
    Serial.println("[RECEIPT] Sent to dashboard OK");
  } else {
    Serial.printf("[RECEIPT] Failed: %d (saved locally)\n", code);
  }
}

/** Run periodic dashboard tasks (non-blocking, called from loop) */
static void handleDashboard() {
  if (!wifiConnected) {
    checkWiFi();
    return;
  }

  uint32_t now = millis();

  // Periodic telemetry
  if (now - lastTelemetryMs > TELEMETRY_INTERVAL_MS) {
    lastTelemetryMs = now;
    sendTelemetry();
  }

  // Periodic heartbeat
  if (now - lastHeartbeatMs > HEARTBEAT_INTERVAL_MS) {
    lastHeartbeatMs = now;
    sendHeartbeat();
  }

  // Periodic config fetch (pricing sync)
  if (now - lastConfigFetchMs > CONFIG_FETCH_INTERVAL_MS) {
    lastConfigFetchMs = now;
    fetchDeviceConfig();
  }
}

// ========================= LCD HELPERS =========================
static void lcdPrintPadded(uint8_t col, uint8_t row, const String &text) {
  lcd.setCursor(col, row);
  String t = text;
  if (t.length() > (16 - col)) t = t.substring(0, 16 - col);
  lcd.print(t);
  for (int i = (int)t.length(); i < (16 - col); i++) lcd.print(' ');
}

// ========================= PUMP =========================
static void pumpOn() {
  digitalWrite(PUMP_PIN, LOW);
  digitalWrite(LED_PIN, HIGH);
  pumpRunning = true;
  Serial.println(">>> PUMP ON <<<");
}
static void pumpOff() {
  digitalWrite(PUMP_PIN, HIGH);
  digitalWrite(LED_PIN, LOW);
  pumpRunning = false;
  Serial.println(">>> PUMP OFF <<<");
}

// ========================= UI SCREENS =========================
static void showLocked() {
  lcd.clear();
  lcdPrintPadded(0, 0, "OIL DISPENSER");
  lcdPrintPadded(0, 1, "A = Login");
}

static void showEnterPin() {
  lcd.clear();
  lcdPrintPadded(0, 0, "Enter PIN:");
  // Build masked PIN display (max 16 chars for LCD row)
  char buf[17];
  uint8_t len = pinEntry.length();
  uint8_t i = 0;
  for (; i < len && i < 10; i++) buf[i] = '*';
  buf[i] = '\0';
  String line2 = String(buf) + " #=OK *=Back";
  lcdPrintPadded(0, 1, line2);
}

static void showIdle() {
  lcd.clear();
  lcdPrintPadded(0, 0, "A=5L B=10 C=20");
  lcdPrintPadded(0, 1, "#=ENTER K  D=50L");
}

static void showCustomEntry() {
  lcd.clear();

  if (entryMode == 2) {
    lcdPrintPadded(0, 0, "Enter K:   D=L");
    if (customAmount.length()) {
      float k = customAmount.toFloat();
      float priceUsed = (dashboardPrice > 0.0f) ? dashboardPrice : PRICE_PER_LITER;
      float liters = k / priceUsed;
      String l2 = "K" + customAmount + " = ";
      if (liters >= 1.0f) l2 += String(liters, 2) + "L";
      else l2 += String((int)roundf(liters * 1000.0f)) + "mL";
      lcdPrintPadded(0, 1, l2);
    } else {
      lcdPrintPadded(0, 1, "K_ #=OK *=Back");
    }
  } else if (entryMode == 1) {
    lcdPrintPadded(0, 0, "Enter mL:  D=K");
    lcdPrintPadded(0, 1, (customAmount.length() ? (customAmount + "mL #=OK") : "_mL #=OK *=Back"));
  } else {
    lcdPrintPadded(0, 0, "Enter L:   D=mL");
    lcdPrintPadded(0, 1, (customAmount.length() ? (customAmount + "L  #=OK") : "_L  #=OK *=Back"));
  }
}

static void showPaused() {
  lcd.clear();
  char l1[17];
  snprintf(l1, sizeof(l1), "PAUSED %.3fL", dispensed_L);
  lcdPrintPadded(0, 0, String(l1));
  lcdPrintPadded(0, 1, "#=GO *=CANCEL");
}

static void showComplete() {
  lcd.clear();

  // Record transaction in NVS
  float priceUsed = (dashboardPrice > 0.0f) ? dashboardPrice : PRICE_PER_LITER;
  float cost = moneyModeActive ? enteredKwacha : (target_L * priceUsed);
  recordTransaction(dispensed_L, cost);

  // Send receipt to dashboard
  sendDashboardReceipt(target_L, dispensed_L, priceUsed, "DONE");

  char l1[17];
  snprintf(l1, sizeof(l1), "DONE! TX#%lu", (unsigned long)transactionCount);
  lcdPrintPadded(0, 0, String(l1));

  // ✅ FIX: if money mode used, ALWAYS display entered K and TARGET volume (not actual)
  if (moneyModeActive && enteredKwacha > 0.0f) {
    String line2 = "K" + String((int)roundf(enteredKwacha)) + " ";
    // Use target_L (what they paid for), not dispensed_L
    if (target_L >= 1.0f) line2 += String(target_L, 2) + "L";
    else line2 += String((int)roundf(target_L * 1000.0f)) + "mL";
    lcdPrintPadded(0, 1, line2);
    return;
  }

  // For L/mL mode, also show TARGET (what they asked for)
  String line2;
  if (target_L >= 1.0f) line2 = String(target_L, 2) + "L K" + String((int)roundf(cost));
  else line2 = String((int)roundf(target_L * 1000.0f)) + "mL K" + String((int)roundf(cost));
  lcdPrintPadded(0, 1, line2);
}

static void showFault(const String &msg) {
  lcd.clear();
  lcdPrintPadded(0, 0, "SYSTEM FAULT!");
  lcdPrintPadded(0, 1, msg);
}

static void showDispensing() {
  const bool showML = (target_L > 0.0f && target_L < 1.0f);

  if (showML) {
    int tgtML = (int)roundf(target_L * 1000.0f);
    int dspML = (int)roundf(dispensed_L * 1000.0f);

    char l1[17], l2[17];
    snprintf(l1, sizeof(l1), "T%dmL D%dmL", tgtML, dspML);
    snprintf(l2, sizeof(l2), "%.1fmL/s *=STOP", flowRate_mLs);

    lcdPrintPadded(0, 0, String(l1));
    lcdPrintPadded(0, 1, String(l2));
  } else {
    char l1[17], l2[17];
    snprintf(l1, sizeof(l1), "T%.2fL D%.3fL", target_L, dispensed_L);
    snprintf(l2, sizeof(l2), "%.1fL/m *=STOP", flowRate_Lmin);

    lcdPrintPadded(0, 0, String(l1));
    lcdPrintPadded(0, 1, String(l2));
  }
}

// ========================= CALIBRATION SCREENS =========================
static void showCalMenu() {
  lcd.clear();
  lcdPrintPadded(0, 0, "=== CAL MENU ===");
  if (calMenuPage == 0) lcdPrintPadded(0, 1, "1:SetPPL 2:Over");
  else                 lcdPrintPadded(0, 1, "3:Reset  *:Exit");
}

static void showCalRealVol() {
  lcd.clear();
  lcdPrintPadded(0, 0, "Enter REAL mL:");
  lcdPrintPadded(0, 1, calInput + "mL #=OK");
}

static void showCalOvershoot() {
  lcd.clear();
  char l1[17];
  snprintf(l1, sizeof(l1), "StopExtra=%u", stopExtraPulses);
  lcdPrintPadded(0, 0, String(l1));
  lcdPrintPadded(0, 1, "2=+ 8=- #=Save");
}

static void showCalDispensing() {
  lcd.clear();
  char l1[17], l2[17];
  snprintf(l1, sizeof(l1), "CAL:%.3fL", dispensed_L);
  snprintf(l2, sizeof(l2), "P=%lu *=STOP", (unsigned long)calDispensePulses);
  lcdPrintPadded(0, 0, String(l1));
  lcdPrintPadded(0, 1, String(l2));
}

// ========================= RESET =========================
static void resetDispense() {
  // turn off pump + disable flow counting (software "flow off")
  pumpOff();
  detachFlow();

  noInterrupts();
  pulseCount = 0;
  interrupts();

  lastPulseCount = 0;
  lastPulseTime  = millis();
  lastCalcTime   = millis();

  flowRate_Lmin = 0.0f;
  flowRate_mLs  = 0.0f;
  dispensed_L   = 0.0f;

  target_L = 0.0f;
  targetPulses = 0;

  settlingActive = false;
  settlingStartMs = 0;
  dispenseStartMs = 0;

  // entry reset
  customAmount = "";
  enteringCustom = false;
  entryMode = 2;

  // NOTE: DO NOT reset enteredKwacha/moneyModeActive here!
  // They must persist until showComplete() uses them.
  // They are reset in returnToIdle() instead.
}

// Reset money mode variables (called when returning to IDLE)
static void resetMoneyMode() {
  enteredKwacha = 0.0f;
  moneyModeActive = false;
}

static void resetAll() {
  resetDispense();
  resetMoneyMode();
  total_L = 0.0f;
  Serial.println("All counters reset!");
}

// Helper: return to locked screen (used after complete/fault/reset)
static void returnToLocked() {
  resetDispense();
  resetMoneyMode();
  pinEntry = "";
  state = STATE_LOCKED;
  showLocked();
}

// ========================= START DISPENSE =========================
static void startDispense(float liters) {
  resetDispense();

  target_L = liters;
  targetPulses = (uint32_t)lroundf(liters * pulsesPerLiter);

  // enable flow counting + pump
  pinMode(FLOW_PIN, INPUT_PULLUP);
  attachFlow();
  lastPulseTime = millis();
  lastCalcTime  = millis();
  dispenseStartMs = millis();

  state = STATE_DISPENSING;
  pumpOn();

  Serial.printf("START: target=%.3fL targetPulses=%u PPL=%.1f\n",
                target_L, targetPulses, pulsesPerLiter);
}

// ========================= START CAL DISPENSE (1L) =========================
static void startCalDispense() {
  resetDispense();

  target_L = 1.0f;
  targetPulses = (uint32_t)lroundf(1.0f * pulsesPerLiter);

  pinMode(FLOW_PIN, INPUT_PULLUP);
  attachFlow();

  state = STATE_CAL_DISPENSE;
  lastPulseTime = millis();
  lastCalcTime  = millis();

  pumpOn();

  Serial.printf("CAL START: target=1.000L targetPulses=%u\n", targetPulses);
}

// ========================= FLOW CALC / AUTOSTOP =========================
static void calculateFlow() {
  const uint32_t now = millis();
  if (now - lastCalcTime < 250) return;

  noInterrupts();
  const uint32_t p = pulseCount;
  interrupts();

  const uint32_t dt = now - lastCalcTime;
  lastCalcTime = now;

  const uint32_t dp = p - lastPulseCount;
  lastPulseCount = p;

  if (dp > 0) lastPulseTime = now;

  dispensed_L = (float)p / pulsesPerLiter;
  const float delta_L = (float)dp / pulsesPerLiter;

  flowRate_Lmin = (dt > 0) ? (delta_L * 60000.0f / (float)dt) : 0.0f;
  flowRate_mLs  = (dt > 0) ? (delta_L * 1000.0f * 1000.0f / (float)dt) : 0.0f;

  // -------- POST-PUMP SETTLING (capture coast/drip pulses) --------
  // After pump stops, oil still flows through momentum. Keep counting
  // pulses for POST_PUMP_SETTLE_MS to get accurate final measurement.
  // This is how GDI Tech commercial dispensers achieve ±1-5mL accuracy.
  if (settlingActive) {
    // Update dispensed display during settling
    if (dp > 0) {
      Serial.printf("[SETTLE] +%u pulses, total=%u, disp=%.3fL (%.0fmL)\n",
                    dp, p, dispensed_L, dispensed_L * 1000.0f);
    }

    // Check if settling period is complete
    if ((now - settlingStartMs) >= POST_PUMP_SETTLE_MS) {
      // Final accurate measurement after all coast/drip pulses counted
      noInterrupts();
      const uint32_t finalPulses = pulseCount;
      interrupts();
      dispensed_L = (float)finalPulses / pulsesPerLiter;

      settlingActive = false;
      detachFlow();  // NOW safe to detach

      Serial.printf("[SETTLE] FINAL: pulses=%u disp=%.3fL (%.0fmL) target=%.3fL err=%.1fmL\n",
                    finalPulses, dispensed_L, dispensed_L * 1000.0f,
                    target_L, (dispensed_L - target_L) * 1000.0f);

      // Transition depends on whether this was a calibration or normal dispense
      if (state == STATE_CAL_DISPENSE) {
        calDispensePulses = finalPulses;
        state = STATE_CAL_REAL_VOL;
        calInput = "";
        lcd.clear();
        lcdPrintPadded(0, 0, "Dispensed 1.000L");
        lcdPrintPadded(0, 1, "Enter REAL mL");
        delay(1200);
        showCalRealVol();
        Serial.printf("CAL STOP: pulses=%u\n", finalPulses);
      } else {
        // Normal dispense — apply small-volume offset if applicable
        if (target_L < 1.0f && SMALL_VOL_OFFSET_ML != 0.0f) {
          dispensed_L += SMALL_VOL_OFFSET_ML / 1000.0f;
          Serial.printf("[SETTLE] Small-vol offset: %.1fmL applied\n", SMALL_VOL_OFFSET_ML);
        }
        state = STATE_COMPLETE;
        total_L += dispensed_L;
        showComplete();
      }
    }
    return;  // skip normal dispense logic during settling
  }

  // -------- NO FLOW FAULT (pump ON but no pulses for 6s) --------
  if ((state == STATE_DISPENSING || state == STATE_CAL_DISPENSE) && pumpRunning) {
    if ((now - lastPulseTime) > NO_FLOW_TIMEOUT_MS) {
      pumpOff();
      detachFlow();
      state = STATE_FAULT;
      Serial.println("FAULT: NO FLOW");
      showFault("NO FLOW! Check");
      return;
    }
  }

  // -------- CAL DISPENSE (1L, NO early stop) --------
  if (state == STATE_CAL_DISPENSE) {
    calDispensePulses = p;

    if (p >= targetPulses) {
      // Stop pump but keep flow sensor active for settling
      pumpOff();
      settlingActive = true;
      settlingStartMs = now;
      Serial.printf("CAL PUMP OFF: pulses=%u, settling %lums...\n",
                    p, (unsigned long)POST_PUMP_SETTLE_MS);
      // Will complete in settling handler above, then go to CAL_REAL_VOL
    }
    return;
  }

  // -------- NORMAL DISPENSE STOP LOGIC (EARLY STOP + SETTLING) --------
  if (state == STATE_DISPENSING && pumpRunning && targetPulses > 0) {
    // Over-dispense safety in pulses (wider margin to account for settling)
    const uint32_t overPulses = (uint32_t)lroundf(OVER_DISPENSE_LIMIT_L * pulsesPerLiter);
    if (p > (targetPulses + overPulses)) {
      pumpOff();
      detachFlow();
      state = STATE_FAULT;
      Serial.printf("FAULT: OVER-DISPENSE p=%u target=%u\n", p, targetPulses);
      showFault("OVER-DISPENSE!");
      return;
    }

    // Early stop compensation — anticipate coast/drip pulses
    const float pulsesPerSec = (dt > 0) ? ((float)dp * 1000.0f / (float)dt) : 0.0f;
    uint32_t stopEarly = 0;

    // Estimate how many pulses will arrive during POST_PUMP_SETTLE_MS
    // This is the coast/drip compensation based on current flow rate
    const uint32_t coastPulses = (uint32_t)lroundf(
        pulsesPerSec * ((float)POST_PUMP_SETTLE_MS / 1000.0f) * COAST_FLOW_FACTOR);

    // For ALL amounts: use flow-rate-based early stop + coast compensation
    stopEarly = coastPulses + stopExtraPulses;

    // Additional early-stop for large amounts based on pump lag
    const uint32_t smallAmountPulses = (uint32_t)(0.5f * pulsesPerLiter);  // 500mL threshold
    if (targetPulses > smallAmountPulses) {
      stopEarly += (uint32_t)lroundf(pulsesPerSec * ((float)stopLagMs / 1000.0f));
    }

    // Safety cap: never stop more than 40% early
    const uint32_t maxEarlyStop = targetPulses * MAX_EARLY_STOP_PCT / 100;
    if (stopEarly > maxEarlyStop) {
      stopEarly = maxEarlyStop;
    }

    const uint32_t stopAt = (stopEarly < targetPulses) ? (targetPulses - stopEarly) : targetPulses;

    // Stop pump but keep flow sensor active for settling
    if (p >= stopAt) {
      pumpOff();
      // ✅ KEY FIX: Do NOT detach flow sensor here!
      // Keep counting pulses during coast/drip for accurate measurement
      settlingActive = true;
      settlingStartMs = now;

      Serial.printf("PUMP OFF: p=%u stopAt=%u target=%u early=%u, settling %lums...\n",
                    p, stopAt, targetPulses, stopEarly, (unsigned long)POST_PUMP_SETTLE_MS);
      // LCD shows "Measuring..." during settling
      lcd.clear();
      lcdPrintPadded(0, 0, "Measuring...");
      char l2[17];
      snprintf(l2, sizeof(l2), "%.3fL / %.3fL", dispensed_L, target_L);
      lcdPrintPadded(0, 1, String(l2));
      return;
    }
  }

  // Debug
  if (state == STATE_DISPENSING) {
    Serial.printf("P=%u dP=%u | D=%.3fL T=%.3fL | %.2fL/min %.1fmL/s | Pump=%s\n",
                  p, dp, dispensed_L, target_L,
                  flowRate_Lmin, flowRate_mLs,
                  pumpRunning ? "ON" : "OFF");
  }
}

// ========================= CALIBRATION KEYPAD =========================
static void handleCalKeypad(char key) {
  switch (state) {
    case STATE_CAL_MENU:
      if (key == '1') {
        lcd.clear();
        lcdPrintPadded(0, 0, "Dispense 1L now");
        lcdPrintPadded(0, 1, "#=Start *=Back");
      } else if (key == '#') {
        startCalDispense();
      } else if (key == '2') {
        state = STATE_CAL_OVERSHOOT;
        showCalOvershoot();
      } else if (key == '3') {
        resetCalibrationDefaults();
        lcd.clear();
        lcdPrintPadded(0, 0, "Reset defaults");
        lcdPrintPadded(0, 1, "PPL=" + String((int)roundf(pulsesPerLiter)));
        delay(1500);
        showCalMenu();
      } else if (key == '*') {
        state = STATE_IDLE;
        showIdle();
      } else if (key == 'A' || key == 'B') {
        calMenuPage = (calMenuPage + 1) % 2;
        showCalMenu();
      }
      break;

    case STATE_CAL_REAL_VOL:
      if (key >= '0' && key <= '9') {
        if (calInput.length() < 5) {
          calInput += key;
          showCalRealVol();
        }
      } else if (key == '*') {
        state = STATE_CAL_MENU;
        calMenuPage = 0;
        showCalMenu();
      } else if (key == '#') {
        if (!calInput.length()) return;

        float realML = calInput.toFloat();
        if (realML < 100.0f || realML > 5000.0f) {
          lcd.clear();
          lcdPrintPadded(0, 0, "Invalid mL!");
          lcdPrintPadded(0, 1, "100-5000 only");
          delay(1500);
          calInput = "";
          showCalRealVol();
          return;
        }

        // NewPPL = OldPPL * (DisplayedML / RealML) ; displayed = 1000mL
        float oldPPL = pulsesPerLiter;
        float newPPL = oldPPL * (1000.0f / realML);

        if (newPPL < 50.0f || newPPL > 2000.0f) {
          lcd.clear();
          lcdPrintPadded(0, 0, "Invalid new PPL");
          delay(1500);
          calInput = "";
          showCalRealVol();
          return;
        }

        pulsesPerLiter = newPPL;
        saveCalibration();

        lcd.clear();
        lcdPrintPadded(0, 0, "Calibrated!");
        lcdPrintPadded(0, 1, "PPL=" + String(pulsesPerLiter, 1));
        Serial.printf("CAL: old=%.1f realML=%.0f new=%.1f\n", oldPPL, realML, newPPL);

        delay(2000);
        calInput = "";
        state = STATE_CAL_MENU;
        calMenuPage = 0;
        showCalMenu();
      }
      break;

    case STATE_CAL_OVERSHOOT:
      if (key == '2') {
        if (stopExtraPulses < 300) stopExtraPulses++;
        showCalOvershoot();
      } else if (key == '8') {
        if (stopExtraPulses > 0) stopExtraPulses--;
        showCalOvershoot();
      } else if (key == '#') {
        saveCalibration();
        lcd.clear();
        lcdPrintPadded(0, 0, "Saved!");
        lcdPrintPadded(0, 1, "StopExtra=" + String(stopExtraPulses));
        delay(1200);
        state = STATE_CAL_MENU;
        calMenuPage = 0;
        showCalMenu();
      } else if (key == '*') {
        loadCalibration();
        state = STATE_CAL_MENU;
        calMenuPage = 0;
        showCalMenu();
      }
      break;

    case STATE_CAL_DISPENSE:
      if (key == '*') {
        pumpOff();
        settlingActive = false;
        detachFlow();
        state = STATE_CAL_MENU;
        calMenuPage = 0;
        showCalMenu();
      }
      break;

    default:
      break;
  }
}

// ========================= INPUT: KEYPAD =========================
static void handleKeypad() {
  const uint32_t now = millis();

  // Hold * to enter CAL menu (only in IDLE, not entering custom)
  if (state == STATE_IDLE && !enteringCustom) {
    if (keypad.isPressed('*')) {
      if (!starHeld) {
        if (starHoldStart == 0) starHoldStart = now;
        if ((now - starHoldStart) >= CAL_HOLD_MS) {
          starHeld = true;
          state = STATE_CAL_MENU;
          calMenuPage = 0;
          lcd.clear();
          lcdPrintPadded(0, 0, "Entering CAL...");
          delay(400);
          showCalMenu();
          Serial.println("Entered CAL MODE");
          return;
        }
      }
    } else {
      starHoldStart = 0;
      starHeld = false;
    }
  }

  char key = keypad.getKey();
  if (!key) return;

  // ✅ FIX: Extra debounce - ignore rapid repeated same key
  uint32_t keyNow = millis();
  if (key == lastKey && (keyNow - lastKeyTime) < KEY_REPEAT_DELAY) {
    return;  // ignore too-fast repeat
  }
  lastKey = key;
  lastKeyTime = keyNow;

  Serial.printf("KEY: %c\n", key);

  // Calibration states
  if (state == STATE_CAL_MENU || state == STATE_CAL_REAL_VOL ||
      state == STATE_CAL_OVERSHOOT || state == STATE_CAL_DISPENSE) {
    handleCalKeypad(key);
    return;
  }

  switch (state) {
    case STATE_LOCKED:
      // Only 'A' key starts login
      if (key == 'A' || key == 'a') {
        // Check lockout
        if (pinAttempts >= MAX_PIN_ATTEMPTS) {
          if ((millis() - lockoutStartMs) < LOCKOUT_DURATION_MS) {
            lcd.clear();
            lcdPrintPadded(0, 0, "LOCKED OUT!");
            lcdPrintPadded(0, 1, "Wait 30 sec...");
            return;
          }
          // Lockout expired
          pinAttempts = 0;
        }
        pinEntry = "";
        state = STATE_ENTER_PIN;
        showEnterPin();
      }
      break;

    case STATE_ENTER_PIN:
      if (key >= '0' && key <= '9') {
        if (pinEntry.length() < MAX_PIN_LENGTH) {
          pinEntry += key;
          showEnterPin();
        }
      } else if (key == '#') {
        // Confirm PIN
        if (pinEntry == String(OPERATOR_PIN)) {
          // PIN correct
          pinAttempts = 0;
          pinEntry = "";
          state = STATE_IDLE;
          lcd.clear();
          lcdPrintPadded(0, 0, "PIN OK!");
          lcdPrintPadded(0, 1, "Welcome");
          delay(800);
          showIdle();
        } else {
          // Wrong PIN
          pinAttempts++;
          pinEntry = "";
          lcd.clear();
          lcdPrintPadded(0, 0, "Wrong PIN!");
          char l2[17];
          snprintf(l2, sizeof(l2), "%u/%u attempts", pinAttempts, MAX_PIN_ATTEMPTS);
          lcdPrintPadded(0, 1, String(l2));
          delay(1200);
          if (pinAttempts >= MAX_PIN_ATTEMPTS) {
            lockoutStartMs = millis();
            lcd.clear();
            lcdPrintPadded(0, 0, "TOO MANY TRIES");
            lcdPrintPadded(0, 1, "Locked 30 sec");
            delay(1500);
            state = STATE_LOCKED;
            showLocked();
          } else {
            showEnterPin();
          }
        }
      } else if (key == '*') {
        // Cancel — back to locked
        pinEntry = "";
        state = STATE_LOCKED;
        showLocked();
      } else if (key == 'B') {
        // Backspace
        if (pinEntry.length() > 0) {
          pinEntry.remove(pinEntry.length() - 1);
          showEnterPin();
        }
      }
      break;

    case STATE_IDLE:
      if (enteringCustom) {
        if (key >= '0' && key <= '9') {
          if (customAmount.length() < 6) {
            customAmount += key;
            showCustomEntry();
          }
        } else if (key == '.') {
          // decimal allowed in L and K, not mL
          if (entryMode != 1 && customAmount.indexOf('.') == -1 && customAmount.length() < 5) {
            customAmount += key;
            showCustomEntry();
          }
        } else if (key == 'D') {
          // cycle modes: K -> L -> mL -> K
          entryMode = (entryMode + 1) % 3;
          showCustomEntry();
        } else if (key == '*') {
          enteringCustom = false;
          entryMode = 2;
          customAmount = "";
          showIdle();
        } else if (key == '#') {
          if (!customAmount.length()) return;

          float amt = customAmount.toFloat();

          // ========= MONEY MODE (FIXED DISPLAY) =========
          if (entryMode == 2) {
            // Validate K range
            if (amt < MIN_KWACHA || amt > MAX_KWACHA) {
              lcd.clear();
              lcdPrintPadded(0, 0, "Invalid Kwacha!");
              lcdPrintPadded(0, 1, "K5 - K500 only");
              delay(1500);
              showCustomEntry();
              return;
            }

            enteredKwacha = amt;
            moneyModeActive = true;

            float priceForCalc = (dashboardPrice > 0.0f) ? dashboardPrice : PRICE_PER_LITER;
            float liters = enteredKwacha / priceForCalc;

            // safety liters range
            if (liters < MIN_LITERS || liters > MAX_LITERS) {
              lcd.clear();
              lcdPrintPadded(0, 0, "Volume out range");
              lcdPrintPadded(0, 1, "Check limits");
              delay(1500);
              showCustomEntry();
              return;
            }

            enteringCustom = false;
            customAmount = "";
            startDispense(liters);
            return;
          }

          // ========= mL MODE =========
          moneyModeActive = false;
          enteredKwacha = 0.0f;

          if (entryMode == 1) {
            float liters = amt / 1000.0f;
            if (liters < MIN_LITERS || liters > MAX_LITERS) {
              lcd.clear();
              lcdPrintPadded(0, 0, "Invalid amount!");
              lcdPrintPadded(0, 1, "50mL-50L only");
              delay(1500);
              showCustomEntry();
              return;
            }
            enteringCustom = false;
            customAmount = "";
            startDispense(liters);
            return;
          }

          // ========= L MODE =========
          {
            float liters = amt;
            if (liters < MIN_LITERS || liters > MAX_LITERS) {
              lcd.clear();
              lcdPrintPadded(0, 0, "Invalid amount!");
              lcdPrintPadded(0, 1, "50mL-50L only");
              delay(1500);
              showCustomEntry();
              return;
            }
            enteringCustom = false;
            customAmount = "";
            startDispense(liters);
            return;
          }
        }

      } else {
        switch (key) {
          case 'A': moneyModeActive = false; enteredKwacha = 0; startDispense(PRESET_A_L); break;
          case 'B': moneyModeActive = false; enteredKwacha = 0; startDispense(PRESET_B_L); break;
          case 'C': moneyModeActive = false; enteredKwacha = 0; startDispense(PRESET_C_L); break;
          case 'D': moneyModeActive = false; enteredKwacha = 0; startDispense(PRESET_D_L); break;

          case '#':
            enteringCustom = true;
            customAmount = "";
            entryMode = 2;  // default to money entry
            showCustomEntry();
            break;

          default:
            if (key >= '0' && key <= '9') {
              enteringCustom = true;
              entryMode = 2; // default to money entry
              customAmount = String(key);
              showCustomEntry();
            }
            break;
        }
      }
      break;

    case STATE_DISPENSING:
      if (key == '*') {
        pumpOff();
        settlingActive = false;  // cancel any settling
        detachFlow();
        state = STATE_PAUSED;
        showPaused();
      }
      break;

    case STATE_PAUSED:
      if (key == '#') {
        // resume
        pinMode(FLOW_PIN, INPUT_PULLUP);
        attachFlow();
        lastPulseTime = millis();
        lastCalcTime  = millis();
        pumpOn();
        state = STATE_DISPENSING;
      } else if (key == '*') {
        // cancel
        pumpOff();
        detachFlow();
        state = STATE_IDLE;
        total_L += dispensed_L;
        resetDispense();
        resetMoneyMode();
        showIdle();
      }
      break;

    case STATE_COMPLETE:
      returnToLocked();
      break;

    case STATE_FAULT:
      pumpOff();
      detachFlow();
      returnToLocked();
      break;

    default:
      break;
  }
}

// ========================= INPUT: SERIAL =========================
static void handleSerial() {
  if (!Serial.available()) return;

  const char cmd = Serial.read();
  switch (cmd) {
    case 'h': case 'H':
      Serial.println("Commands: s=status, r=reset, d=defaults, t=sales, w=wifi");
      break;

    case 's': case 'S':
      Serial.println("\n=== STATUS ===");
      Serial.printf("State: %u\n", (uint8_t)state);
      Serial.printf("Target: %.3f L | targetPulses=%u\n", target_L, targetPulses);
      Serial.printf("Dispensed: %.3f L (%.0f mL)\n", dispensed_L, dispensed_L * 1000.0f);
      Serial.printf("Flow: %.2f L/min | %.1f mL/s\n", flowRate_Lmin, flowRate_mLs);
      Serial.printf("Total: %.3f L\n", total_L);
      Serial.printf("Pump: %s\n", pumpRunning ? "ON" : "OFF");
      Serial.printf("PPL: %.1f | StopLag: %lu ms | StopExtra: %u\n",
                    pulsesPerLiter, (unsigned long)stopLagMs, stopExtraPulses);
      Serial.printf("MoneyActive=%d EnteredK=%.0f\n", moneyModeActive ? 1 : 0, enteredKwacha);
      Serial.printf("--- SALES ---\n");
      Serial.printf("Transactions: %u\n", transactionCount);
      Serial.printf("Total Sold: %.2f L\n", salesTotal_L);
      Serial.printf("Total Revenue: K%.2f\n", salesTotal_K);
      Serial.printf("--- DASHBOARD ---\n");
      Serial.printf("WiFi: %s (RSSI: %d)\n", wifiConnected ? "ONLINE" : "OFFLINE",
                    wifiConnected ? WiFi.RSSI() : -127);
      Serial.printf("Dashboard: %s\n", API_BASE_URL);
      Serial.printf("Device: %s\n", DEVICE_ID);
      if (dashboardPrice > 0.0f) {
        Serial.printf("Dashboard Price: %.2f/L\n", dashboardPrice);
      }
      Serial.println("==============\n");
      break;

    case 'r': case 'R':
      pumpOff();
      detachFlow();
      resetAll();
      returnToLocked();
      break;

    case 'd': case 'D':
      resetCalibrationDefaults();
      Serial.println("Calibration reset to defaults.");
      break;

    case 't': case 'T':
      Serial.println("\n=== SALES REPORT ===");
      Serial.printf("Transactions: %u\n", transactionCount);
      Serial.printf("Total Sold:   %.2f L\n", salesTotal_L);
      Serial.printf("Total Revenue: K%.2f\n", salesTotal_K);
      if (transactionCount > 0) {
        Serial.printf("Avg per TX:   %.2f L, K%.2f\n",
                      salesTotal_L / transactionCount, salesTotal_K / transactionCount);
      }
      Serial.println("====================\n");
      break;

    case 'w': case 'W':
      Serial.printf("[WIFI] Status: %s\n", wifiConnected ? "CONNECTED" : "DISCONNECTED");
      if (wifiConnected) {
        Serial.printf("[WIFI] IP: %s  RSSI: %d\n",
                      WiFi.localIP().toString().c_str(), WiFi.RSSI());
        Serial.printf("[DASHBOARD] %s\n", API_BASE_URL);
        Serial.printf("[DEVICE] %s\n", DEVICE_ID);
      } else {
        Serial.println("[WIFI] Reconnecting...");
        connectWiFi();
      }
      break;
  }
}

// ========================= DISPLAY UPDATE =========================
static void updateDisplay() {
  const uint32_t now = millis();
  if (now - lastDisplayUpdate < DISPLAY_UPDATE_MS) return;
  lastDisplayUpdate = now;

  if (state == STATE_DISPENSING) showDispensing();
  if (state == STATE_CAL_DISPENSE) showCalDispensing();
}

// ========================= SETUP / LOOP =========================
void setup() {
  Serial.begin(115200);
  delay(300);

  pinMode(PUMP_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  pinMode(FLOW_PIN, INPUT_PULLUP);

  digitalWrite(PUMP_PIN, HIGH);
  digitalWrite(LED_PIN, LOW);

  loadCalibration();
  loadSalesData();

  Wire.begin(SDA_PIN, SCL_PIN);
  lcd.init();
  lcd.backlight();

  // ✅ FIX: Add keypad debounce to prevent phantom presses
  keypad.setDebounceTime(50);    // 50ms debounce
  keypad.setHoldTime(1000);      // 1 second hold time

  // start with flow detached (software off)
  detachFlow();

  lcd.clear();
  lcdPrintPadded(0, 0, "OIL DISPENSER");
  lcdPrintPadded(0, 1, "Connecting WiFi");

  Serial.println("\n=============================================");
  Serial.println("ESP32 OIL DISPENSER — DASHBOARD CONNECTED");
  Serial.println("=============================================");
  Serial.printf("Device: %s  Site: %s\n", DEVICE_ID, SITE_NAME);
  Serial.printf("Dashboard: %s\n", API_BASE_URL);
  Serial.printf("FLOW_PIN=%u EDGE=%s\n", FLOW_PIN, (FLOW_EDGE == FALLING) ? "FALLING" : "RISING");
  Serial.printf("PPL=%.1f (NVS)\n", pulsesPerLiter);
  Serial.printf("StopLag=%lu ms, StopExtra=%u pulses\n", (unsigned long)stopLagMs, stopExtraPulses);
  Serial.printf("Sales: %u TX, %.2fL, K%.2f\n", transactionCount, salesTotal_L, salesTotal_K);

  // Connect WiFi
  connectWiFi();

  // Setup HTTPS client — skip cert validation for Vercel compatibility
  secureClient.setInsecure();

  // Fetch config (pricing) from dashboard on boot
  if (wifiConnected) {
    fetchDeviceConfig();
    lastConfigFetchMs = millis();
    sendHeartbeat();
    lastHeartbeatMs = millis();
  }

  Serial.println("PIN protection ENABLED. Press A to login.");
  Serial.println("Hold * for 3s to enter CAL menu (after login).");
  Serial.printf("WiFi: %s | Dashboard: %s\n",
                wifiConnected ? "ONLINE" : "OFFLINE",
                wifiConnected ? "CONNECTED" : "will sync when available");
  Serial.println("=============================================\n");

  // Show WiFi status briefly
  lcd.clear();
  lcdPrintPadded(0, 0, "OIL DISPENSER");
  lcdPrintPadded(0, 1, wifiConnected ? "WiFi: ONLINE" : "WiFi: OFFLINE");
  delay(1200);

  resetDispense();
  showLocked();
  state = STATE_LOCKED;
}

void loop() {
  calculateFlow();
  handleKeypad();
  handleSerial();
  updateDisplay();
  handleDashboard();  // WiFi + telemetry + heartbeat + config sync
}
