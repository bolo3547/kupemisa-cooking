/********************************************************************
 * ESP32 Oil Dispenser (Filling Station Mode) with Operator Login
 * 
 * Hardware:
 *  - ESP32 Dev Module (ESP-WROOM-32) or D1 R32
 *  - 3.5" SPI TFT ILI9488 (TFT_eSPI) or 16x2 I2C LCD
 *  - 4x4 Matrix Keypad
 *  - Flow sensor (pulse output)
 *  - Pump (12V) via relay/MOSFET
 * 
 * Features:
 *  - Local operator login via keypad (PIN-based)
 *  - Dashboard verifies operator credentials
 *  - Local liters entry after login
 *  - Auto-stop at target liters (flow sensor is source of truth)
 *  - Sale recording sent to dashboard
 *  - Auto-logout after each sale
 * 
 * Flow:
 *  1. IDLE: Show "WAIT AUTH / Press A Login"
 *  2. Press A -> Enter PIN mode
 *  3. Enter PIN, press # to confirm
 *  4. Dashboard verifies PIN, returns operator name
 *  5. If valid -> Enter liters mode
 *  6. Enter liters, press # to confirm
 *  7. Show "READY / Press D to dispense"
 *  8. D starts pump, * stops pump (emergency)
 *  9. Pump auto-stops at target liters
 * 10. Sale sent to dashboard, auto-logout, return to IDLE
 ********************************************************************/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <Keypad.h>
#include <TFT_eSPI.h>
#include <time.h>

// ========================= USER CONFIG (PASTE HERE) =========================
// Paste ONLY these defines here:
// #define DEVICE_ID "OIL-0009"
// #define API_KEY "xxxx"
// #define API_BASE_URL "https://yourdomain.vercel.app"
// #define SITE_NAME "Manda Hill Tank 2"
// ==========================================================================

#ifndef DEVICE_ID
  #define DEVICE_ID "OIL-UNCONFIGURED"
#endif
#ifndef API_KEY
  #define API_KEY "UNCONFIGURED"
#endif
#ifndef API_BASE_URL
  #define API_BASE_URL "http://localhost:3000"
#endif
#ifndef SITE_NAME
  #define SITE_NAME "UNNAMED_SITE"
#endif

// ========================= WIFI CONFIG =========================
const char* WIFI_SSID = "";   // e.g. "MTN_4G"
const char* WIFI_PASS = "";   // e.g. "password"
// ================================================================

// ========================= PINS =========================
// Pump control
static const int PIN_PUMP = 26;
static const bool PUMP_ACTIVE_HIGH = true;

// Flow sensor pulse input (interrupt)
static const int PIN_FLOW = 27;

// TFT is wired via TFT_eSPI config in User_Setup.h:
// SCK=18, MOSI=23, MISO=19, CS=5, DC=21, RST=4, LED=3V3

// Keypad pins (safe, no boot strap issues)
const byte ROWS = 4, COLS = 4;
char keys[ROWS][COLS] = {
  {'1','2','3','A'},
  {'4','5','6','B'},
  {'7','8','9','C'},
  {'*','0','#','D'}
};
byte rowPins[ROWS] = {32, 33, 25, 14};
byte colPins[COLS] = {13, 16, 17, 22};
Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

// ========================= DISPLAY =========================
TFT_eSPI tft = TFT_eSPI();

// ========================= STORAGE =========================
Preferences prefs;

// ========================= FLOW METER =========================
volatile uint32_t flowPulses = 0;
float pulsesPerLiter = 450.0f;  // Calibrate for your sensor
float dispensedLiters = 0.0f;
float litersTotal = 0.0f;
float flowLpm = 0.0f;
uint32_t lastFlowMs = 0;
uint32_t lastPulseSnapshot = 0;
uint32_t noFlowStartMs = 0;

// Flow sensor ISR
void IRAM_ATTR onFlowPulse() { flowPulses++; }

// ========================= PRICING (from dashboard) =========================
struct Price {
  float sell = 0.0f;      // Selling price per liter (from dashboard)
  float cost = 0.0f;      // Cost price per liter (from dashboard)
  char currency[8] = "ZMW";
} price;

