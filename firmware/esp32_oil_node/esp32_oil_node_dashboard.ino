/********************************************************************
 * ESP32 Oil Dispenser - Dashboard Integrated Version
 * 
 * This firmware works with the EXISTING Vercel dashboard.
 * DO NOT change backend APIs. Device obeys dashboard commands only.
 * 
 * Hardware:
 *  - ESP32 Dev Module (ESP-WROOM-32)
 *  - 16x2 I2C LCD (hd44780) OR 3.5" TFT ILI9488
 *  - 4x4 Keypad
 *  - Relay-controlled pump
 *  - Flow sensor (pulse output)
 * 
 * Device identity: DEVICE_ID + API_KEY only
 * Dashboard handles: ownership, sites, users, operators, pricing
 * 
 * State Machine:
 *  WAIT_AUTH    - Locked, ignore keypad, poll for commands
 *  AUTH_READY   - Dashboard authorized, D=start, keypad active
 *  DISPENSING   - Pump running, *=stop
 *  PAUSED       - Pump paused, #=resume, *=cancel
 *  COMPLETE     - Send receipt, auto-return to WAIT_AUTH
 *  ERROR_STATE  - Error occurred, #=reset
 ********************************************************************/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <Keypad.h>
#include <Wire.h>

// ========================= DISPLAY TYPE =========================
// Uncomment ONE of these:
#define USE_TFT_DISPLAY  // 3.5" TFT ILI9488 via TFT_eSPI
// #define USE_LCD_I2C   // 16x2 I2C LCD hd44780

#ifdef USE_TFT_DISPLAY
  #include <TFT_eSPI.h>
  TFT_eSPI tft = TFT_eSPI();
#endif

#ifdef USE_LCD_I2C
  #include <LiquidCrystal_I2C.h>
  LiquidCrystal_I2C lcd(0x27, 16, 2);  // Address 0x27 or 0x3F
#endif

// ========================= USER CONFIG (PASTE HERE) =========================
// Paste ONLY these defines when provisioning a new device:
// #define DEVICE_ID "OIL-0001"
// #define API_KEY "your-api-key-here"
// #define API_BASE_URL "https://web-tau-wine.vercel.app"
// #define SITE_NAME "Site Name"
// ==========================================================================

#ifndef DEVICE_ID
  #define DEVICE_ID "OIL-UNCONFIGURED"
#endif
#ifndef API_KEY
  #define API_KEY "UNCONFIGURED"
#endif
#ifndef API_BASE_URL
  #define API_BASE_URL "https://web-tau-wine.vercel.app"
#endif
#ifndef SITE_NAME
  #define SITE_NAME "UNNAMED"
#endif

// ========================= WIFI CONFIG =========================
const char* WIFI_SSID = "";   // e.g. "MTN_4G"
const char* WIFI_PASS = "";   // e.g. "password123"

// ========================= PINS =========================
// Pump relay control
static const int PIN_PUMP = 26;
static const bool PUMP_ACTIVE_HIGH = true;

// Flow sensor pulse input (interrupt capable)
static const int PIN_FLOW = 27;

// Keypad pins (ESP32 safe pins, no boot strap issues)
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

// ========================= STORAGE =========================
Preferences prefs;

// ========================= FLOW METER =========================
volatile uint32_t flowPulses = 0;
float pulsesPerLiter = 450.0f;  // Calibration value - adjust for your sensor
float dispensedLiters = 0.0f;
float litersTotal = 0.0f;
float flowLpm = 0.0f;
uint32_t lastFlowMs = 0;
uint32_t lastPulseSnapshot = 0;

// Dry-run protection
uint32_t noFlowStartMs = 0;
static const uint32_t DRY_RUN_TIMEOUT_MS = 10000;  // 10 seconds no flow = stop

// Flow ISR
void IRAM_ATTR onFlowPulse() { flowPulses++; }

// ========================= PRICING (from dashboard) =========================
struct DashboardPrice {
  float pricePerLiter = 0.0f;   // Selling price from dashboard
  float costPerLiter = 0.0f;    // Cost price (for profit calc)
  char currency[8] = "ZMW";
  String operatorName = "";     // Display only
} dashPrice;

