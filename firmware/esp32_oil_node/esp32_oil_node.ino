/********************************************************************
 * ESP32 OIL DISPENSER - FINAL PRODUCTION FIRMWARE (ESP32 CORE 3.x)
 ********************************************************************/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <Keypad.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <ArduinoJson.h>
#include "mbedtls/sha256.h"

/* ================= DEVICE / DASHBOARD ================= */
#define DEVICE_ID     "OIL-0007"
#define SITE_NAME     "GreenBean Cafe"
#define API_BASE_URL  "https://fleet-oil-system.vercel.app"
#define API_KEY       "REDACTED"

/* ================= WIFI ================= */
const char* WIFI_SSID = "deborah-my-wife";
const char* WIFI_PASS = "admin@29";

/* ================= PRICING ================= */
// SINGLE SOURCE OF TRUTH FOR PRICING
#define PRICE_PER_ML        0.045f   // K per milliliter (source of truth)
#define STOP_MARGIN_LITERS  0.005f   // 5ml max margin (regulatory limit)

// Extra oil to dispense for small amounts (to account for pipe/hose volume)
// This compensates for oil still in the pipe when pump stops
#define SMALL_AMOUNT_THRESHOLD_ML  500.0f   // Amounts under 500ml get bonus
#define SMALL_AMOUNT_BONUS_ML      30.0f    // Extra 30ml for small purchases

/* ================= ADMIN CREDENTIALS ================= */
#define ADMIN_CODE     "0000"
#define ADMIN_PIN      "1234"
#define MAX_USERS      20

/* ================= HARDWARE ================= */
#define PIN_PUMP   23
#define PIN_FLOW   34
// Optional cabinet tamper switch (normally-closed to GND, opens on tamper)
// Wire to PIN_TAMPER or tie to GND if unused
#define PIN_TAMPER 35

/* ================= RELAY (PUMP CONTROL) ================= */
// Set to true if relay clicks ON when GPIO is LOW (most opto-isolated modules)
// Set to false if relay clicks ON when GPIO is HIGH
#define RELAY_ACTIVE_LOW true

bool pumpState = false;  // Track pump state to avoid constant GPIO writes

void pumpOff() {
  Serial.printf("[PUMP] pumpOff() called, pumpState=%d\n", pumpState);
  // Always write to GPIO to ensure relay turns off
  digitalWrite(PIN_PUMP, RELAY_ACTIVE_LOW ? HIGH : LOW);
  if (pumpState) {
    pumpState = false;
    Serial.println("[PUMP] OFF - relay should release");
  }
}

void pumpOn() {
  Serial.printf("[PUMP] pumpOn() called, pumpState=%d\n", pumpState);
  if (!pumpState) {
    digitalWrite(PIN_PUMP, RELAY_ACTIVE_LOW ? LOW : HIGH);
    pumpState = true;
    Serial.println("[PUMP] ON - relay should click");
  }
}

// Force pump off regardless of state (for boot/emergency)
void pumpForceOff() {
  digitalWrite(PIN_PUMP, RELAY_ACTIVE_LOW ? HIGH : LOW);
  pumpState = false;
  Serial.println("[PUMP] FORCE OFF");
}

/* ================= LED CONFIG ================= */
#define PIN_LED_RED     4
#define PIN_LED_GREEN   16
#define PIN_LED_YELLOW  17

void ledsIdle() {
  digitalWrite(PIN_LED_RED, HIGH);
  digitalWrite(PIN_LED_GREEN, LOW);
  digitalWrite(PIN_LED_YELLOW, LOW);
}

void ledsDispensing() {
  digitalWrite(PIN_LED_RED, LOW);
  digitalWrite(PIN_LED_GREEN, HIGH);
  digitalWrite(PIN_LED_YELLOW, LOW);
}

void ledsError() {
  digitalWrite(PIN_LED_RED, LOW);
  digitalWrite(PIN_LED_GREEN, LOW);
  digitalWrite(PIN_LED_YELLOW, HIGH);
}

/* ================= LCD ================= */
LiquidCrystal_I2C lcd(0x27, 16, 2);

/* ================= SCROLLING TEXT ================= */
String scrollText = "  WELCOME PIMISHA  ";
int scrollPos = 0;
unsigned long lastScrollMs = 0;

void scrollWelcome() {
  if (millis() - lastScrollMs >= 300) {
    lastScrollMs = millis();
    lcd.setCursor(0, 0);
    String display = scrollText.substring(scrollPos, scrollPos + 16);
    if (display.length() < 16) {
      display += scrollText.substring(0, 16 - display.length());
    }
    lcd.print(display);
    scrollPos++;
    if (scrollPos >= scrollText.length()) scrollPos = 0;
  }
}

/* ================= KEYPAD ================= */
const byte ROWS = 4, COLS = 4;
char keys[ROWS][COLS] = {
  {'D','C','B','A'},
  {'#','9','6','3'},
  {'0','8','5','2'},
  {'*','7','4','1'}
};
byte rowPins[ROWS] = {13, 12, 14, 27};
byte colPins[COLS] = {26, 25, 33, 32};
Keypad keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

/* ================= STORAGE ================= */
Preferences prefs;

/* ================= FLOW ================= */
volatile uint32_t flowPulses = 0;
float pulsesPerLiter = 450.0f;
float dispensedLiters = 0;
uint32_t lastPulse = 0;
uint32_t lastFlowMs = 0;
void IRAM_ATTR onFlowPulse() { flowPulses++; }

/* ================= SESSION ================= */
enum Role { OPERATOR, SUPERVISOR, ADMIN };
enum State {
  ST_LOGIN_CODE,
  ST_LOGIN_PIN,
  ST_MENU,
  ST_AMOUNT,
  ST_READY,
  ST_DISPENSING,
  ST_ADMIN_MENU,
  ST_ADD_USER_CODE,
  ST_ADD_USER_PIN,
  ST_ADD_USER_ROLE,
  ST_DELETE_USER,
  ST_LIST_USERS,
  ST_CALIBRATE
};

State state = ST_LOGIN_CODE;
Role currentRole = OPERATOR;
String newUserCode = "";
String newUserPin = "";
int listUserIdx = 0;

struct Session {
  bool loggedIn = false;
  String code = "";
  Role role = OPERATOR;
} session;

/* ================= VARS ================= */
String inputBuf = "";
String loginCode = "";
float amountZmw = 0;
float targetLiters = 0;

// Dynamic pricing (always derive per-ml)
float pricePerMl = PRICE_PER_ML; // Source of truth
bool calibrationMode = false;
unsigned long lastConfigFetchMs = 0;
String siteNameRuntime = SITE_NAME;