// ========================= OPERATOR SESSION =========================
struct OperatorSession {
  bool loggedIn = false;
  String operatorId = "";
  String operatorName = "";
  String operatorRole = "";
} session;

// ========================= STATE MACHINE =========================
enum State {
  IDLE,              // Wait for operator login (Press A)
  ENTER_PIN,         // Operator entering PIN
  VERIFYING_PIN,     // Waiting for dashboard response
  ENTER_LITERS,      // Operator entering target liters
  CONFIRM_READY,     // Show target, wait for D to start
  DISPENSING,        // Pump running, measuring flow
  PAUSED,            // Pump paused (user pressed *)
  COMPLETING,        // Sending sale to dashboard
  RECEIPT,           // Show receipt
  ERROR_STATE,       // Error occurred
  ADMIN              // Admin menu
};
State state = IDLE;

// ========================= INPUT BUFFERS =========================
String pinBuf = "";
String litersBuf = "";
String adminBuf = "";

// ========================= DISPENSING STATE =========================
float targetLiters = 0.0f;
uint32_t dispenseStartMs = 0;
uint32_t dispenseStartUnix = 0;
String lastError = "";

// ========================= TIMERS =========================
uint32_t lastUiMs = 0;
uint32_t lastTelemetryMs = 0;
uint32_t lastReceiptRetryMs = 0;

static const uint32_t UI_MS = 250;
static const uint32_t TELEMETRY_MS = 10000;
static const uint32_t RETRY_MS = 8000;

// ========================= RECEIPT QUEUE =========================
static const int QSIZE = 20;

// ========================= UTIL FUNCTIONS =========================
bool isCloudEnabled() {
  return String(API_KEY) != "UNCONFIGURED" && String(API_BASE_URL).length() > 8;
}

void pumpSet(bool on) {
  if (PUMP_ACTIVE_HIGH) digitalWrite(PIN_PUMP, on ? HIGH : LOW);
  else digitalWrite(PIN_PUMP, on ? LOW : HIGH);
}

bool pumpOn() {
  int v = digitalRead(PIN_PUMP);
  return PUMP_ACTIVE_HIGH ? (v == HIGH) : (v == LOW);
}

String baseUrl() {
  String b = String(API_BASE_URL);
  if (b.endsWith("/")) b.remove(b.length()-1);
  return b;
}

String endpoint(const char* path) {
  return baseUrl() + String(path);
}

uint32_t unixNow() {
  time_t now = time(nullptr);
  if (now < 1700000000) return 0;
  return (uint32_t)now;
}

String money(float v) {
  char buf[32];
  snprintf(buf, sizeof(buf), "%s %.2f", price.currency, v);
  return String(buf);
}

// ========================= SESSION MANAGEMENT =========================
void clearSession() {
  session.loggedIn = false;
  session.operatorId = "";
  session.operatorName = "";
  session.operatorRole = "";
  pinBuf = "";
  litersBuf = "";
  targetLiters = 0.0f;
  dispensedLiters = 0.0f;
}

// ========================= UI FUNCTIONS =========================
void header(const char* title) {
  tft.fillScreen(TFT_BLACK);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setTextSize(2);
  tft.setCursor(10, 8);
  tft.print(title);

  tft.setTextSize(1);
  tft.setCursor(10, 34);
  tft.printf("Site: %s", SITE_NAME);
  tft.setCursor(10, 46);
  tft.printf("Dev: %s", DEVICE_ID);

  tft.setCursor(10, 58);
  tft.printf("WiFi: %s", WiFi.status() == WL_CONNECTED ? "ONLINE" : "OFFLINE");
}

void uiIdle() {
  header("WAIT AUTH");
  tft.setTextSize(2);
  tft.setCursor(10, 90);
  tft.println("Press A Login");
  tft.setTextSize(1);
  tft.setCursor(10, 130);
  if (price.sell > 0) {
    tft.printf("Price/L: %s %.2f", price.currency, price.sell);
  } else {
    tft.print("Price: Awaiting dashboard");
  }
  tft.setCursor(10, 150);
  tft.printf("FlowCal: %.1f pulses/L", pulsesPerLiter);
  tft.setCursor(10, 190);
  tft.println("Hold A for Admin");
}