// ========================= STATE MACHINE =========================
enum DeviceState {
  WAIT_AUTH,      // Locked, polling dashboard for authorization
  AUTH_READY,     // Dashboard authorized, waiting for D key to start
  DISPENSING,     // Pump ON, dispensing fuel
  PAUSED,         // Pump OFF, user paused
  COMPLETE,       // Transaction done, sending receipt
  ERROR_STATE     // Error occurred
};
DeviceState state = WAIT_AUTH;

// ========================= COMMAND DATA =========================
String currentCommandId = "";
float targetLiters = 0.0f;
String operatorId = "";        // From dashboard command
uint32_t dispenseStartMs = 0;
uint32_t dispenseStartUnix = 0;
String lastError = "";

// ========================= TIMERS =========================
uint32_t lastUiMs = 0;
uint32_t lastPollMs = 0;
uint32_t lastTelemetryMs = 0;

static const uint32_t UI_REFRESH_MS = 250;
static const uint32_t POLL_INTERVAL_MS = 3000;     // Poll dashboard every 3s
static const uint32_t TELEMETRY_INTERVAL_MS = 10000; // Send telemetry every 10s

// ========================= HTTPS CLIENT =========================
WiFiClientSecure secureClient;

// ========================= HELPER FUNCTIONS =========================

bool isConfigured() {
  return String(API_KEY) != "UNCONFIGURED" && String(API_BASE_URL).length() > 10;
}

void pumpSet(bool on) {
  if (PUMP_ACTIVE_HIGH) {
    digitalWrite(PIN_PUMP, on ? HIGH : LOW);
  } else {
    digitalWrite(PIN_PUMP, on ? LOW : HIGH);
  }
}

bool pumpIsOn() {
  int v = digitalRead(PIN_PUMP);
  return PUMP_ACTIVE_HIGH ? (v == HIGH) : (v == LOW);
}

String baseUrl() {
  String b = String(API_BASE_URL);
  if (b.endsWith("/")) b.remove(b.length() - 1);
  return b;
}

uint32_t unixNow() {
  time_t now = time(nullptr);
  if (now < 1700000000) return 0;  // Invalid time
  return (uint32_t)now;
}

String sessionId() {
  // Unique session ID for this transaction
  return String(DEVICE_ID) + "-" + String(dispenseStartMs);
}

// ========================= DISPLAY FUNCTIONS =========================

void displayClear() {
  #ifdef USE_TFT_DISPLAY
    tft.fillScreen(TFT_BLACK);
  #endif
  #ifdef USE_LCD_I2C
    lcd.clear();
  #endif
}

void displayHeader(const char* title) {
  #ifdef USE_TFT_DISPLAY
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
  #endif
  #ifdef USE_LCD_I2C
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print(title);
  #endif
}

void uiWaitAuth() {
  displayHeader("WAIT AUTH");
  #ifdef USE_TFT_DISPLAY
    tft.setTextSize(2);
    tft.setCursor(10, 90);
    tft.println("Waiting for");
    tft.setCursor(10, 115);
    tft.println("authorization...");
    tft.setTextSize(1);
    tft.setCursor(10, 160);
    tft.println("Keypad locked");
    tft.setCursor(10, 180);
    tft.printf("Polling: %s", API_BASE_URL);
  #endif
  #ifdef USE_LCD_I2C
    lcd.setCursor(0, 1);
    lcd.print("Waiting...");
  #endif
}

void uiAuthReady() {
  displayHeader("AUTHORIZED");
  #ifdef USE_TFT_DISPLAY
    tft.setTextSize(2);
    tft.setCursor(10, 80);
    tft.printf("Target: %.2fL", targetLiters);
    tft.setCursor(10, 110);
    tft.printf("Price: %s %.2f/L", dashPrice.currency, dashPrice.pricePerLiter);
    if (dashPrice.operatorName.length() > 0) {
      tft.setTextSize(1);
      tft.setCursor(10, 145);
      tft.printf("Operator: %s", dashPrice.operatorName.c_str());
    }
    tft.setTextSize(2);
    tft.setCursor(10, 175);
    tft.setTextColor(TFT_GREEN, TFT_BLACK);
    tft.println("Press D to START");
    tft.setTextColor(TFT_WHITE, TFT_BLACK);
    tft.setTextSize(1);
    tft.setCursor(10, 210);
    tft.println("* = Cancel");
  #endif
  #ifdef USE_LCD_I2C
    lcd.setCursor(0, 1);
    char buf[17];
    snprintf(buf, 17, "%.1fL D=GO *=X", targetLiters);
    lcd.print(buf);
  #endif
}