// Time sync (Unix time) and per-sale session locking
long long unixTimeOffsetMs = 0;   // unixMs ≈ millis() + offset
bool hasTimeSync = false;
String currentSessionId = "";
unsigned long sessionStartMs = 0;
float sessionTargetLiters = 0.0f;
float sessionPricePerMl = PRICE_PER_ML;
unsigned long sessionCounter = 0;
String lastLoginPin = "";

// Tamper detection
bool tamperLatched = false;

/* ================= NETWORK ================= */
WiFiClientSecure secureClient;
bool isOnline = false;

/* ================= RECEIPT QUEUE ================= */
#define QMAX 10
void queueReceipt(const String& body) {
  prefs.begin("queue", false);
  int h = prefs.getInt("h", 0);
  int t = prefs.getInt("t", 0);
  prefs.putString(("r" + String(h % QMAX)).c_str(), body);
  prefs.putInt("h", h + 1);
  if (h - t >= QMAX) prefs.putInt("t", t + 1);
  prefs.end();
}

void resendQueue() {
  if (!isOnline) return;
  prefs.begin("queue", true);
  int h = prefs.getInt("h", 0);
  int t = prefs.getInt("t", 0);
  if (h == t) { prefs.end(); return; }
  String body = prefs.getString(("r" + String(t % QMAX)).c_str(), "");
  prefs.end();

  HTTPClient http;
  secureClient.setInsecure();
  http.begin(secureClient, String(API_BASE_URL) + "/api/ingest/receipt");
  http.setTimeout(3000);  // 3 second timeout for responsiveness
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-id", DEVICE_ID);
  http.addHeader("x-api-key", API_KEY);
  int code = http.POST(body);
  http.end();

  if (code >= 200 && code < 300) {
    prefs.begin("queue", false);
    prefs.putInt("t", t + 1);
    prefs.end();
  }
}

/* ================= SEND RECEIPT TO DASHBOARD ================= */
// Send receipt with new structure and cross-check logic
void sendReceiptV2(float amountRequestedZmw, float targetMlCalculated, float dispensedMlActual, float pricePerMl, float pulsesPerLiter, float stopMarginLiters) {
  // Compute actual amount and difference
  float amountCalculatedZmw = dispensedMlActual * pricePerMl;
  float differenceZmw = fabs(amountCalculatedZmw - amountRequestedZmw);
  const float MISMATCH_THRESHOLD = 1.00f;
  const float OVERSHOOT_LIMIT_ML = 5.0f;
  const char* status = (differenceZmw > MISMATCH_THRESHOLD) ? "MISMATCH" : "OK";

  // Clamp overshoot (never give more than 5ml extra)
  if (dispensedMlActual > targetMlCalculated + OVERSHOOT_LIMIT_ML) {
    dispensedMlActual = targetMlCalculated + OVERSHOOT_LIMIT_ML;
    amountCalculatedZmw = dispensedMlActual * pricePerMl;
    differenceZmw = fabs(amountCalculatedZmw - amountRequestedZmw);
  }

  // If mismatch, blink yellow LED rapidly and log
  if (differenceZmw > MISMATCH_THRESHOLD) {
    Serial.println("[DISPENSE_MISMATCH] Dispensed value does not match paid amount!");
    Serial.printf("[DISPENSE_MISMATCH] Paid: %.2f, Actual: %.2f, Diff: %.2f\n", amountRequestedZmw, amountCalculatedZmw, differenceZmw);
    // Blink yellow LED rapidly (non-blocking)
    for (int i = 0; i < 10; ++i) {
      digitalWrite(PIN_LED_YELLOW, HIGH); delay(80);
      digitalWrite(PIN_LED_YELLOW, LOW); delay(80);
    }
  }

  // Build receipt JSON
  StaticJsonDocument<512> doc;
  doc["amountRequestedZmw"] = amountRequestedZmw;
  doc["targetMlCalculated"] = targetMlCalculated;
  doc["dispensedMlActual"] = dispensedMlActual;
  doc["amountCalculatedZmw"] = amountCalculatedZmw;
  doc["pricePerMl"] = pricePerMl;
  doc["differenceZmw"] = differenceZmw;
  doc["status"] = status;
  doc["pulsesPerLiter"] = pulsesPerLiter;
  doc["stopMarginLiters"] = stopMarginLiters;
  doc["deviceId"] = DEVICE_ID;
  doc["siteName"] = siteNameRuntime;
  doc["operatorCode"] = loginCode;
  doc["sessionId"] = currentSessionId;
  doc["operatorPin"] = lastLoginPin;

  String body;
  serializeJson(doc, body);
  Serial.println("[RECEIPT] " + body);

  if (isOnline) {
    HTTPClient http;
    secureClient.setInsecure();
    http.begin(secureClient, String(API_BASE_URL) + "/api/ingest/receipt");
    http.setTimeout(3000);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("x-device-id", DEVICE_ID);
    http.addHeader("x-api-key", API_KEY);
    int code = http.POST(body);
    Serial.printf("[HTTP] Receipt response: %d\n", code);
    http.end();
    if (code < 200 || code >= 300) {
      queueReceipt(body);
    }
  } else {
    queueReceipt(body);
  }
}

/* ================= HEARTBEAT TO DASHBOARD ================= */
unsigned long lastHeartbeat = 0;

void sendHeartbeat() {
  if (!isOnline) return;
  if (millis() - lastHeartbeat < 30000) return;  // Every 30 seconds
  lastHeartbeat = millis();
  
  StaticJsonDocument<256> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["siteName"] = siteNameRuntime;
  doc["status"] = (state == ST_DISPENSING) ? "dispensing" : "idle";
  doc["uptime"] = millis() / 1000;
  
  String body;
  serializeJson(doc, body);
  
  HTTPClient http;
  secureClient.setInsecure();
  http.begin(secureClient, String(API_BASE_URL) + "/api/ingest/heartbeat");
  http.setTimeout(3000);  // 3 second timeout for responsiveness
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-id", DEVICE_ID);
  http.addHeader("x-api-key", API_KEY);
  int code = http.POST(body);
  Serial.printf("[HEARTBEAT] Response: %d\n", code);
  http.end();
}

/* ================= HELPERS ================= */
void lcdShow(const String& a, const String& b = "") {
  lcd.clear();
  lcd.setCursor(0, 0); lcd.print(a.substring(0, 16));
  lcd.setCursor(0, 1); lcd.print(b.substring(0, 16));
}