void uiEnterPin() {
  header("ENTER PIN");
  tft.setTextSize(2);
  tft.setCursor(10, 95);
  // Show masked PIN
  String masked;
  for (unsigned int i = 0; i < pinBuf.length(); i++) masked += "*";
  tft.printf("PIN: %s", masked.c_str());
  tft.setTextSize(1);
  tft.setCursor(10, 150);
  tft.print("# confirm   * cancel");
}

void uiVerifyingPin() {
  header("VERIFYING...");
  tft.setTextSize(2);
  tft.setCursor(10, 95);
  tft.println("Please wait");
  tft.setTextSize(1);
  tft.setCursor(10, 130);
  tft.print("Contacting dashboard...");
}

void uiEnterLiters() {
  header("ENTER LITERS");
  tft.setTextSize(2);
  tft.setCursor(10, 80);
  tft.printf("Op: %s", session.operatorName.c_str());
  tft.setCursor(10, 110);
  tft.printf("L: %s", litersBuf.length() > 0 ? litersBuf.c_str() : "_");
  tft.setTextSize(1);
  tft.setCursor(10, 150);
  tft.printf("Price/L: %s %.2f", price.currency, price.sell);
  tft.setCursor(10, 170);
  tft.print("# confirm   * cancel");
}

void uiConfirmReady() {
  header("READY");
  float total = targetLiters * price.sell;
  
  tft.setTextSize(1);
  tft.setCursor(10, 75);
  tft.printf("Operator: %s", session.operatorName.c_str());
  
  tft.setTextSize(2);
  tft.setCursor(10, 95);
  tft.printf("%.2f L", targetLiters);
  
  tft.setTextSize(1);
  tft.setCursor(10, 125);
  tft.printf("Price/L: %s %.2f", price.currency, price.sell);
  tft.setCursor(10, 140);
  tft.printf("Total:   %s %.2f", price.currency, total);
  
  tft.setTextSize(2);
  tft.setCursor(10, 170);
  tft.setTextColor(TFT_GREEN, TFT_BLACK);
  tft.println("Press D");
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  
  tft.setTextSize(1);
  tft.setCursor(10, 200);
  tft.print("* cancel");
}

void uiDispense() {
  header("DISPENSING");
  float total = dispensedLiters * price.sell;
  float profit = dispensedLiters * (price.sell - price.cost);
  float remaining = targetLiters - dispensedLiters;
  if (remaining < 0) remaining = 0;

  tft.setTextSize(1);
  tft.setCursor(10, 73);
  tft.printf("Operator: %s", session.operatorName.c_str());

  tft.setTextSize(2);
  tft.setCursor(10, 88);
  tft.printf("T:%.2fL", targetLiters);
  tft.setCursor(10, 114);
  tft.setTextColor(TFT_GREEN, TFT_BLACK);
  tft.printf("D:%.2fL", dispensedLiters);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);

  tft.setTextSize(1);
  tft.setCursor(10, 145);
  tft.printf("Remaining: %.2f L", remaining);
  tft.setCursor(10, 160);
  tft.printf("Flow: %.2f L/min", flowLpm);
  tft.setCursor(10, 175);
  tft.printf("Total: %s %.2f", price.currency, total);
  
  tft.setCursor(10, 200);
  tft.print("* STOP (emergency)");
}

void uiPaused() {
  header("PAUSED");
  tft.setTextSize(2);
  tft.setCursor(10, 90);
  tft.setTextColor(TFT_YELLOW, TFT_BLACK);
  tft.print("Pump OFF");
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setTextSize(1);
  tft.setCursor(10, 130);
  tft.printf("Dispensed: %.2f L", dispensedLiters);
  tft.setCursor(10, 150);
  tft.print("# resume   * cancel sale");
}

void uiCompleting() {
  header("COMPLETING");
  tft.setTextSize(2);
  tft.setCursor(10, 95);
  tft.println("Sending...");
  tft.setTextSize(1);
  tft.setCursor(10, 130);
  tft.print("Recording sale to dashboard");
}