void uiDispensing() {
  displayHeader("DISPENSING");
  float total = dispensedLiters * dashPrice.pricePerLiter;
  float progress = (targetLiters > 0) ? (dispensedLiters / targetLiters * 100.0f) : 0;
  
  #ifdef USE_TFT_DISPLAY
    tft.setTextSize(2);
    tft.setCursor(10, 78);
    tft.printf("Target: %.2fL", targetLiters);
    tft.setCursor(10, 104);
    tft.setTextColor(TFT_CYAN, TFT_BLACK);
    tft.printf("Disp:   %.2fL", dispensedLiters);
    tft.setTextColor(TFT_WHITE, TFT_BLACK);
    
    // Progress bar
    tft.drawRect(10, 135, 300, 20, TFT_WHITE);
    int barWidth = (int)(progress * 2.96f);
    if (barWidth > 0) {
      tft.fillRect(12, 137, barWidth, 16, TFT_GREEN);
    }
    
    tft.setTextSize(1);
    tft.setCursor(10, 165);
    tft.printf("Flow: %.2f L/min", flowLpm);
    tft.setCursor(10, 180);
    tft.printf("Price: %s %.2f/L", dashPrice.currency, dashPrice.pricePerLiter);
    tft.setCursor(10, 195);
    tft.printf("Total: %s %.2f", dashPrice.currency, total);
    tft.setCursor(10, 220);
    tft.println("* = Pause");
  #endif
  #ifdef USE_LCD_I2C
    lcd.setCursor(0, 1);
    char buf[17];
    snprintf(buf, 17, "%.1f/%.1fL *=P", dispensedLiters, targetLiters);
    lcd.print(buf);
  #endif
}

void uiPaused() {
  displayHeader("PAUSED");
  #ifdef USE_TFT_DISPLAY
    tft.setTextSize(2);
    tft.setCursor(10, 90);
    tft.println("PUMP STOPPED");
    tft.setCursor(10, 120);
    tft.printf("Dispensed: %.2fL", dispensedLiters);
    tft.setTextSize(1);
    tft.setCursor(10, 160);
    tft.println("# = Resume");
    tft.setCursor(10, 180);
    tft.println("* = Cancel Transaction");
  #endif
  #ifdef USE_LCD_I2C
    lcd.setCursor(0, 1);
    lcd.print("#=GO *=CANCEL");
  #endif
}

void uiComplete() {
  displayHeader("COMPLETE");
  float total = dispensedLiters * dashPrice.pricePerLiter;
  uint32_t durSec = (millis() - dispenseStartMs) / 1000;
  
  #ifdef USE_TFT_DISPLAY
    tft.setTextSize(1);
    tft.setCursor(10, 80);
    tft.println("--------------------------------");
    tft.setCursor(10, 95);
    tft.println("      DISPENSE COMPLETE");
    tft.setCursor(10, 110);
    tft.println("--------------------------------");
    tft.setCursor(10, 130);
    tft.printf("Target:    %.2f L", targetLiters);
    tft.setCursor(10, 145);
    tft.printf("Dispensed: %.2f L", dispensedLiters);
    tft.setCursor(10, 160);
    tft.printf("Price/L:   %s %.2f", dashPrice.currency, dashPrice.pricePerLiter);
    tft.setCursor(10, 175);
    tft.printf("Total:     %s %.2f", dashPrice.currency, total);
    tft.setCursor(10, 190);
    tft.printf("Duration:  %lu sec", (unsigned long)durSec);
    tft.setCursor(10, 215);
    tft.println("Sending receipt...");
  #endif
  #ifdef USE_LCD_I2C
    lcd.setCursor(0, 1);
    char buf[17];
    snprintf(buf, 17, "%.1fL $%.0f", dispensedLiters, total);
    lcd.print(buf);
  #endif
}