float round2(float v) {
  long scaled = (long)(v * 100.0f + 0.5f);
  return scaled / 100.0f;
}

void sendTamperEvent() {
  StaticJsonDocument<256> doc;
  long long tsMs;
  if (hasTimeSync) {
    tsMs = unixTimeOffsetMs + (long long)millis();
  } else {
    tsMs = (long long)millis();
  }
  doc["ts"] = tsMs;
  doc["type"] = "TAMPER_OPEN";
  doc["severity"] = "CRITICAL";
  doc["message"] = "Cabinet tamper switch opened";

  String body;
  serializeJson(doc, body);

  HTTPClient http;
  secureClient.setInsecure();
  http.begin(secureClient, String(API_BASE_URL) + "/api/ingest/event");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-id", DEVICE_ID);
  http.addHeader("x-api-key", API_KEY);
  int code = http.POST(body);
  Serial.printf("[TAMPER] Event response: %d\n", code);
  http.end();
}

void checkTamper() {
  static unsigned long lastTamperCheck = 0;
  unsigned long now = millis();
  if (now - lastTamperCheck < 50) return;  // simple debounce
  lastTamperCheck = now;

  int val = digitalRead(PIN_TAMPER);
  if (val == HIGH && !tamperLatched) {
    // Tamper triggered (cabinet open)
    tamperLatched = true;
    pumpOff();  // SAFETY: Immediate pump shutoff on tamper
    ledsError();

    if (isOnline) {
      sendTamperEvent();
    }

    // Force logout and show alarm
    state = ST_LOGIN_CODE;
    inputBuf = "";
    amountZmw = 0;
    dispensedLiters = 0;
    lcdShow("TAMPER", "CABINET OPEN");
  }
}

/* ================= DEVICE CONFIG (PRICE / DISPLAY / WIFI) ================= */
// Store WiFi credentials received from dashboard
String storedWifiSsid = "";
String storedWifiPassword = "";
unsigned long lastWifiUpdateTs = 0;

void fetchDeviceConfig() {
  if (!isOnline) return;
  const unsigned long CONFIG_REFRESH_INTERVAL_MS = 60000; // 60s
  unsigned long now = millis();
  if (lastConfigFetchMs != 0 && (now - lastConfigFetchMs) < CONFIG_REFRESH_INTERVAL_MS) return;
  lastConfigFetchMs = now;

  HTTPClient http;
  secureClient.setInsecure();
  http.begin(secureClient, String(API_BASE_URL) + "/api/device/config");
  http.setTimeout(3000);  // 3 second timeout for responsiveness
  http.addHeader("x-device-id", DEVICE_ID);
  http.addHeader("x-api-key", API_KEY);
  int code = http.GET();
  if (code != 200) {
    http.end();
    Serial.printf("[CONFIG] HTTP %d\n", code);
    return;
  }

  String body = http.getString();
  http.end();

  StaticJsonDocument<768> doc;
  DeserializationError err = deserializeJson(doc, body);
  if (err) {
    Serial.println("[CONFIG] JSON parse error");
    return;
  }

  float newPricePerLiter = doc["price"]["pricePerLiter"] | 0.0f;
  if (newPricePerLiter > 0.0f) {
    activePricePerLiter = newPricePerLiter;
    pricePerMl = newPricePerLiter / 1000.0f;
    Serial.printf("[CONFIG] Price %.2f ZMW/L\n", newPricePerLiter);
  }

  const char* newSite = doc["siteName"]; 
  if (newSite && strlen(newSite) > 0) {
    siteNameRuntime = String(newSite);
  }

  // Sync approximate Unix time for price-by-date and reporting
  long long serverTs = doc["timestamp"] | 0LL;  // ms since epoch from backend
  if (serverTs > 0) {
    unixTimeOffsetMs = serverTs - (long long)millis();
    hasTimeSync = true;
    Serial.printf("[CONFIG] Time sync offset=%lld ms\n", unixTimeOffsetMs);
  }

  // Check for WiFi credentials update from dashboard
  const char* wifiSsid = doc["wifi"]["ssid"];
  const char* wifiPass = doc["wifi"]["password"];
  unsigned long wifiUpdatedAt = doc["wifi"]["updatedAt"] | 0UL;
  
  if (wifiSsid && strlen(wifiSsid) > 0 && wifiUpdatedAt > lastWifiUpdateTs) {
    storedWifiSsid = String(wifiSsid);
    storedWifiPassword = wifiPass ? String(wifiPass) : "";
    lastWifiUpdateTs = wifiUpdatedAt;
    
    // Save to Preferences for next boot
    prefs.begin("wifi", false);
    prefs.putString("ssid", storedWifiSsid);
    prefs.putString("pass", storedWifiPassword);
    prefs.putULong("updated", lastWifiUpdateTs);
    prefs.end();
    
    Serial.printf("[CONFIG] New WiFi received: %s (will use on next boot)\n", wifiSsid);
    
    // Show notification on LCD
    lcdShow("NEW WIFI SAVED", storedWifiSsid.substring(0, 16));
    delay(2000);
    lcdShow("SYSTEM RUNNING", "ENTER CODE");
  }
}

String sha256(const String& s) {
  byte hash[32];
  char out[65];
  mbedtls_sha256_context ctx;
  mbedtls_sha256_init(&ctx);
  mbedtls_sha256_starts(&ctx, 0);
  mbedtls_sha256_update(&ctx, (const unsigned char*)s.c_str(), s.length());
  mbedtls_sha256_finish(&ctx, hash);
  mbedtls_sha256_free(&ctx);
  for (int i = 0; i < 32; i++) sprintf(out + i * 2, "%02x", hash[i]);
  out[64] = 0;
  return String(out);
}

/* ================= USER MANAGEMENT ================= */
int getUserCount() {
  prefs.begin("users", true);
  int count = prefs.getInt("count", 0);
  prefs.end();
  return count;
}

/* ================= USER SYNC QUEUE ================= */
void queueUserSync(const String& body) {
  prefs.begin("usync", false);
  int h = prefs.getInt("h", 0);
  int t = prefs.getInt("t", 0);
  prefs.putString(("u" + String(h % 10)).c_str(), body);
  prefs.putInt("h", h + 1);
  if (h - t >= 10) prefs.putInt("t", t + 1);
  prefs.end();
  Serial.println("[QUEUE] User sync queued");
}