void uiReceipt() {
  header("RECEIPT");
  float total = dispensedLiters * price.sell;
  float profit = dispensedLiters * (price.sell - price.cost);
  uint32_t durSec = (millis() - dispenseStartMs) / 1000;

  tft.setTextSize(1);
  tft.setCursor(10, 75);
  tft.println("--------------------------------");
  tft.setCursor(10, 88);
  tft.println("      OIL DISPENSE RECEIPT");
  tft.setCursor(10, 101);
  tft.println("--------------------------------");

  tft.setCursor(10, 116);
  tft.printf("Operator: %s", session.operatorName.c_str());
  tft.setCursor(10, 131);
  tft.printf("Price/L: %s %.2f", price.currency, price.sell);
  tft.setCursor(10, 146);
  tft.printf("Target:  %.2f L", targetLiters);
  tft.setCursor(10, 161);
  tft.printf("Disp:    %.2f L", dispensedLiters);
  tft.setCursor(10, 176);
  tft.printf("Total:   %s %.2f", price.currency, total);
  tft.setCursor(10, 191);
  tft.printf("Time:    %lu s", (unsigned long)durSec);

  tft.setCursor(10, 210);
  tft.println("Press # finish");
}

void uiError() {
  header("ERROR");
  tft.setTextSize(2);
  tft.setCursor(10, 90);
  tft.setTextColor(TFT_RED, TFT_BLACK);
  tft.print("STOPPED");
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setTextSize(1);
  tft.setCursor(10, 125);
  tft.print(lastError);
  tft.setCursor(10, 160);
  tft.print("Press # to reset");
}

// ========================= ADMIN UI =========================
enum AdminMode { AMENU, A_SELL, A_COST, A_CAL };
AdminMode am = AMENU;

void uiAdminMenu() {
  header("ADMIN");
  tft.setTextSize(1);
  tft.setCursor(10, 85);
  tft.println("A: Set SELL price/L");
  tft.setCursor(10, 100);
  tft.println("B: Set COST price/L");
  tft.setCursor(10, 115);
  tft.println("C: Calibrate pulses/L");
  tft.setCursor(10, 135);
  tft.printf("Sell: %.2f  Cost: %.2f", price.sell, price.cost);
  tft.setCursor(10, 150);
  tft.printf("FlowCal: %.1f pulses/L", pulsesPerLiter);
  tft.setCursor(10, 180);
  tft.println("* Exit");
}

void uiAdminInput(const char* label) {
  header("ADMIN INPUT");
  tft.setTextSize(1);
  tft.setCursor(10, 85);
  tft.println(label);
  tft.setTextSize(2);
  tft.setCursor(10, 105);
  tft.print(adminBuf);
  tft.setTextSize(1);
  tft.setCursor(10, 150);
  tft.println("# save   * cancel");
}

// ========================= NVS STORAGE =========================
void loadSettings() {
  // Load pricing (local fallback, dashboard takes precedence)
  prefs.begin("price", true);
  price.sell = prefs.getFloat("sell", price.sell);
  price.cost = prefs.getFloat("cost", price.cost);
  String cur = prefs.getString("cur", "ZMW");
  memset(price.currency, 0, sizeof(price.currency));
  cur.toCharArray(price.currency, sizeof(price.currency));
  prefs.end();

  // Load flow calibration
  prefs.begin("flow", true);
  pulsesPerLiter = prefs.getFloat("ppl", pulsesPerLiter);
  prefs.end();

  // Initialize receipt queue
  prefs.begin("rq", false);
  if (!prefs.isKey("head")) prefs.putUInt("head", 0);
  if (!prefs.isKey("tail")) prefs.putUInt("tail", 0);
  prefs.end();
}

void savePricing() {
  prefs.begin("price", false);
  prefs.putFloat("sell", price.sell);
  prefs.putFloat("cost", price.cost);
  prefs.putString("cur", String(price.currency));
  prefs.end();
}

// ========================= RECEIPT QUEUE =========================
void qPush(const String& json) {
  prefs.begin("rq", false);
  uint32_t head = prefs.getUInt("head", 0);
  uint32_t tail = prefs.getUInt("tail", 0);

  String key = "r" + String(head % QSIZE);
  prefs.putString(key.c_str(), json);

  head++;
  if (head - tail > QSIZE) tail++;

  prefs.putUInt("head", head);
  prefs.putUInt("tail", tail);
  prefs.end();
}