void uiError() {
  displayHeader("ERROR");
  #ifdef USE_TFT_DISPLAY
    tft.setTextSize(2);
    tft.setCursor(10, 90);
    tft.setTextColor(TFT_RED, TFT_BLACK);
    tft.println("STOPPED");
    tft.setTextColor(TFT_WHITE, TFT_BLACK);
    tft.setTextSize(1);
    tft.setCursor(10, 125);
    tft.print(lastError);
    tft.setCursor(10, 160);
    tft.println("Press # to reset");
  #endif
  #ifdef USE_LCD_I2C
    lcd.setCursor(0, 1);
    lcd.print("# to reset");
  #endif
}

// ========================= HTTP FUNCTIONS =========================

/**
 * Send HTTPS POST request to dashboard
 * Uses WiFiClientSecure with certificate validation disabled (setInsecure)
 * for compatibility with various hosting providers
 */
int httpPost(const char* path, const String& body, String& response) {
  if (WiFi.status() != WL_CONNECTED) return -1;
  if (!isConfigured()) return -2;
  
  HTTPClient http;
  String url = baseUrl() + String(path);
  
  http.begin(secureClient, url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-id", String(DEVICE_ID));
  http.addHeader("x-api-key", String(API_KEY));
  http.setTimeout(10000);
  
  int code = http.POST((uint8_t*)body.c_str(), body.length());
  
  if (code > 0) {
    response = http.getString();
  }
  
  http.end();
  return code;
}

/**
 * Send HTTPS GET request to dashboard
 */
int httpGet(const char* path, String& response) {
  if (WiFi.status() != WL_CONNECTED) return -1;
  if (!isConfigured()) return -2;
  
  HTTPClient http;
  String url = baseUrl() + String(path);
  
  http.begin(secureClient, url);
  http.addHeader("x-device-id", String(DEVICE_ID));
  http.addHeader("x-api-key", String(API_KEY));
  http.setTimeout(10000);
  
  int code = http.GET();
  
  if (code > 0) {
    response = http.getString();
  }
  
  http.end();
  return code;
}

// ========================= DASHBOARD COMMUNICATION =========================

/**
 * Poll dashboard for pending commands
 * Dashboard API: GET /api/device/commands/pull
 * 
 * Expected command types:
 *  - DISPENSE_TARGET: { "liters": 10.0 } - Authorizes dispensing
 *  - PUMP_ON: Direct pump control (emergency)
 *  - PUMP_OFF: Direct pump control (emergency)
 *  - SET_PRICE_PER_LITER: { "price": 25.0 } - Update local price
 */
void pollDashboardCommands() {
  // Only poll in WAIT_AUTH state
  if (state != WAIT_AUTH) return;
  
  String response;
  int code = httpGet("/api/device/commands/pull", response);
  
  if (code != 200) {
    Serial.printf("[POLL] HTTP error: %d\n", code);
    return;
  }
  
  // Parse response
  StaticJsonDocument<1024> doc;
  DeserializationError err = deserializeJson(doc, response);
  if (err) {
    Serial.printf("[POLL] JSON parse error: %s\n", err.c_str());
    return;
  }
  
  if (!doc["ok"].as<bool>()) {
    Serial.println("[POLL] Dashboard returned ok:false");
    return;
  }
  
  // Check if command exists
  if (doc["command"].isNull()) {
    // No pending command - this is normal
    return;
  }
  
  // Extract command data
  String cmdId = doc["command"]["id"].as<String>();
  String cmdType = doc["command"]["type"].as<String>();
  JsonObject payload = doc["command"]["payloadJson"].as<JsonObject>();
  
  Serial.printf("[POLL] Received command: id=%s type=%s\n", cmdId.c_str(), cmdType.c_str());
  
  // Handle command based on type
  if (cmdType == "DISPENSE_TARGET") {
    // Dashboard is authorizing a dispense operation
    currentCommandId = cmdId;
    targetLiters = payload["liters"].as<float>();
    
    // Optional: Extract operator info if provided
    if (payload.containsKey("operatorId")) {
      operatorId = payload["operatorId"].as<String>();
    }
    if (payload.containsKey("operatorName")) {
      dashPrice.operatorName = payload["operatorName"].as<String>();
    }
    if (payload.containsKey("pricePerLiter")) {
      dashPrice.pricePerLiter = payload["pricePerLiter"].as<float>();
    }
    
    if (targetLiters > 0) {
      state = AUTH_READY;
      Serial.printf("[CMD] DISPENSE_TARGET: %.2fL authorized\n", targetLiters);
      
      // Send ACK to dashboard
      sendCommandAck(cmdId, true, "Ready to dispense");
    } else {
      Serial.println("[CMD] Invalid target liters");
      sendCommandAck(cmdId, false, "Invalid target liters");
    }
  }
  else if (cmdType == "PUMP_ON") {
    // Emergency pump control from dashboard
    pumpSet(true);
    sendCommandAck(cmdId, true, "Pump turned ON");
  }
  else if (cmdType == "PUMP_OFF") {
    // Emergency pump stop from dashboard
    pumpSet(false);
    if (state == DISPENSING) {
      state = PAUSED;
    }
    sendCommandAck(cmdId, true, "Pump turned OFF");
  }
  else if (cmdType == "SET_PRICE_PER_LITER") {
    // Update local price display
    float newPrice = payload["price"].as<float>();
    if (newPrice > 0) {
      dashPrice.pricePerLiter = newPrice;
      sendCommandAck(cmdId, true, "Price updated");
    } else {
      sendCommandAck(cmdId, false, "Invalid price");
    }
  }
  else {
    Serial.printf("[CMD] Unknown command type: %s\n", cmdType.c_str());
    sendCommandAck(cmdId, false, "Unknown command type");
  }
}

/**
 * Send command acknowledgment to dashboard
 * Dashboard API: POST /api/device/commands/ack
 */
void sendCommandAck(const String& commandId, bool ok, const char* message) {
  StaticJsonDocument<256> doc;
  doc["commandId"] = commandId;
  doc["ok"] = ok;
  doc["message"] = message;
  doc["executedAt"] = unixNow();
  
  String body;
  serializeJson(doc, body);
  
  String response;
  int code = httpPost("/api/device/commands/ack", body, response);
  
  Serial.printf("[ACK] %s -> HTTP %d\n", ok ? "OK" : "FAIL", code);
}

/**
 * Send telemetry data to dashboard
 * Dashboard API: POST /api/ingest/telemetry
 */
void sendTelemetry() {
  StaticJsonDocument<512> doc;
  doc["ts"] = unixNow() ? unixNow() : (millis() / 1000);
  doc["oilPercent"] = 50.0f;  // Placeholder - add tank level sensor if needed
  doc["oilLiters"] = litersTotal;
  doc["distanceCm"] = 0.0f;   // Placeholder
  doc["flowLpm"] = flowLpm;
  doc["litersTotal"] = litersTotal;
  doc["pumpState"] = pumpIsOn();
  doc["safetyStatus"] = (state == ERROR_STATE) ? lastError.c_str() : "OK";
  doc["wifiRssi"] = (WiFi.status() == WL_CONNECTED) ? WiFi.RSSI() : -127;
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

/**
 * Send dispense receipt to dashboard
 * Dashboard API: POST /api/ingest/receipt
 */
void sendReceipt(const char* status, const char* errorMsg) {
  uint32_t endUnix = unixNow();
  uint32_t durSec = (millis() - dispenseStartMs) / 1000;
  
  StaticJsonDocument<512> doc;
  doc["sessionId"] = sessionId();
  doc["targetLiters"] = targetLiters;
  doc["dispensedLiters"] = dispensedLiters;
  doc["durationSec"] = durSec;
  doc["status"] = status;
  if (strlen(errorMsg) > 0) {
    doc["errorMessage"] = errorMsg;
  }
  doc["startedAtUnix"] = dispenseStartUnix ? dispenseStartUnix : (dispenseStartMs / 1000);
  doc["endedAtUnix"] = endUnix ? endUnix : (millis() / 1000);
  
  // Include operator ID if we have it
  if (operatorId.length() > 0) {
    doc["operatorId"] = operatorId;
  }
  
  String body;
  serializeJson(doc, body);
  
  String response;
  int code = httpPost("/api/ingest/receipt", body, response);
  
  if (code >= 200 && code < 300) {
    Serial.println("[RECEIPT] Sent successfully");
  } else {
    Serial.printf("[RECEIPT] Failed: %d - queuing locally\n", code);
    // TODO: Add receipt queue for offline scenarios
  }
}

// ========================= FLOW SENSOR UPDATE =========================

void updateFlow() {
  uint32_t now = millis();
  if (now - lastFlowMs < 500) return;  // Update every 500ms
  
  // Read pulse count atomically
  uint32_t p;
  noInterrupts();
  p = flowPulses;
  interrupts();
  
  uint32_t dp = p - lastPulseSnapshot;
  lastPulseSnapshot = p;
  
  // Calculate liters from pulses
  float liters = (pulsesPerLiter > 0.1f) ? (dp / pulsesPerLiter) : 0.0f;
  
  // Update totals
  if (state == DISPENSING) {
    dispensedLiters += liters;
  }
  litersTotal += liters;
  
  // Calculate flow rate
  float dtMin = (now - lastFlowMs) / 60000.0f;
  flowLpm = (dtMin > 0) ? (liters / dtMin) : 0;
  
  lastFlowMs = now;
  
  // Dry-run protection: if pump is on but no flow detected
  if (state == DISPENSING && pumpIsOn()) {
    if (flowLpm < 0.01f) {
      if (noFlowStartMs == 0) {
        noFlowStartMs = now;
      } else if (now - noFlowStartMs > DRY_RUN_TIMEOUT_MS) {
        // No flow for too long - stop pump to prevent damage
        pumpSet(false);
        lastError = "DRY RUN: No flow detected";
        sendReceipt("ERROR", lastError.c_str());
        state = ERROR_STATE;
        Serial.println("[ERROR] Dry run protection triggered");
      }
    } else {
      noFlowStartMs = 0;  // Reset timer when flow detected
    }
  } else {
    noFlowStartMs = 0;
  }
}

// ========================= WIFI & TIME =========================

void connectWiFi() {
  if (String(WIFI_SSID).length() == 0) {
    Serial.println("[WIFI] No SSID configured");
    return;
  }
  
  Serial.printf("[WIFI] Connecting to %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(500);
    Serial.print(".");
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WIFI] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
    
    // Setup NTP for accurate timestamps
    configTime(0, 0, "pool.ntp.org", "time.google.com");
    Serial.println("[TIME] NTP sync started");
  } else {
    Serial.println("\n[WIFI] Connection failed");
  }
}

// ========================= SETTINGS =========================

void loadSettings() {
  prefs.begin("flow", true);
  pulsesPerLiter = prefs.getFloat("ppl", pulsesPerLiter);
  prefs.end();
  
  prefs.begin("price", true);
  dashPrice.pricePerLiter = prefs.getFloat("sell", 23.0f);
  dashPrice.costPerLiter = prefs.getFloat("cost", 0.0f);
  prefs.end();
  
  Serial.printf("[SETTINGS] Pulses/L: %.1f, Price: %.2f\n", pulsesPerLiter, dashPrice.pricePerLiter);
}

void resetTransaction() {
  currentCommandId = "";
  targetLiters = 0.0f;
  dispensedLiters = 0.0f;
  operatorId = "";
  dashPrice.operatorName = "";
  dispenseStartMs = 0;
  dispenseStartUnix = 0;
  lastError = "";
  noFlowStartMs = 0;
}

// ========================= SETUP =========================

void setup() {
  Serial.begin(115200);
  Serial.println("\n========================================");
  Serial.println("ESP32 Oil Dispenser - Dashboard Edition");
  Serial.printf("Device: %s\n", DEVICE_ID);
  Serial.printf("API: %s\n", API_BASE_URL);
  Serial.println("========================================\n");
  
  // Initialize pump (OFF)
  pinMode(PIN_PUMP, OUTPUT);
  pumpSet(false);
  
  // Initialize flow sensor interrupt
  pinMode(PIN_FLOW, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_FLOW), onFlowPulse, RISING);
  
  // Initialize display
  #ifdef USE_TFT_DISPLAY
    tft.init();
    tft.setRotation(1);
    tft.fillScreen(TFT_BLACK);
  #endif
  #ifdef USE_LCD_I2C
    lcd.init();
    lcd.backlight();
  #endif
  
  // Load saved settings
  loadSettings();
  
  // Connect to WiFi
  connectWiFi();
  
  // Setup HTTPS client - skip certificate validation for compatibility
  // This is acceptable for IoT devices where the alternative is no encryption
  secureClient.setInsecure();
  
  // Start in WAIT_AUTH state
  state = WAIT_AUTH;
  
  Serial.println("[READY] Waiting for dashboard authorization...");
}