void resendUserSyncQueue() {
  if (!isOnline) return;
  prefs.begin("usync", true);
  int h = prefs.getInt("h", 0);
  int t = prefs.getInt("t", 0);
  if (h == t) { prefs.end(); return; }
  String body = prefs.getString(("u" + String(t % 10)).c_str(), "");
  prefs.end();
  
  if (body.length() == 0) return;

  HTTPClient http;
  secureClient.setInsecure();
  http.begin(secureClient, String(API_BASE_URL) + "/api/ingest/operator");
  http.setTimeout(3000);  // 3 second timeout for responsiveness
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-id", DEVICE_ID);
  http.addHeader("x-api-key", API_KEY);
  int httpCode = http.POST(body);
  http.end();

  if (httpCode >= 200 && httpCode < 300) {
    prefs.begin("usync", false);
    prefs.putInt("t", t + 1);
    prefs.end();
    Serial.println("[QUEUE] User sync sent successfully");
  }
}

/* ================= SYNC USER TO DASHBOARD ================= */
void syncUserToDashboard(const String& code, const String& pin, Role role, bool isDelete) {
  StaticJsonDocument<256> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["siteName"] = SITE_NAME;
  doc["operatorCode"] = code;
  doc["pin"] = pin;  // Send hashed in production
  doc["role"] = (role == SUPERVISOR) ? "supervisor" : "operator";
  doc["action"] = isDelete ? "delete" : "add";
  doc["timestamp"] = millis();
  
  String body;
  serializeJson(doc, body);
  
  Serial.println("[USER_SYNC] " + body);
  
  if (isOnline) {
    HTTPClient http;
    secureClient.setInsecure();
    http.begin(secureClient, String(API_BASE_URL) + "/api/ingest/operator");
    http.setTimeout(3000);  // 3 second timeout for responsiveness
    http.addHeader("Content-Type", "application/json");
    http.addHeader("x-device-id", DEVICE_ID);
    http.addHeader("x-api-key", API_KEY);
    int httpCode = http.POST(body);
    Serial.printf("[HTTP] User sync response: %d\n", httpCode);
    http.end();
    
    if (httpCode < 200 || httpCode >= 300) {
      queueUserSync(body);
    }
  } else {
    queueUserSync(body);
  }
}

bool addUser(const String& code, const String& pin, Role role) {
  prefs.begin("users", false);
  int count = prefs.getInt("count", 0);
  if (count >= MAX_USERS) {
    prefs.end();
    return false;
  }
  // Check if code already exists
  for (int i = 0; i < count; i++) {
    String existingCode = prefs.getString(("c" + String(i)).c_str(), "");
    if (existingCode == code) {
      prefs.end();
      return false;  // Code already exists
    }
  }
  // Store new user
  prefs.putString(("c" + String(count)).c_str(), code);
  prefs.putString(("p" + String(count)).c_str(), pin);
  prefs.putInt(("r" + String(count)).c_str(), (int)role);
  prefs.putInt("count", count + 1);
  prefs.end();
  Serial.printf("[USER] Added: %s role=%d\n", code.c_str(), role);
  
  // Sync to dashboard
  syncUserToDashboard(code, pin, role, false);
  
  return true;
}

bool deleteUser(const String& code) {
  prefs.begin("users", false);
  int count = prefs.getInt("count", 0);
  int foundIdx = -1;
  Role deletedRole = OPERATOR;
  for (int i = 0; i < count; i++) {
    if (prefs.getString(("c" + String(i)).c_str(), "") == code) {
      foundIdx = i;
      deletedRole = (Role)prefs.getInt(("r" + String(i)).c_str(), 0);
      break;
    }
  }
  if (foundIdx < 0) {
    prefs.end();
    return false;
  }
  // Shift all users down
  for (int i = foundIdx; i < count - 1; i++) {
    prefs.putString(("c" + String(i)).c_str(), prefs.getString(("c" + String(i+1)).c_str(), ""));
    prefs.putString(("p" + String(i)).c_str(), prefs.getString(("p" + String(i+1)).c_str(), ""));
    prefs.putInt(("r" + String(i)).c_str(), prefs.getInt(("r" + String(i+1)).c_str(), 0));
  }
  prefs.putInt("count", count - 1);
  prefs.end();
  
  // Sync deletion to dashboard
  syncUserToDashboard(code, "", deletedRole, true);
  
  return true;
}

bool verifyUser(const String& code, const String& pin, Role& outRole) {
  // Check admin first
  if (code == ADMIN_CODE && pin == ADMIN_PIN) {
    outRole = ADMIN;
    return true;
  }
  // Check stored users
  prefs.begin("users", true);
  int count = prefs.getInt("count", 0);
  for (int i = 0; i < count; i++) {
    String storedCode = prefs.getString(("c" + String(i)).c_str(), "");
    String storedPin = prefs.getString(("p" + String(i)).c_str(), "");
    if (storedCode == code && storedPin == pin) {
      outRole = (Role)prefs.getInt(("r" + String(i)).c_str(), 0);
      prefs.end();
      return true;
    }
  }
  prefs.end();
  return false;
}

String getUserAtIndex(int idx, Role& outRole) {
  prefs.begin("users", true);
  int count = prefs.getInt("count", 0);
  if (idx < 0 || idx >= count) {
    prefs.end();
    return "";
  }
  String code = prefs.getString(("c" + String(idx)).c_str(), "");
  outRole = (Role)prefs.getInt(("r" + String(idx)).c_str(), 0);
  prefs.end();
  return code;
}

/* ================= LIVE DISPENSE DISPLAY ================= */
void updateDispenseDisplay() {
  static unsigned long lastDispUpdateMs = 0;
  const unsigned long DISP_UPDATE_INTERVAL_MS = 250; // Update every 250ms

  unsigned long now = millis();
  if (now - lastDispUpdateMs < DISP_UPDATE_INTERVAL_MS) return;
  lastDispUpdateMs = now;

  int ml = (int)(dispensedLiters * 1000.0f);
  int targetMl = (int)(targetLiters * 1000.0f);
  
  // Line 1: "DISPENSING..."
  lcd.setCursor(0, 0);
  lcd.print("DISPENSING...   ");
  
  // Line 2: "1234 / 5000 ml"
  String line2 = String(ml) + "/" + String(targetMl) + "ml";
  while (line2.length() < 16) line2 += ' ';
  lcd.setCursor(0, 1);
  lcd.print(line2);
}

/* ================= FLOW ================= */
// Set to true to simulate flow without a real sensor (FOR TESTING ONLY)
#define SIMULATE_FLOW true   // <-- SET TO false FOR PRODUCTION WITH REAL SENSOR
#define SIMULATED_FLOW_RATE 0.05f  // Liters per update (~50ml per 300ms = fast test)