bool qPeek(String& out) {
  prefs.begin("rq", true);
  uint32_t head = prefs.getUInt("head", 0);
  uint32_t tail = prefs.getUInt("tail", 0);
  if (head == tail) { prefs.end(); return false; }
  String key = "r" + String(tail % QSIZE);
  out = prefs.getString(key.c_str(), "");
  prefs.end();
  return out.length() > 0;
}

void qPop() {
  prefs.begin("rq", false);
  uint32_t head = prefs.getUInt("head", 0);
  uint32_t tail = prefs.getUInt("tail", 0);
  if (head != tail) tail++;
  prefs.putUInt("tail", tail);
  prefs.end();
}

// ========================= HTTP FUNCTIONS =========================
// Use secure client for HTTPS
WiFiClientSecure secureClient;

bool httpPostJson(const char* path, const String& body, String& response) {
  if (WiFi.status() != WL_CONNECTED) return false;
  if (!isCloudEnabled()) return false;

  HTTPClient http;
  
  // Check if using HTTPS
  String url = endpoint(path);
  if (url.startsWith("https://")) {
    secureClient.setInsecure();  // Skip certificate validation for simplicity
    http.begin(secureClient, url);
  } else {
    http.begin(url);
  }
  
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-id", String(DEVICE_ID));
  http.addHeader("x-api-key", String(API_KEY));
  
  int code = http.POST((uint8_t*)body.c_str(), body.length());
  
  if (code >= 200 && code < 300) {
    response = http.getString();
    http.end();
    return true;
  }
  
  http.end();
  return false;
}

bool httpGetJson(const char* path, String& response) {
  if (WiFi.status() != WL_CONNECTED) return false;
  if (!isCloudEnabled()) return false;

  HTTPClient http;
  
  String url = endpoint(path);
  if (url.startsWith("https://")) {
    secureClient.setInsecure();
    http.begin(secureClient, url);
  } else {
    http.begin(url);
  }
  
  http.addHeader("x-device-id", String(DEVICE_ID));
  http.addHeader("x-api-key", String(API_KEY));
  
  int code = http.GET();
  
  if (code >= 200 && code < 300) {
    response = http.getString();
    http.end();
    return true;
  }
  
  http.end();
  return false;
}

// ========================= DASHBOARD API CALLS =========================

/**
 * Verify operator PIN with dashboard
 * POST /api/device/verify-pin
 * Body: { "pin": "1234" }
 * Returns: { "ok": true, "operator": { "id", "name", "role" } }
 */
bool verifyOperatorPin(const String& pin) {
  StaticJsonDocument<256> reqDoc;
  reqDoc["pin"] = pin;
  
  String body;
  serializeJson(reqDoc, body);
  
  String response;
  if (!httpPostJson("/api/device/verify-pin", body, response)) {
    lastError = "Network error";
    return false;
  }
  
  StaticJsonDocument<512> resDoc;
  DeserializationError err = deserializeJson(resDoc, response);
  if (err) {
    lastError = "Invalid response";
    return false;
  }
  
  bool ok = resDoc["ok"] | false;
  if (!ok) {
    lastError = resDoc["error"] | "Invalid PIN";
    return false;
  }
  
  // Extract operator info
  session.operatorId = resDoc["operator"]["id"].as<String>();
  session.operatorName = resDoc["operator"]["name"].as<String>();
  session.operatorRole = resDoc["operator"]["role"].as<String>();
  session.loggedIn = true;
  
  return true;
}

/**
 * Fetch current pricing from dashboard
 * GET /api/device/config
 * Returns: { "ok": true, "price": { "pricePerLiter", "costPerLiter", "currency" } }
 */
bool fetchPriceFromDashboard() {
  String response;
  if (!httpGetJson("/api/device/config", response)) {
    return false;
  }
  
  StaticJsonDocument<512> doc;
  DeserializationError err = deserializeJson(doc, response);
  if (err) return false;
  
  bool ok = doc["ok"] | false;
  if (!ok) return false;
  
  price.sell = doc["price"]["pricePerLiter"] | price.sell;
  price.cost = doc["price"]["costPerLiter"] | price.cost;
  
  String cur = doc["price"]["currency"] | "ZMW";
  memset(price.currency, 0, sizeof(price.currency));
  cur.toCharArray(price.currency, sizeof(price.currency));
  
  // Save to NVS as fallback
  savePricing();
  
  return true;
}