// ========================= MAIN LOOP =========================

void loop() {
  // Update flow sensor readings
  updateFlow();
  
  // Periodic telemetry
  if (millis() - lastTelemetryMs > TELEMETRY_INTERVAL_MS) {
    lastTelemetryMs = millis();
    sendTelemetry();
  }
  
  // Poll dashboard for commands (only in WAIT_AUTH state)
  if (millis() - lastPollMs > POLL_INTERVAL_MS) {
    lastPollMs = millis();
    if (state == WAIT_AUTH) {
      pollDashboardCommands();
    }
  }
  
  // UI refresh
  if (millis() - lastUiMs > UI_REFRESH_MS) {
    lastUiMs = millis();
    switch (state) {
      case WAIT_AUTH:   uiWaitAuth();   break;
      case AUTH_READY:  uiAuthReady();  break;
      case DISPENSING:  uiDispensing(); break;
      case PAUSED:      uiPaused();     break;
      case COMPLETE:    uiComplete();   break;
      case ERROR_STATE: uiError();      break;
    }
  }
  
  // Process keypad input
  char k = keypad.getKey();
  if (k) {
    handleKeypress(k);
  }
  
  // Auto-stop when target reached
  if (state == DISPENSING && dispensedLiters >= targetLiters) {
    pumpSet(false);
    Serial.printf("[DISPENSE] Target reached: %.2f >= %.2f\n", dispensedLiters, targetLiters);
    sendReceipt("DONE", "");
    state = COMPLETE;
    
    // Auto-return to WAIT_AUTH after showing receipt
    delay(3000);
    resetTransaction();
    state = WAIT_AUTH;
  }
}