void updateFlow() {
  if (millis() - lastFlowMs < 300) return;
  lastFlowMs = millis();
  
  if (state == ST_DISPENSING) {
    if (SIMULATE_FLOW) {
      // Simulated flow for testing without sensor
      dispensedLiters += SIMULATED_FLOW_RATE;
      Serial.printf("[FLOW-SIM] dispensed=%.3f L, target=%.3f L\n", dispensedLiters, targetLiters);
    } else {
      // Real flow sensor
      uint32_t p;
      noInterrupts(); p = flowPulses; interrupts();
      uint32_t dp = p - lastPulse;
      lastPulse = p;
      dispensedLiters += dp / pulsesPerLiter;
      Serial.printf("[FLOW] pulses=%lu, delta=%lu, dispensed=%.3f L, target=%.3f L\n", p, dp, dispensedLiters, targetLiters);
    }
  }
}

/* ================= SETUP ================= */
void setup() {
  Serial.begin(115200);
  Serial.println("[BOOT] PIMISHA Oil Dispenser");
  Serial.println("[BOOT] Firmware v2.3 - Dashboard WiFi Config");

  pinMode(PIN_PUMP, OUTPUT);
  pumpForceOff();  // CRITICAL: Pump OFF at boot (force regardless of state)

  pinMode(PIN_LED_RED, OUTPUT);
  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_LED_YELLOW, OUTPUT);
  ledsIdle();

  pinMode(PIN_FLOW, INPUT);
  attachInterrupt(digitalPinToInterrupt(PIN_FLOW), onFlowPulse, RISING);

  // Optional tamper switch (normally-closed to GND)
  pinMode(PIN_TAMPER, INPUT_PULLUP);

  Wire.begin(21, 22);
  lcd.init();
  lcd.backlight();

  // Let Keypad.h fully manage keypad GPIO modes
  keypad.setDebounceTime(30);   // ms - reduced for faster response
  keypad.setHoldTime(500);      // ms

  // Load WiFi credentials from Preferences (set by dashboard) or use defaults
  char wifiSsid[64] = "";
  char wifiPass[64] = "";
  prefs.begin("wifi", true);  // read-only
  String storedSsid = prefs.getString("ssid", "");
  String storedPass = prefs.getString("pass", "");
  prefs.end();
  
  if (storedSsid.length() > 0) {
    // Use dashboard-configured WiFi
    storedSsid.toCharArray(wifiSsid, sizeof(wifiSsid));
    storedPass.toCharArray(wifiPass, sizeof(wifiPass));
    Serial.printf("[WIFI] Using dashboard WiFi: %s\n", wifiSsid);
  } else {
    // Fall back to hardcoded defaults
    strncpy(wifiSsid, WIFI_SSID, sizeof(wifiSsid) - 1);
    strncpy(wifiPass, WIFI_PASS, sizeof(wifiPass) - 1);
    Serial.printf("[WIFI] Using default WiFi: %s\n", wifiSsid);
  }

  // WiFi connection with status display
  Serial.printf("[WIFI] Connecting to: %s\n", wifiSsid);
  lcdShow("CONNECTING...", wifiSsid);
  WiFi.begin(wifiSsid, wifiPass);
  
  // Wait up to 10 seconds for connection
  int wifiTimeout = 20;  // 20 x 500ms = 10 seconds
  while (WiFi.status() != WL_CONNECTED && wifiTimeout > 0) {
    delay(500);
    Serial.print(".");
    wifiTimeout--;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.printf("[WIFI] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
    lcdShow("WIFI CONNECTED", WiFi.localIP().toString());
    delay(1500);
  } else {
    Serial.println();
    Serial.printf("[WIFI] Failed to connect to: %s\n", wifiSsid);
    // If dashboard WiFi failed, try fallback to hardcoded defaults
    if (storedSsid.length() > 0) {
      Serial.printf("[WIFI] Trying fallback: %s\n", WIFI_SSID);
      lcdShow("TRYING BACKUP", WIFI_SSID);
      WiFi.begin(WIFI_SSID, WIFI_PASS);
      wifiTimeout = 20;
      while (WiFi.status() != WL_CONNECTED && wifiTimeout > 0) {
        delay(500);
        Serial.print(".");
        wifiTimeout--;
      }
      if (WiFi.status() == WL_CONNECTED) {
        Serial.println();
        Serial.printf("[WIFI] Backup connected! IP: %s\n", WiFi.localIP().toString().c_str());
        lcdShow("WIFI CONNECTED", WiFi.localIP().toString());
        delay(1500);
      } else {
        Serial.println();
        Serial.println("[WIFI] All WiFi connections failed - running OFFLINE");
        lcdShow("WIFI FAILED", "RUNNING OFFLINE");
        delay(2000);
      }
    } else {
      Serial.println("[WIFI] Connection failed - running OFFLINE");
      lcdShow("WIFI FAILED", "RUNNING OFFLINE");
      delay(2000);
    }
  }

  // Load calibrated pulses-per-liter if available
  prefs.begin("calib", true);
  float storedPpl = prefs.getFloat("pulsesPerL", 0.0f);
  prefs.end();
  if (storedPpl > 0.0f) {
    pulsesPerLiter = storedPpl;
    Serial.printf("[CALIB] Using stored pulsesPerLiter=%.2f\n", pulsesPerLiter);
  } else {
    Serial.printf("[CALIB] Using default pulsesPerLiter=%.2f\n", pulsesPerLiter);
  }

  // Show that the system is powered and ready
  lcdShow("SYSTEM RUNNING", "ENTER CODE");
}

/* ================= LOOP ================= */
unsigned long lastKeyTime = 0;
char lastKey = 0;