/**
 * Send telemetry to dashboard
 * POST /api/ingest/telemetry
 */
void sendTelemetry() {
  StaticJsonDocument<512> doc;
  doc["deviceId"] = String(DEVICE_ID);
  doc["siteName"] = String(SITE_NAME);
  doc["ts"] = (uint32_t)(unixNow() ? unixNow() : (millis()/1000));
  doc["flowLpm"] = flowLpm;
  doc["litersTotal"] = litersTotal;
  doc["pumpState"] = pumpOn();
  doc["wifiRssi"] = (WiFi.status() == WL_CONNECTED) ? WiFi.RSSI() : -127;

  String body;
  serializeJson(doc, body);
  String response;
  httpPostJson("/api/ingest/telemetry", body, response);
}

/**
 * Generate unique session ID for this transaction
 */
String sessionId() {
  return String(DEVICE_ID) + "-" + String(dispenseStartMs);
}

/**
 * Upload receipt to dashboard or queue for retry
 * POST /api/ingest/receipt
 */
void uploadReceiptOrQueue(const char* status, const String& err) {
  uint32_t endU = unixNow();
  uint32_t startU = dispenseStartUnix ? dispenseStartUnix : (dispenseStartMs/1000);
  uint32_t endUnix = endU ? endU : (millis()/1000);
  uint32_t durSec = (millis() - dispenseStartMs) / 1000;
  float totalAmount = dispensedLiters * price.sell;

  StaticJsonDocument<768> doc;
  doc["sessionId"] = sessionId();
  doc["operatorId"] = session.operatorId;  // Send operator ID directly
  doc["operatorPin"] = "";  // PIN already verified, send empty
  doc["targetLiters"] = targetLiters;
  doc["dispensedLiters"] = dispensedLiters;
  doc["durationSec"] = (int)durSec;
  doc["status"] = status;
  if (err.length()) doc["errorMessage"] = err;
  doc["startedAtUnix"] = startU;
  doc["endedAtUnix"] = endUnix;

  String body;
  serializeJson(doc, body);
  
  String response;
  if (!httpPostJson("/api/ingest/receipt", body, response)) {
    qPush(body);  // Queue for retry if network fails
  }
}

/**
 * Retry queued receipts
 */
void retryQueuedReceipts() {
  if (WiFi.status() != WL_CONNECTED) return;
  String item;
  if (!qPeek(item)) return;
  String response;
  if (httpPostJson("/api/ingest/receipt", item, response)) {
    qPop();
  }
}

// ========================= FLOW UPDATE =========================
void updateFlow() {
  uint32_t now = millis();
  if (now - lastFlowMs < 500) return;

  uint32_t p;
  noInterrupts();
  p = flowPulses;
  interrupts();

  uint32_t dp = p - lastPulseSnapshot;
  lastPulseSnapshot = p;

  float liters = (pulsesPerLiter > 0.1f) ? (dp / pulsesPerLiter) : 0.0f;

  if (state == DISPENSING) dispensedLiters += liters;
  litersTotal += liters;

  float dtMin = (now - lastFlowMs) / 60000.0f;
  flowLpm = (dtMin > 0) ? (liters / dtMin) : 0;

  lastFlowMs = now;

  // Dry-run protection: stop pump if no flow detected for 10 seconds
  if (state == DISPENSING && pumpOn()) {
    if (flowLpm < 0.01f) {
      if (noFlowStartMs == 0) noFlowStartMs = now;
      if (now - noFlowStartMs > 10000) {
        pumpSet(false);
        lastError = "DRY RUN: no flow";
        state = ERROR_STATE;
      }
    } else {
      noFlowStartMs = 0;
    }
  } else {
    noFlowStartMs = 0;
  }
}