// ========================= KEYPAD HANDLER =========================

void handleKeypress(char k) {
  Serial.printf("[KEY] '%c' in state %d\n", k, state);
  
  switch (state) {
    case WAIT_AUTH:
      // Keypad is DISABLED in WAIT_AUTH state
      // User cannot interact until dashboard authorizes
      Serial.println("[KEY] Ignored - waiting for authorization");
      break;
      
    case AUTH_READY:
      // Dashboard has authorized - keypad is active
      if (k == 'D') {
        // D = Start dispensing
        dispensedLiters = 0.0f;
        noFlowStartMs = 0;
        dispenseStartMs = millis();
        dispenseStartUnix = unixNow();
        pumpSet(true);
        state = DISPENSING;
        Serial.println("[DISPENSE] Started");
      }
      else if (k == '*') {
        // * = Cancel authorization, return to WAIT_AUTH
        sendReceipt("CANCELED", "User canceled before start");
        resetTransaction();
        state = WAIT_AUTH;
        Serial.println("[CANCEL] Authorization canceled");
      }
      break;
      
    case DISPENSING:
      // During dispensing - only stop/pause allowed
      if (k == '*') {
        // * = Pause pump
        pumpSet(false);
        state = PAUSED;
        Serial.println("[PAUSE] Pump paused");
      }
      break;
      
    case PAUSED:
      // Pump is paused
      if (k == '#') {
        // # = Resume dispensing
        pumpSet(true);
        state = DISPENSING;
        Serial.println("[RESUME] Pump resumed");
      }
      else if (k == '*') {
        // * = Cancel entire transaction
        pumpSet(false);
        sendReceipt("CANCELED", "User canceled during pause");
        resetTransaction();
        state = WAIT_AUTH;
        Serial.println("[CANCEL] Transaction canceled");
      }
      break;
      
    case COMPLETE:
      // Transaction complete - wait for auto-return
      // Or allow manual return with #
      if (k == '#') {
        resetTransaction();
        state = WAIT_AUTH;
      }
      break;
      
    case ERROR_STATE:
      // Error state - # to reset
      if (k == '#') {
        pumpSet(false);
        resetTransaction();
        state = WAIT_AUTH;
        Serial.println("[RESET] Error cleared");
      }
      break;
  }
}