void loop() {
  isOnline = (WiFi.status() == WL_CONNECTED);
  static unsigned long lastQ = 0;
  static unsigned long lastUserSync = 0;
  if (isOnline && millis() - lastQ > 5000) { resendQueue(); lastQ = millis(); }
  if (isOnline && millis() - lastUserSync > 7000) { resendUserSyncQueue(); lastUserSync = millis(); }
  updateFlow();
  sendHeartbeat();  // Send heartbeat to dashboard
  fetchDeviceConfig();  // Refresh price and site name from dashboard
  checkTamper();   // Tamper detection

  // SAFETY: Pump OFF unless dispensing
  if (state != ST_DISPENSING) {
    pumpOff();
  }

  // Scrolling welcome in menu state
  if (state == ST_MENU) {
    scrollWelcome();
    lcd.setCursor(0, 1);
    lcd.print("ENTER SALE  C=OUT");
  }

  // Dispensing display update (live volume and cost)
  if (state == ST_DISPENSING) {
    updateDispenseDisplay();
    
    // Auto-stop when target reached (normal dispensing only)
    if (!calibrationMode && targetLiters > 0 && dispensedLiters >= (targetLiters - STOP_MARGIN_LITERS)) {
      Serial.println("[AUTO-STOP] Target reached!");
      Serial.printf("[AUTO-STOP] dispensed=%.3f, target=%.3f, margin=%.3f\n", dispensedLiters, targetLiters, STOP_MARGIN_LITERS);
      pumpOff();
      ledsIdle();
      float mlDone = dispensedLiters * 1000.0f;
      float targetMl = targetLiters * 1000.0f;
      sendReceiptV2(amountZmw, targetMl, mlDone, pricePerMl, pulsesPerLiter, STOP_MARGIN_LITERS);
      state = ST_LOGIN_CODE;
      inputBuf = "";
      amountZmw = 0;
      calibrationMode = false;
      lcdShow("DONE", String((int)mlDone) + " ml");
      delay(2000);
      lcdShow("SYSTEM RUNNING", "ENTER CODE");
    }
  }

  char k = keypad.getKey();
  if (k == NO_KEY) return;

  // Validate key is a real keypad character (prevent ghost keys)
  bool validKey = false;
  const char validKeys[] = "0123456789ABCD*#";
  for (int i = 0; i < 16; i++) {
    if (k == validKeys[i]) { validKey = true; break; }
  }
  if (!validKey) {
    Serial.printf("[KEY] INVALID/GHOST: 0x%02X\n", (int)k);
    return;
  }
  
  // Prevent same key repeating too fast (ghost protection)
  if (k == lastKey && (millis() - lastKeyTime) < 50) {
    Serial.printf("[KEY] DEBOUNCE SKIP: %c\n", k);
    return;
  }
  lastKey = k;
  lastKeyTime = millis();

  // === KEY CONFIRMATION LOG ===
  Serial.print("KEY PRESSED: ");
  Serial.println(k);
  Serial.printf("[KEY] char='%c' state=%d\n", k, (int)state);

  // * = EMERGENCY STOP (only when dispensing)
  if (k == '*' && state == ST_DISPENSING) {
    Serial.println("[ESTOP] Emergency stop triggered!");
    pumpOff();  // EMERGENCY: Immediate pump shutoff
    ledsError();
    if (calibrationMode) {
      // Abort calibration without sending a receipt
      calibrationMode = false;
      dispensedLiters = 0;
      lcdShow("CAL ABORTED", "* pressed");
      delay(1500);
      state = ST_ADMIN_MENU;
      lcdShow("ADMIN MENU", "1=ADD 2=DEL 3=LST");
    } else {
      if (dispensedLiters > 0) {
        float mlDone = dispensedLiters * 1000;
        float paid = round2(mlDone * sessionPricePerMl);
        float targetMl = (targetLiters > 0 && targetLiters < 900.0f) ? targetLiters * 1000.0f : 0.0f;
        sendReceipt(mlDone, paid, targetMl, "ERROR");
        state = ST_LOGIN_CODE;
        inputBuf = "";
        amountZmw = 0;
        dispensedLiters = 0;
        lcdShow("E-STOP", String((int)mlDone) + "ml K" + String((int)paid));
      } else {
        state = ST_LOGIN_CODE;
        inputBuf = "";
        amountZmw = 0;
        dispensedLiters = 0;
        lcdShow("!! STOPPED !!", "* pressed");
      }
      delay(1500);
      lcdShow("SYSTEM RUNNING", "ENTER CODE");
    }
    return;
  }

  switch (state) {
    case ST_LOGIN_CODE:
      if (isdigit(k)) { 
        inputBuf += k; 
        lcdShow("CODE", inputBuf); 
      }
      else if (k == '#' && inputBuf.length() > 0) { 
        loginCode = inputBuf; 
        inputBuf = ""; 
        state = ST_LOGIN_PIN; 
        lcdShow("PIN", ""); 
      }
      break;

    case ST_LOGIN_PIN:
      if (isdigit(k)) {
        inputBuf += k;
        String mask = "";
        for (size_t i = 0; i < inputBuf.length(); i++) mask += '*';
        lcdShow("PIN", mask);
      } else if (k == '#' && inputBuf.length() > 0) {
        // Verify user credentials
        Role verifiedRole;
        if (verifyUser(loginCode, inputBuf, verifiedRole)) {
          // If tamper is latched, only ADMIN can clear and proceed
          if (tamperLatched && verifiedRole != ADMIN) {
            lcdShow("TAMPER LOCK", "ADMIN ONLY");
            delay(1500);
            inputBuf = "";
            loginCode = "";
            lcdShow("LOGIN", "ENTER CODE");
            state = ST_LOGIN_CODE;
            break;
          }

          // Successful login (either normal or ADMIN clearing tamper)
          lastLoginPin = inputBuf;  // keep raw PIN in RAM for receipt mapping
          currentRole = verifiedRole;
          inputBuf = "";

          if (tamperLatched && verifiedRole == ADMIN) {
            // ADMIN acknowledges and clears tamper latch
            tamperLatched = false;
            lcdShow("TAMPER CLEARED", "ADMIN OK");
            delay(1500);
          }

          if (verifiedRole == ADMIN) {
            state = ST_ADMIN_MENU;
            lcdShow("ADMIN MENU", "1=ADD 2=DEL 3=LST");
          } else {
            amountZmw = 0;
            state = ST_AMOUNT;
            lcdShow("ENTER AMOUNT", "K 0");
          }
        } else {
          lcdShow("INVALID!", "TRY AGAIN");
          delay(1500);
          inputBuf = "";
          state = ST_LOGIN_CODE;
          lcdShow("LOGIN", "ENTER CODE");
        }
      }
      else if (k == 'C') {
        // Cancel back to code entry
        inputBuf = "";
        state = ST_LOGIN_CODE;
        lcdShow("SYSTEM RUNNING", "ENTER CODE");
      }
      break;

    case ST_MENU:
      if (k == 'A') { 
        amountZmw = 0; 
        state = ST_AMOUNT; 
        lcdShow("ENTER AMOUNT", "K 0"); 
      }
      else if (k == 'C') {
        // C = Cancel/Logout
        state = ST_LOGIN_CODE;
        inputBuf = "";
        lcdShow("SYSTEM RUNNING", "ENTER CODE");
      }
      break;

    case ST_AMOUNT:
      if (isdigit(k)) {
        amountZmw = amountZmw * 10 + (k - '0');
        lcdShow("ENTER AMOUNT", "K " + String((int)amountZmw));
      } 
      else if (k == '#' && amountZmw > 0) {
        if (pricePerMl <= 0.0f) {
          lcdShow("PRICE ERROR", "SET PRICE");
          delay(1500);
          amountZmw = 0;
          state = ST_LOGIN_CODE;
          inputBuf = "";
          lcdShow("SYSTEM RUNNING", "ENTER CODE");
        } else if (pulsesPerLiter <= 0.0f) {
          // Calibration dependency: block dispensing if not calibrated
          lcdShow("CALIBRATION REQ", "ADMIN ONLY");
          delay(2000);
          amountZmw = 0;
          state = ST_LOGIN_CODE;
          inputBuf = "";
          lcdShow("SYSTEM RUNNING", "ENTER CODE");
        } else {
          // Calculate exact target from amount paid (no rounding)
          float targetMlExact = amountZmw / pricePerMl;
          float targetLitersExact = targetMlExact / 1000.0f;
          targetLiters = targetLitersExact;
          state = ST_READY;
          Serial.printf("[AMOUNT] Paid=K%.2f, Target=%.3f ml (%.6f L)\n", amountZmw, targetMlExact, targetLitersExact);
          lcdShow("CONFIRM", "K" + String((int)amountZmw) + "=" + String((int)targetMlExact) + "ml");
          delay(800);
          lcdShow("READY", "PRESS B");
        }
      }
      else if (k == 'C') {
        // Cancel back to login
        amountZmw = 0;
        state = ST_LOGIN_CODE;
        inputBuf = "";
        lcdShow("SYSTEM RUNNING", "ENTER CODE");
      }
      else if (k == '*') {
        // Backspace
        amountZmw = (int)(amountZmw / 10);
        lcdShow("ENTER AMOUNT", "K " + String((int)amountZmw));
      }
      break;

    case ST_READY:
      if (k == 'B') {
        Serial.println("[DISPENSE] ==============================");
        Serial.println("[DISPENSE] START DISPENSING");
        Serial.printf("[DISPENSE] targetLiters=%.4f\n", targetLiters);
        Serial.printf("[DISPENSE] pricePerMl=%.4f\n", pricePerMl);
        Serial.printf("[DISPENSE] amountZmw=%.2f\n", amountZmw);
        
        if (targetLiters <= 0) {
          Serial.println("[DISPENSE] ERROR: targetLiters <= 0, aborting!");
          lcdShow("ERROR", "INVALID TARGET");
          delay(1500);
          state = ST_AMOUNT;
          amountZmw = 0;
          lcdShow("ENTER AMOUNT", "K 0");
          break;
        }
        
        dispensedLiters = 0;
        flowPulses = 0;
        lastPulse = 0;
        // Lock price and session details at start of dispense
        sessionPricePerMl = pricePerMl;
        sessionTargetLiters = targetLiters;
        sessionStartMs = millis();
        sessionCounter++;
        currentSessionId = String(DEVICE_ID) + "-" + String(sessionStartMs) + "-" + String(sessionCounter);
        
        Serial.printf("[DISPENSE] sessionId=%s\n", currentSessionId.c_str());
        Serial.println("[DISPENSE] Activating pump...");
        
        pumpOn();  // START PUMP
        ledsDispensing();
        state = ST_DISPENSING;
        
        Serial.println("[DISPENSE] Pump activated, state=ST_DISPENSING");
        Serial.println("[DISPENSE] ==============================");
        lcdShow("DISPENSING", "0 ml");
      }
      else if (k == 'C') {
        // Cancel back to amount entry (keep value)
        amountZmw = 0;
        state = ST_AMOUNT;
        lcdShow("ENTER AMOUNT", "K 0");
      }
      break;

    case ST_DISPENSING:
      // D already handled above as emergency stop
      if (calibrationMode) {
        // In calibration, '#' finishes 1L run and saves pulsesPerLiter
        if (k == '#') {
          Serial.println("[CAL] Calibration complete");
          pumpOff();  // Stop pump for calibration end
          ledsIdle();
          noInterrupts();
          uint32_t pulses = flowPulses;
          interrupts();
          if (pulses > 0) {
            pulsesPerLiter = (float)pulses;
            prefs.begin("calib", false);
            prefs.putFloat("pulsesPerL", pulsesPerLiter);
            prefs.end();
            lcdShow("CAL DONE", String((int)pulsesPerLiter) + " p/L");
          } else {
            lcdShow("CAL FAILED", "NO PULSES");
          }
          delay(2000);
          calibrationMode = false;
          dispensedLiters = 0;
          state = ST_ADMIN_MENU;
          lcdShow("ADMIN MENU", "1=ADD 2=DEL 3=LST");
        } else if (k == 'C') {
          // Cancel calibration without saving
          Serial.println("[CAL] Calibration cancelled");
          pumpOff();  // Stop pump on calibration cancel
          ledsIdle();
          calibrationMode = false;
          dispensedLiters = 0;
          lcdShow("CAL CANCELLED", "");
          delay(1500);
          state = ST_ADMIN_MENU;
          lcdShow("ADMIN MENU", "1=ADD 2=DEL 3=LST");
        }
      } else {
        // Normal dispensing: C = Cancel dispensing with partial receipt
        if (k == 'C') {
          Serial.println("[DISPENSE] Cancelled by user");
          pumpOff();  // Stop pump on user cancel
          ledsError();
          float mlDone = dispensedLiters * 1000;
          float paid = round2(mlDone * sessionPricePerMl);
          float targetMl = (targetLiters > 0 && targetLiters < 900.0f) ? targetLiters * 1000.0f : 0.0f;
          if (mlDone > 0) sendReceipt(mlDone, paid, targetMl, "CANCELED");  // Send partial receipt
          lcdShow("CANCELLED", String((int)mlDone) + "ml K" + String((int)paid));
          delay(1500);
          state = ST_MENU;
          scrollPos = 0;
          amountZmw = 0;
        }
      }
      break;

    /* ================= ADMIN MENU STATES ================= */
    case ST_ADMIN_MENU:
      if (k == '1') {
        // Add new user
        newUserCode = "";
        newUserPin = "";
        state = ST_ADD_USER_CODE;
        lcdShow("NEW USER CODE", "");
      }
      else if (k == '2') {
        // Delete user
        inputBuf = "";
        state = ST_DELETE_USER;
        lcdShow("DELETE USER", "ENTER CODE:");
      }
      else if (k == '3') {
        // List users
        listUserIdx = 0;
        state = ST_LIST_USERS;
        Role r;
        String code = getUserAtIndex(0, r);
        if (code.length() > 0) {
          String roleStr = (r == SUPERVISOR) ? "SUP" : "OPR";
          lcdShow("1:" + code, roleStr + " */# NAV C=BACK");
        } else {
          lcdShow("NO USERS", "C=BACK");
        }
      }
      else if (k == '4') {
        // Calibration menu (admin only)
        calibrationMode = true;
        dispensedLiters = 0;
        flowPulses = 0;
        lastPulse = 0;
        state = ST_CALIBRATE;
        lcdShow("CAL 1L READY", "B=START C=BACK");
      }
      else if (k == 'A') {
        // Go to dispense menu
        state = ST_MENU;
        scrollPos = 0;
      }
      else if (k == 'C') {
        // Logout
        state = ST_LOGIN_CODE;
        inputBuf = "";
        lcdShow("SYSTEM RUNNING", "ENTER CODE");
      }
      break;

    case ST_ADD_USER_CODE:
      if (isdigit(k)) {
        newUserCode += k;
        lcdShow("NEW CODE", newUserCode);
      }
      else if (k == '#' && newUserCode.length() >= 2) {
        state = ST_ADD_USER_PIN;
        lcdShow("NEW PIN", "");
      }
      else if (k == '*' && newUserCode.length() > 0) {
        newUserCode = newUserCode.substring(0, newUserCode.length() - 1);
        lcdShow("NEW CODE", newUserCode);
      }
      else if (k == 'C') {
        state = ST_ADMIN_MENU;
        lcdShow("ADMIN MENU", "1=ADD 2=DEL 3=LST");
      }
      break;

    case ST_ADD_USER_PIN:
      if (isdigit(k)) {
        newUserPin += k;
        String mask = "";
        for (size_t i = 0; i < newUserPin.length(); i++) mask += '*';
        lcdShow("NEW PIN", mask);
      }
      else if (k == '#' && newUserPin.length() >= 2) {
        state = ST_ADD_USER_ROLE;
        lcdShow("SELECT ROLE", "1=OPR 2=SUPV");
      }
      else if (k == '*' && newUserPin.length() > 0) {
        newUserPin = newUserPin.substring(0, newUserPin.length() - 1);
        String mask = "";
        for (size_t i = 0; i < newUserPin.length(); i++) mask += '*';
        lcdShow("NEW PIN", mask);
      }
      else if (k == 'C') {
        state = ST_ADMIN_MENU;
        lcdShow("ADMIN MENU", "1=ADD 2=DEL 3=LST");
      }
      break;

    case ST_ADD_USER_ROLE:
      if (k == '1') {
        // Add as Operator
        if (addUser(newUserCode, newUserPin, OPERATOR)) {
          lcdShow("USER ADDED!", "OPERATOR " + newUserCode);
        } else {
          lcdShow("FAILED!", "CODE EXISTS/FULL");
        }
        delay(1500);
        state = ST_ADMIN_MENU;
        lcdShow("ADMIN MENU", "1=ADD 2=DEL 3=LST");
      }
      else if (k == '2') {
        // Add as Supervisor
        if (addUser(newUserCode, newUserPin, SUPERVISOR)) {
          lcdShow("USER ADDED!", "SUPV " + newUserCode);
        } else {
          lcdShow("FAILED!", "CODE EXISTS/FULL");
        }
        delay(1500);
        state = ST_ADMIN_MENU;
        lcdShow("ADMIN MENU", "1=ADD 2=DEL 3=LST");
      }
      else if (k == 'C') {
        state = ST_ADMIN_MENU;
        lcdShow("ADMIN MENU", "1=ADD 2=DEL 3=LST");
      }
      break;

    case ST_CALIBRATE:
      // Calibration menu: B starts 1L run into ST_DISPENSING, C goes back
      if (k == 'B') {
        Serial.println("[CAL] Starting calibration run");
        dispensedLiters = 0;
        flowPulses = 0;
        lastPulse = 0;
        pumpOn();  // Start pump for calibration
        ledsDispensing();
        state = ST_DISPENSING;
        lcdShow("CAL RUNNING", "#=STOP C=CNCL");
      } else if (k == 'C') {
        calibrationMode = false;
        state = ST_ADMIN_MENU;
        lcdShow("ADMIN MENU", "1=ADD 2=DEL 3=LST");
      }
      break;

    case ST_DELETE_USER:
      if (isdigit(k)) {
        inputBuf += k;
        lcdShow("DELETE CODE", inputBuf);
      }
      else if (k == '#' && inputBuf.length() > 0) {
        if (deleteUser(inputBuf)) {
          lcdShow("DELETED!", inputBuf);
        } else {
          lcdShow("NOT FOUND!", inputBuf);
        }
        delay(1500);
        inputBuf = "";
        state = ST_ADMIN_MENU;
        lcdShow("ADMIN MENU", "1=ADD 2=DEL 3=LST");
      }
      else if (k == '*' && inputBuf.length() > 0) {
        inputBuf = inputBuf.substring(0, inputBuf.length() - 1);
        lcdShow("DELETE CODE", inputBuf);
      }
      else if (k == 'C') {
        inputBuf = "";
        state = ST_ADMIN_MENU;
        lcdShow("ADMIN MENU", "1=ADD 2=DEL 3=LST");
      }
      break;

    case ST_LIST_USERS:
      {
        int userCount = getUserCount();
        if (k == '#' || k == 'B') {
          // Next user
          listUserIdx++;
          if (listUserIdx >= userCount) listUserIdx = 0;
        }
        else if (k == '*' || k == 'A') {
          // Previous user
          listUserIdx--;
          if (listUserIdx < 0) listUserIdx = userCount - 1;
          if (listUserIdx < 0) listUserIdx = 0;
        }
        else if (k == 'C') {
          state = ST_ADMIN_MENU;
          lcdShow("ADMIN MENU", "1=ADD 2=DEL 3=LST");
          break;
        }
        
        // Display current user
        if (userCount > 0) {
          Role r;
          String code = getUserAtIndex(listUserIdx, r);
          String roleStr = (r == SUPERVISOR) ? "SUP" : "OPR";
          lcdShow(String(listUserIdx + 1) + ":" + code, roleStr + " */# NAV C=BACK");
        } else {
          lcdShow("NO USERS", "C=BACK");
        }
      }
      break;

    default:
      break;
  }
}