// ========================= WIFI + TIME =========================
void connectWiFi() {
  if (String(WIFI_SSID).length() == 0) return;

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 10000) {
    delay(200);
  }

  if (WiFi.status() == WL_CONNECTED) {
    // Sync time via NTP
    configTime(0, 0, "pool.ntp.org", "time.google.com", "time.nist.gov");
    
    // Fetch current pricing from dashboard
    fetchPriceFromDashboard();
  }
}

// ========================= SETUP =========================
void setup() {
  Serial.begin(115200);
  Serial.println("\n[ESP32] Oil Dispenser Starting...");

  // Initialize pump (OFF)
  pinMode(PIN_PUMP, OUTPUT);
  pumpSet(false);

  // Initialize flow sensor interrupt
  pinMode(PIN_FLOW, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_FLOW), onFlowPulse, RISING);

  // Initialize display
  tft.init();
  tft.setRotation(1);
  tft.fillScreen(TFT_BLACK);
  tft.setTextColor(TFT_WHITE);
  tft.setTextSize(2);
  tft.setCursor(10, 100);
  tft.println("Starting...");

  // Load settings from NVS
  loadSettings();

  // Connect WiFi
  connectWiFi();

  // Clear session
  clearSession();

  Serial.println("[ESP32] Ready");
}

// ========================= MAIN LOOP =========================
uint32_t holdAStart = 0;
bool holdingA = false;

void loop() {
  // Update flow meter
  updateFlow();

  // Periodic telemetry (every 10 seconds)
  if (millis() - lastTelemetryMs > TELEMETRY_MS) {
    lastTelemetryMs = millis();
    sendTelemetry();
  }

  // Retry queued receipts
  if (millis() - lastReceiptRetryMs > RETRY_MS) {
    lastReceiptRetryMs = millis();
    retryQueuedReceipts();
  }

  // UI refresh
  if (millis() - lastUiMs > UI_MS) {
    lastUiMs = millis();
    switch (state) {
      case IDLE:           uiIdle(); break;
      case ENTER_PIN:      uiEnterPin(); break;
      case VERIFYING_PIN:  uiVerifyingPin(); break;
      case ENTER_LITERS:   uiEnterLiters(); break;
      case CONFIRM_READY:  uiConfirmReady(); break;
      case DISPENSING:     uiDispense(); break;
      case PAUSED:         uiPaused(); break;
      case COMPLETING:     uiCompleting(); break;
      case RECEIPT:        uiReceipt(); break;
      case ERROR_STATE:    uiError(); break;
      case ADMIN:
        if (am == AMENU) uiAdminMenu();
        else if (am == A_SELL) uiAdminInput("Enter SELL price (e.g 23.5)");
        else if (am == A_COST) uiAdminInput("Enter COST price (e.g 18.0)");
        else if (am == A_CAL)  uiAdminInput("Enter pulsesPerLiter");
        break;
    }
  }

  // Keypad handling
  char k = keypad.getKey();
  if (k) {
    // Admin hold detection: pressing A in IDLE starts hold timer
    if (state == IDLE && k == 'A') {
      if (!holdingA) {
        holdingA = true;
        holdAStart = millis();
      }
    } else if (k != 'A') {
      holdingA = false;
    }

    // ========== IDLE STATE ==========
    if (state == IDLE) {
      if (k == 'A') {
        // Short press A: Start login (handled after hold check)
      }
    }

    // ========== ENTER PIN STATE ==========
    else if (state == ENTER_PIN) {
      if (k >= '0' && k <= '9') {
        if (pinBuf.length() < 8) pinBuf += k;
      } else if (k == '*') {
        // Cancel, return to IDLE
        clearSession();
        state = IDLE;
      } else if (k == '#') {
        // Confirm PIN, verify with dashboard
        if (pinBuf.length() < 4) {
          lastError = "PIN too short";
          state = ERROR_STATE;
        } else {
          state = VERIFYING_PIN;
          uiVerifyingPin();
          
          if (verifyOperatorPin(pinBuf)) {
            // Success! Fetch price and go to liters entry
            fetchPriceFromDashboard();
            litersBuf = "";
            state = ENTER_LITERS;
          } else {
            // Failed
            state = ERROR_STATE;
          }
        }
      }
    }

    // ========== ENTER LITERS STATE ==========
    else if (state == ENTER_LITERS) {
      if (k >= '0' && k <= '9') {
        if (litersBuf.length() < 6) litersBuf += k;
      } else if (k == '*') {
        // Cancel, logout operator
        clearSession();
        state = IDLE;
      } else if (k == '#') {
        // Confirm liters
        targetLiters = litersBuf.toFloat();
        if (targetLiters <= 0) {
          lastError = "Invalid liters";
          state = ERROR_STATE;
        } else if (price.sell <= 0) {
          lastError = "No price set";
          state = ERROR_STATE;
        } else {
          state = CONFIRM_READY;
        }
      }
    }

    // ========== CONFIRM READY STATE ==========
    else if (state == CONFIRM_READY) {
      if (k == '*') {
        // Cancel, logout operator
        clearSession();
        state = IDLE;
      } else if (k == 'D') {
        // Start dispensing
        dispensedLiters = 0.0f;
        noFlowStartMs = 0;
        dispenseStartMs = millis();
        dispenseStartUnix = unixNow();
        pumpSet(true);
        state = DISPENSING;
      }
    }

    // ========== DISPENSING STATE ==========
    else if (state == DISPENSING) {
      if (k == '*') {
        // Emergency stop
        pumpSet(false);
        state = PAUSED;
      }
    }

    // ========== PAUSED STATE ==========
    else if (state == PAUSED) {
      if (k == '#') {
        // Resume dispensing
        pumpSet(true);
        state = DISPENSING;
      } else if (k == '*') {
        // Cancel sale completely
        pumpSet(false);
        uploadReceiptOrQueue("CANCELED", "User canceled");
        clearSession();
        state = IDLE;
      }
    }

    // ========== RECEIPT STATE ==========
    else if (state == RECEIPT) {
      if (k == '#') {
        // Finish, auto-logout, return to IDLE
        clearSession();
        state = IDLE;
      }
    }

    // ========== ERROR STATE ==========
    else if (state == ERROR_STATE) {
      if (k == '#') {
        lastError = "";
        clearSession();
        state = IDLE;
      }
    }

    // ========== ADMIN MODE ==========
    if (state == ADMIN) {
      if (am == AMENU) {
        if (k == '*') {
          state = IDLE;
          am = AMENU;
          adminBuf = "";
        } else if (k == 'A') {
          am = A_SELL;
          adminBuf = "";
        } else if (k == 'B') {
          am = A_COST;
          adminBuf = "";
        } else if (k == 'C') {
          am = A_CAL;
          adminBuf = "";
        }
      } else {
        if (k >= '0' && k <= '9') {
          if (adminBuf.length() < 10) adminBuf += k;
        } else if (k == '*') {
          am = AMENU;
          adminBuf = "";
        } else if (k == '#') {
          float v = adminBuf.toFloat();
          if (am == A_SELL) {
            if (v >= 0) price.sell = v;
            savePricing();
          }
          if (am == A_COST) {
            if (v >= 0) price.cost = v;
            savePricing();
          }
          if (am == A_CAL) {
            if (v > 1 && v < 1000000) {
              pulsesPerLiter = v;
              prefs.begin("flow", false);
              prefs.putFloat("ppl", pulsesPerLiter);
              prefs.end();
            }
          }
          am = AMENU;
          adminBuf = "";
        }
      }
    }
  }

  // Check for hold A -> admin mode OR short press A -> login
  if (holdingA && state == IDLE) {
    if (millis() - holdAStart > 1500) {
      // Long hold: enter admin
      holdingA = false;
      holdAStart = 0;
      state = ADMIN;
      am = AMENU;
      adminBuf = "";
    }
  }
  
  // Short press A detection (key released)
  if (!holdingA && holdAStart > 0 && state == IDLE) {
    if (millis() - holdAStart >= 50 && millis() - holdAStart < 1500) {
      // Short press: start login
      pinBuf = "";
      state = ENTER_PIN;
    }
    holdAStart = 0;
  }

  // Auto-stop when target liters reached
  if (state == DISPENSING) {
    if (dispensedLiters >= targetLiters) {
      pumpSet(false);
      state = COMPLETING;
      uiCompleting();
      uploadReceiptOrQueue("DONE", "");
      state = RECEIPT;
    }
  }
}
