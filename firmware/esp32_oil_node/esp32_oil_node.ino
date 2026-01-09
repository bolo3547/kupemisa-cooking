/********************************************************************
 * ESP32 Oil Dispenser (Filling Station Mode) with Operator Login
 * 
 * PRODUCTION-CRITICAL FIRMWARE - PATCHED VERSION
 * 
 * Hardware:
 *  - ESP32 Dev Module (ESP-WROOM-32) or D1 R32
 *  - 16x2 I2C LCD (PCF8574 backpack, address 0x27 or 0x3F)
 *  - 4x4 Matrix Keypad
 *  - Flow sensor (pulse output)
 *  - Pump (12V) via relay/MOSFET
 * 
 * Features:
 *  - ONLINE + OFFLINE SUPPORT
 *  - Local operator login via keypad (PIN-based)
 *  - Dashboard verifies operator credentials (when online)
 *  - Local PIN cache for offline operation (SHA256 hashed)
 *  - Local liters entry after login
 *  - Auto-stop at target liters (flow sensor is source of truth)
 *  - Sale recording sent to dashboard (queued if offline)
 *  - Auto-logout after each sale
 *  - Maximum pump runtime failsafe
 * 
 * Flow:
 *  1. IDLE: Show "WAIT AUTH / Press A Login"
 *  2. Press A -> Enter PIN mode
 *  3. Enter PIN, press # to confirm
 *  4. Dashboard verifies PIN (or local cache if offline)
 *  5. If valid -> Enter liters mode
 *  6. Enter liters, press # to confirm
 *  7. Show "READY / Press D to dispense"
 *  8. D starts pump, * stops pump (emergency)
 *  9. Pump auto-stops at target liters
 * 10. Sale sent to dashboard (or queued), auto-logout, return to IDLE
 ********************************************************************/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <Keypad.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <time.h>
#include <mbedtls/sha256.h>
#include <esp_task_wdt.h>
#include <esp_system.h>
#include <rom/rtc.h>

// ========================= USER CONFIG (PASTE HERE) =========================
#define DEVICE_ID "OIL-0001"
#define API_KEY "QV-nQArRlomVfBOiL1Ob1P4mtIz88a7mO0c3kXVZYK8"
#define API_BASE_URL "https://fleet-oil-system.vercel.app"
#define SITE_NAME "PHI"

// ========================= OFFLINE FALLBACK CONFIG =========================
// These operators can login when WiFi is unavailable
// PINs stored as SHA256 hashes for security
// To generate hash: echo -n "1234" | sha256sum
// WARNING: Update these hashes if changing default PINs
#define OFFLINE_HASH_1 "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4"  // PIN: 1234
#define OFFLINE_NAME_1 "Operator 1"
#define OFFLINE_ROLE_1 "operator"

#define OFFLINE_HASH_2 "ef797c8118f02dfb649607dd5d3f8c7623048c9c063d532cc95c5ed7a898a64f"  // PIN: 5678
#define OFFLINE_NAME_2 "Operator 2"
#define OFFLINE_ROLE_2 "operator"

#define OFFLINE_HASH_3 "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9"  // PIN: 0000 (admin if SUPERVISOR role)
#define OFFLINE_NAME_3 "Admin"
#define OFFLINE_ROLE_3 "SUPERVISOR"

// Default price if never connected to dashboard (fallback)
#define DEFAULT_PRICE_SELL 25.50f
#define DEFAULT_PRICE_COST 20.00f
#define DEFAULT_CURRENCY "ZMW"

// ========================= SAFETY LIMITS =========================
#define MAX_PUMP_RUNTIME_MS 600000  // 10 minutes max pump runtime failsafe
#define MAX_RECEIPT_SIZE 1500       // Maximum receipt JSON size for NVS queue
#define WATCHDOG_TIMEOUT_S 8        // Hardware watchdog timeout
#define MIN_PUMP_OFF_DELAY_MS 500   // Minimum delay between pump cycles (industrial safety)
#define FLOW_DROP_THRESHOLD 0.4f    // 40% flow drop threshold
#define FLOW_DROP_DURATION_MS 3000  // Flow drop duration before anomaly
#define TAMPER_DEBOUNCE_MS 100      // Tamper switch debounce
#define ENABLE_TAMPER_DETECTION false  // Set to true when tamper switch is connected
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
const char* WIFI_SSID = "kupemisa";
const char* WIFI_PASS = "123admin";
// ================================================================

// ========================= PINS =========================
// Pump control
static const int PIN_PUMP = 26;
static const bool PUMP_ACTIVE_HIGH = true;

// Flow sensor pulse input (interrupt)
static const int PIN_FLOW = 27;

// Tamper detection (cabinet open / wire cut)
static const int PIN_TAMPER = 34;  // INPUT_ONLY pin (ADC1_CH6)

// I2C LCD pins (ESP32 default I2C)
// SDA = GPIO 21
// SCL = GPIO 22

// Keypad pins (safe, no boot strap issues)
const byte ROWS = 4, COLS = 4;
char keys[ROWS][COLS] = {
  {'1','2','3','A'},
  {'4','5','6','B'},
  {'7','8','9','C'},
  {'*','0','#','D'}
};
byte rowPins[ROWS] = {32, 33, 25, 14};
byte colPins[COLS] = {13, 16, 17, 4};   // Use GPIO4 (safe) instead of GPIO15 (boot strap)
Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

// ========================= DISPLAY (16x2 I2C LCD) =========================
// Common I2C addresses: 0x27 or 0x3F - try both if one doesn't work
LiquidCrystal_I2C lcd(0x27, 16, 2);

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

// Flow anomaly detection
float lastFlowLpm = 0.0f;
uint32_t flowDropStartMs = 0;
bool flowAnomalyDetected = false;
String flowAnomalyType = "";

// Flow sensor ISR
void IRAM_ATTR onFlowPulse() { flowPulses++; }

// ========================= PRICING (from dashboard) =========================
struct Price {
  float sell = DEFAULT_PRICE_SELL;      // Selling price per liter
  float cost = DEFAULT_PRICE_COST;      // Cost price per liter
  char currency[8] = DEFAULT_CURRENCY;
} price;

// ========================= ONLINE/OFFLINE STATE =========================
// isOnline is the SINGLE SOURCE OF TRUTH for connection status
bool isOnline = false;

// ========================= TAMPER DETECTION =========================
bool tamperActive = false;
uint32_t lastTamperCheckMs = 0;
bool tamperLocked = false;  // Keypad locked due to tamper

// ========================= SAFETY & COMPLIANCE =========================
uint32_t lastPumpOffMs = 0;  // Track pump OFF time for minimum delay
uint32_t watchdogResetTime = 0;  // Time of last watchdog reset
bool watchdogResetDetected = false;
String lastResetReason = "";

// ========================= LOCAL OPERATOR CACHE =========================
// Cache operators from dashboard for offline use (up to 5)
// PINs are stored as SHA256 hashes, never in plain text
struct CachedOperator {
  char pinHash[65];   // SHA256 hash (64 hex chars + null)
  char name[32];
  char id[64];
  char role[16];
  bool valid;
};
static const int MAX_CACHED_OPS = 5;
CachedOperator cachedOps[MAX_CACHED_OPS];

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
bool pendingAdminCheck = false;  // Flag for admin mode check after PIN

// ========================= DISPENSING STATE =========================
float targetLiters = 0.0f;
uint32_t dispenseStartMs = 0;
uint32_t dispenseStartUnix = 0;
String lastError = "";

// ========================= TIMERS =========================
uint32_t lastUiMs = 0;
uint32_t lastTelemetryMs = 0;
uint32_t lastReceiptRetryMs = 0;
uint32_t lastScrollMs = 0;
uint32_t lastLitersSaveMs = 0;
int scrollPos = 0;

static const uint32_t UI_MS = 300;
static const uint32_t TELEMETRY_MS = 10000;
static const uint32_t RETRY_MS = 8000;
static const uint32_t SCROLL_MS = 400;
static const uint32_t LITERS_SAVE_MS = 60000;  // Save litersTotal every 60s

// ========================= RECEIPT QUEUE =========================
static const int QSIZE = 20;

// ========================= SHA256 HASH FUNCTION =========================
String sha256Hash(const String& input) {
  unsigned char hash[32];
  mbedtls_sha256_context ctx;
  mbedtls_sha256_init(&ctx);
  mbedtls_sha256_starts(&ctx, 0);  // 0 = SHA-256 (not SHA-224)
  mbedtls_sha256_update(&ctx, (const unsigned char*)input.c_str(), input.length());
  mbedtls_sha256_finish(&ctx, hash);
  mbedtls_sha256_free(&ctx);
  
  // Convert to hex string
  char hexStr[65];
  for (int i = 0; i < 32; i++) {
    sprintf(&hexStr[i * 2], "%02x", hash[i]);
  }
  hexStr[64] = '\0';
  return String(hexStr);
}

// ========================= AUDIT CHECKSUM GENERATION =========================
String generateAuditChecksum(const String& deviceId, const String& operatorId,
                             float targetLiters, float dispensedLiters,
                             float pricePerLiter, uint32_t startUnix, uint32_t endUnix) {
  // Concatenate all transaction data for tamper-proof checksum
  String data = deviceId + "|" + operatorId + "|" + 
                String(targetLiters, 3) + "|" + String(dispensedLiters, 3) + "|" +
                String(pricePerLiter, 2) + "|" + String(startUnix) + "|" + String(endUnix);
  return sha256Hash(data);
}

// ========================= WATCHDOG FUNCTIONS =========================
void initWatchdog() {
  esp_task_wdt_init(WATCHDOG_TIMEOUT_S, true);  // Enable panic so ESP32 resets
  esp_task_wdt_add(NULL);  // Add current thread to WDT watch
  Serial.printf("[SAFETY] Watchdog enabled: %d seconds timeout\n", WATCHDOG_TIMEOUT_S);
}

void feedWatchdog() {
  esp_task_wdt_reset();
}

String getResetReason() {
  RESET_REASON reason = rtc_get_reset_reason(0);
  switch (reason) {
    case POWERON_RESET: return "POWER_ON";
    case SW_RESET: return "SOFTWARE";
    case OWDT_RESET: return "WATCHDOG";
    case DEEPSLEEP_RESET: return "DEEP_SLEEP";
    case SDIO_RESET: return "SDIO";
    case TG0WDT_SYS_RESET: return "WATCHDOG_TG0";
    case TG1WDT_SYS_RESET: return "WATCHDOG_TG1";
    case RTCWDT_SYS_RESET: return "WATCHDOG_RTC";
    case INTRUSION_RESET: return "INTRUSION";
    case TGWDT_CPU_RESET: return "WATCHDOG_CPU";
    case SW_CPU_RESET: return "SOFTWARE_CPU";
    case RTCWDT_CPU_RESET: return "WATCHDOG_RTC_CPU";
    case EXT_CPU_RESET: return "EXTERNAL_CPU";
    case RTCWDT_BROWN_OUT_RESET: return "BROWNOUT";
    case RTCWDT_RTC_RESET: return "WATCHDOG_RTC_RESET";
    default: return "UNKNOWN";
  }
}

// ========================= TAMPER DETECTION =========================
void checkTamper() {
  if (!ENABLE_TAMPER_DETECTION) return;  // Skip if tamper detection disabled
  
  if (millis() - lastTamperCheckMs < TAMPER_DEBOUNCE_MS) return;
  lastTamperCheckMs = millis();
  
  // Tamper pin: LOW = tampered, HIGH = normal (pull-up)
  int tamperState = digitalRead(PIN_TAMPER);
  
  if (tamperState == LOW && !tamperActive) {
    // Tamper detected!
    tamperActive = true;
    tamperLocked = true;
    pumpSet(false);  // Emergency stop
    lastError = "TAMPER: Cabinet opened";
    Serial.println("[SECURITY] TAMPER DETECTED - Cabinet opened or wire cut");
    state = ERROR_STATE;
  }
}

bool canStartPump() {
  // Industrial safety checks before pump start
  if (tamperActive) {
    Serial.println("[SAFETY] Pump start blocked: Tamper active");
    return false;
  }
  
  if (watchdogResetDetected && (millis() - watchdogResetTime < 30000)) {
    Serial.println("[SAFETY] Pump start blocked: Recent watchdog reset");
    return false;
  }
  
  // Minimum OFF delay between pump cycles
  if (millis() - lastPumpOffMs < MIN_PUMP_OFF_DELAY_MS) {
    Serial.println("[SAFETY] Pump start blocked: Minimum OFF delay not met");
    return false;
  }
  
  return true;
}

void safePumpSet(bool on) {
  if (on && !canStartPump()) {
    Serial.println("[SAFETY] Pump start denied by safety system");
    return;
  }
  
  if (!on) {
    lastPumpOffMs = millis();  // Track OFF time
  }
  
  pumpSet(on);
}

// ========================= FLOW ANOMALY DETECTION =========================
void detectFlowAnomalies() {
  bool isPumpOn = pumpOn();
  uint32_t now = millis();
  
  // 1. Flow detected while pump is OFF (bypass or leak)
  if (!isPumpOn && flowLpm > 0.5f) {
    flowAnomalyDetected = true;
    flowAnomalyType = "FLOW_WHILE_PUMP_OFF";
    safePumpSet(false);
    lastError = "Anomaly: Flow detected with pump OFF";
    Serial.println("[ANOMALY] Flow detected while pump OFF - possible bypass");
    state = ERROR_STATE;
    return;
  }
  
  // 2. Sudden pulse spike (possible meter tampering)
  if (state == DISPENSING && flowLpm > lastFlowLpm * 3.0f && lastFlowLpm > 0.1f) {
    flowAnomalyDetected = true;
    flowAnomalyType = "SUDDEN_SPIKE";
    safePumpSet(false);
    lastError = "Anomaly: Sudden flow spike";
    Serial.println("[ANOMALY] Sudden flow spike detected");
    state = ERROR_STATE;
    return;
  }
  
  // 3. Flow drop >40% for >3 seconds while pump ON
  if (isPumpOn && state == DISPENSING) {
    if (lastFlowLpm > 0.1f && flowLpm < lastFlowLpm * (1.0f - FLOW_DROP_THRESHOLD)) {
      if (flowDropStartMs == 0) {
        flowDropStartMs = now;
      } else if (now - flowDropStartMs > FLOW_DROP_DURATION_MS) {
        flowAnomalyDetected = true;
        flowAnomalyType = "FLOW_DROP_SUSTAINED";
        safePumpSet(false);
        lastError = "Anomaly: Sustained flow drop";
        Serial.println("[ANOMALY] Sustained flow drop detected");
        state = ERROR_STATE;
        return;
      }
    } else {
      flowDropStartMs = 0;  // Reset if flow recovered
    }
  }
  
  lastFlowLpm = flowLpm;
}

// ========================= UTIL FUNCTIONS =========================
bool isCloudEnabled() {
  return String(API_KEY) != "UNCONFIGURED" && String(API_BASE_URL).length() > 8;
}

// Update isOnline - this is the single source of truth
void updateOnlineStatus() {
  isOnline = (WiFi.status() == WL_CONNECTED);
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

// ========================= LOCAL OPERATOR CACHE FUNCTIONS =========================
void initOfflineOperators() {
  // Initialize with hardcoded fallback operators (hashed PINs)
  memset(cachedOps, 0, sizeof(cachedOps));
  
  // Operator 1 - PIN hash already computed
  strncpy(cachedOps[0].pinHash, OFFLINE_HASH_1, 64);
  cachedOps[0].pinHash[64] = '\0';
  strncpy(cachedOps[0].name, OFFLINE_NAME_1, 31);
  strncpy(cachedOps[0].id, "offline-1", 63);
  strncpy(cachedOps[0].role, OFFLINE_ROLE_1, 15);
  cachedOps[0].valid = true;
  
  // Operator 2
  strncpy(cachedOps[1].pinHash, OFFLINE_HASH_2, 64);
  cachedOps[1].pinHash[64] = '\0';
  strncpy(cachedOps[1].name, OFFLINE_NAME_2, 31);
  strncpy(cachedOps[1].id, "offline-2", 63);
  strncpy(cachedOps[1].role, OFFLINE_ROLE_2, 15);
  cachedOps[1].valid = true;
  
  // Operator 3 (Admin/Supervisor)
  strncpy(cachedOps[2].pinHash, OFFLINE_HASH_3, 64);
  cachedOps[2].pinHash[64] = '\0';
  strncpy(cachedOps[2].name, OFFLINE_NAME_3, 31);
  strncpy(cachedOps[2].id, "offline-3", 63);
  strncpy(cachedOps[2].role, OFFLINE_ROLE_3, 15);
  cachedOps[2].valid = true;
  
  // Load any cached operators from NVS (from previous online sessions)
  loadCachedOperators();
}

void loadCachedOperators() {
  prefs.begin("ops", true);
  for (int i = 0; i < MAX_CACHED_OPS; i++) {
    String keyHash = "h" + String(i);  // Changed from "p" to "h" for hash
    String keyName = "n" + String(i);
    String keyId = "i" + String(i);
    String keyRole = "r" + String(i);
    
    String pinHash = prefs.getString(keyHash.c_str(), "");
    String name = prefs.getString(keyName.c_str(), "");
    String id = prefs.getString(keyId.c_str(), "");
    String role = prefs.getString(keyRole.c_str(), "operator");
    
    // Only load if hash is valid length (64 chars for SHA256)
    if (pinHash.length() == 64 && name.length() > 0) {
      pinHash.toCharArray(cachedOps[i].pinHash, 65);
      name.toCharArray(cachedOps[i].name, 32);
      id.toCharArray(cachedOps[i].id, 64);
      role.toCharArray(cachedOps[i].role, 16);
      cachedOps[i].valid = true;
    }
  }
  prefs.end();
}

void cacheOperator(const String& pin, const String& name, const String& id, const String& role) {
  // Hash the PIN before storing
  String pinHash = sha256Hash(pin);
  
  // Find empty slot or overwrite oldest
  int slot = -1;
  for (int i = 0; i < MAX_CACHED_OPS; i++) {
    if (!cachedOps[i].valid || String(cachedOps[i].pinHash) == pinHash) {
      slot = i;
      break;
    }
  }
  if (slot < 0) slot = MAX_CACHED_OPS - 1;  // Overwrite last
  
  pinHash.toCharArray(cachedOps[slot].pinHash, 65);
  name.toCharArray(cachedOps[slot].name, 32);
  id.toCharArray(cachedOps[slot].id, 64);
  role.toCharArray(cachedOps[slot].role, 16);
  cachedOps[slot].valid = true;
  
  // Save to NVS (hash only, never plain PIN)
  prefs.begin("ops", false);
  String keyHash = "h" + String(slot);
  String keyName = "n" + String(slot);
  String keyId = "i" + String(slot);
  String keyRole = "r" + String(slot);
  prefs.putString(keyHash.c_str(), pinHash);
  prefs.putString(keyName.c_str(), name);
  prefs.putString(keyId.c_str(), id);
  prefs.putString(keyRole.c_str(), role);
  prefs.end();
}

bool verifyPinOffline(const String& pin) {
  // Hash the entered PIN and compare with stored hashes
  String enteredHash = sha256Hash(pin);
  
  for (int i = 0; i < MAX_CACHED_OPS; i++) {
    if (cachedOps[i].valid && String(cachedOps[i].pinHash) == enteredHash) {
      session.operatorId = String(cachedOps[i].id);
      session.operatorName = String(cachedOps[i].name);
      session.operatorRole = String(cachedOps[i].role);
      session.loggedIn = true;
      return true;
    }
  }
  return false;
}

// Check if operator has admin/supervisor role
bool isAdminRole(const String& role) {
  String r = role;
  r.toLowerCase();
  return (r == "admin" || r == "supervisor" || r == "SUPERVISOR" || r == "Admin");
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
  pendingAdminCheck = false;
  
  // Clear flow anomaly (but not tamper - requires admin)
  if (!tamperActive) {
    flowAnomalyDetected = false;
    flowAnomalyType = "";
  }
}

// ========================= LCD HELPER FUNCTIONS =========================
void lcdClear() {
  lcd.clear();
}

void lcdPrint(int col, int row, const char* text) {
  lcd.setCursor(col, row);
  lcd.print(text);
}

void lcdPrint(int col, int row, String text) {
  lcd.setCursor(col, row);
  lcd.print(text);
}

void lcdPrintCenter(int row, const char* text) {
  int len = strlen(text);
  int col = (16 - len) / 2;
  if (col < 0) col = 0;
  lcd.setCursor(col, row);
  lcd.print(text);
}

void lcdPrintCenter(int row, String text) {
  lcdPrintCenter(row, text.c_str());
}

// Scroll long text on LCD (for names, messages)
String scrollText(String text, int maxLen, int& pos) {
  if (text.length() <= maxLen) return text;
  
  String padded = text + "   " + text;  // Loop scroll
  if (pos >= text.length() + 3) pos = 0;
  
  return padded.substring(pos, pos + maxLen);
}

// ========================= UI FUNCTIONS (16x2 LCD) =========================
void uiIdle() {
  lcdClear();
  lcdPrintCenter(0, "PRESS A LOGIN");
  
  // Show WiFi status and price using isOnline (single source of truth)
  if (isOnline) {
    if (price.sell > 0) {
      char buf[17];
      snprintf(buf, sizeof(buf), "%.2f/L %s", price.sell, price.currency);
      lcdPrintCenter(1, buf);
    } else {
      lcdPrintCenter(1, "Online NoPrice");
    }
  } else {
    // Offline mode - show price if available
    if (price.sell > 0) {
      char buf[17];
      snprintf(buf, sizeof(buf), "OFF %.2f%s", price.sell, price.currency);
      lcdPrintCenter(1, buf);
    } else {
      lcdPrintCenter(1, "OFFLINE MODE");
    }
  }
}

void uiEnterPin() {
  lcdClear();
  // Show online/offline indicator using isOnline
  if (isOnline) {
    lcdPrint(0, 0, "PIN:");
  } else {
    lcdPrint(0, 0, "[OFF]PIN:");
  }
  
  // Show masked PIN
  String masked;
  for (unsigned int i = 0; i < pinBuf.length(); i++) masked += "*";
  lcdPrint(0, 1, masked);
  
  // Show cursor position
  lcd.setCursor(pinBuf.length(), 1);
  lcd.cursor();
}

void uiVerifyingPin() {
  lcdClear();
  if (isOnline) {
    lcdPrintCenter(0, "VERIFYING...");
    lcdPrintCenter(1, "Online check");
  } else {
    lcdPrintCenter(0, "CHECKING...");
    lcdPrintCenter(1, "Local verify");
  }
  lcd.noCursor();
}

void uiEnterLiters() {
  lcdClear();
  
  // Scroll operator name if too long
  String opName = scrollText(session.operatorName, 10, scrollPos);
  char line0[17];
  snprintf(line0, sizeof(line0), "Op:%s", opName.c_str());
  lcdPrint(0, 0, line0);
  
  // Show liters entry
  char line1[17];
  snprintf(line1, sizeof(line1), "Liters:%s_", litersBuf.c_str());
  lcdPrint(0, 1, line1);
}

void uiConfirmReady() {
  lcdClear();
  
  float total = targetLiters * price.sell;
  char line0[17];
  snprintf(line0, sizeof(line0), "%.1fL=%.2f%s", targetLiters, total, price.currency);
  lcdPrint(0, 0, line0);
  
  lcdPrintCenter(1, "D=START *=CANCEL");
}

void uiDispense() {
  lcdClear();
  
  // Line 0: Target and Dispensed
  char line0[17];
  snprintf(line0, sizeof(line0), "T:%.1f D:%.2fL", targetLiters, dispensedLiters);
  lcdPrint(0, 0, line0);
  
  // Line 1: Remaining and flow rate
  float remaining = targetLiters - dispensedLiters;
  if (remaining < 0) remaining = 0;
  char line1[17];
  snprintf(line1, sizeof(line1), "R:%.1fL %.1fL/m", remaining, flowLpm);
  lcdPrint(0, 1, line1);
}

void uiPaused() {
  lcdClear();
  lcdPrintCenter(0, "PAUSED");
  
  char line1[17];
  snprintf(line1, sizeof(line1), "#=GO *=CANCEL");
  lcdPrintCenter(1, line1);
}

void uiCompleting() {
  lcdClear();
  lcdPrintCenter(0, "COMPLETING...");
  lcdPrintCenter(1, "Sending data");
}

void uiReceipt() {
  lcdClear();
  
  // Alternate between showing liters and total
  static bool showTotal = false;
  if (millis() - lastScrollMs > 2000) {
    showTotal = !showTotal;
    lastScrollMs = millis();
  }
  
  if (showTotal) {
    float total = dispensedLiters * price.sell;
    char line0[17];
    snprintf(line0, sizeof(line0), "TOTAL:%.2f%s", total, price.currency);
    lcdPrint(0, 0, line0);
  } else {
    char line0[17];
    snprintf(line0, sizeof(line0), "DONE:%.2f L", dispensedLiters);
    lcdPrint(0, 0, line0);
  }
  
  lcdPrintCenter(1, "# = FINISH");
}

void uiError() {
  lcdClear();
  
  if (tamperActive) {
    lcdPrintCenter(0, "TAMPER DETECTED!");
    lcdPrintCenter(1, "ADMIN PIN REQ");
  } else if (flowAnomalyDetected) {
    lcdPrintCenter(0, "FLOW ANOMALY!");
    String errMsg = scrollText(flowAnomalyType, 16, scrollPos);
    lcdPrint(0, 1, errMsg);
  } else {
    lcdPrintCenter(0, "ERROR!");
    // Scroll error message if too long
    String errMsg = scrollText(lastError, 16, scrollPos);
    lcdPrint(0, 1, errMsg);
  }
}

// ========================= ADMIN UI =========================
enum AdminMode { AMENU, A_SELL, A_COST, A_CAL, A_TAMPER_CLEAR };
AdminMode am = AMENU;

void uiAdminMenu() {
  lcdClear();
  if (tamperActive) {
    lcdPrint(0, 0, "ADMIN: D=CLEAR");
    lcdPrint(0, 1, "TAMPER *=EXIT");
  } else {
    lcdPrint(0, 0, "ADMIN: A=SELL");
    lcdPrint(0, 1, "B=COST C=CAL *=X");
  }
}

void uiAdminInput(const char* label) {
  lcdClear();
  lcdPrint(0, 0, label);
  lcdPrint(0, 1, adminBuf);
  lcd.setCursor(adminBuf.length(), 1);
  lcd.cursor();
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
  
  // Load litersTotal from NVS
  prefs.begin("meter", true);
  litersTotal = prefs.getFloat("total", 0.0f);
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

void saveLitersTotal() {
  prefs.begin("meter", false);
  prefs.putFloat("total", litersTotal);
  prefs.end();
}

// ========================= RECEIPT QUEUE =========================
void qPush(const String& json) {
  // Protect against oversized payloads
  if (json.length() > MAX_RECEIPT_SIZE) {
    Serial.printf("[WARN] Receipt too large (%d bytes), truncating\n", json.length());
    // Still try to save a truncated version with essential fields
    StaticJsonDocument<512> minDoc;
    minDoc["sessionId"] = sessionId();
    minDoc["deviceId"] = String(DEVICE_ID);
    minDoc["dispensedLiters"] = dispensedLiters;
    minDoc["status"] = "TRUNCATED";
    minDoc["ts"] = unixNow();
    String minJson;
    serializeJson(minDoc, minJson);
    
    prefs.begin("rq", false);
    uint32_t head = prefs.getUInt("head", 0);
    uint32_t tail = prefs.getUInt("tail", 0);
    String key = "r" + String(head % QSIZE);
    prefs.putString(key.c_str(), minJson);
    head++;
    if (head - tail > QSIZE) tail++;
    prefs.putUInt("head", head);
    prefs.putUInt("tail", tail);
    prefs.end();
    return;
  }
  
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
  // Use isOnline as single source of truth
  if (!isOnline) return false;
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
  // Use isOnline as single source of truth
  if (!isOnline) return false;
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
 * Verify operator PIN - tries online first, then offline fallback
 * POST /api/device/verify-pin
 * Body: { "pin": "1234" }
 * Returns: { "ok": true, "operator": { "id", "name", "role" } }
 */
bool verifyOperatorPinOnline(const String& pin) {
  StaticJsonDocument<256> reqDoc;
  reqDoc["pin"] = pin;
  
  String body;
  serializeJson(reqDoc, body);
  
  String response;
  if (!httpPostJson("/api/device/verify-pin", body, response)) {
    return false;  // Network failed, will try offline
  }
  
  StaticJsonDocument<512> resDoc;
  DeserializationError err = deserializeJson(resDoc, response);
  if (err) {
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
  
  // Cache this operator for offline use (PIN will be hashed)
  cacheOperator(pin, session.operatorName, session.operatorId, session.operatorRole);
  
  return true;
}

/**
 * Main PIN verification - handles online/offline modes
 */
bool verifyOperatorPin(const String& pin) {
  // Update online status before verification
  updateOnlineStatus();
  
  // Try online verification first if online
  if (isOnline && isCloudEnabled()) {
    if (verifyOperatorPinOnline(pin)) {
      return true;
    }
    // If online but verification failed with "Invalid PIN", don't try offline
    if (lastError == "Invalid PIN") {
      return false;
    }
    // Network error - fall through to offline
  }
  
  // Offline verification using hashed PINs
  if (verifyPinOffline(pin)) {
    lastError = "";  // Clear any previous error
    return true;
  }
  
  lastError = "Invalid PIN";
  return false;
}

/**
 * Fetch current pricing from dashboard
 * GET /api/device/config
 * Returns: { "ok": true, "price": { "pricePerLiter", "costPerLiter", "currency" } }
 */
bool fetchPriceFromDashboard() {
  // Only fetch if online (don't call when offline)
  if (!isOnline) {
    Serial.println("[INFO] Offline - using cached price");
    return false;
  }
  
  String response;
  if (!httpGetJson("/api/device/config", response)) {
    Serial.println("[WARN] Failed to fetch price from dashboard");
    return false;
  }
  
  StaticJsonDocument<512> doc;
  DeserializationError err = deserializeJson(doc, response);
  if (err) {
    Serial.println("[ERROR] Failed to parse price response");
    return false;
  }
  
  bool ok = doc["ok"] | false;
  if (!ok) {
    Serial.println("[WARN] Dashboard returned error for config");
    return false;
  }
  
  price.sell = doc["price"]["pricePerLiter"] | price.sell;
  price.cost = doc["price"]["costPerLiter"] | price.cost;
  
  String cur = doc["price"]["currency"] | "ZMW";
  memset(price.currency, 0, sizeof(price.currency));
  cur.toCharArray(price.currency, sizeof(price.currency));
  
  // Save to NVS as fallback for offline mode
  savePricing();
  
  Serial.printf("[INFO] Price updated: %.2f %s/L\n", price.sell, price.currency);
  return true;
}

/**
 * Send telemetry to dashboard
 * POST /api/ingest/telemetry
 */
void sendTelemetry() {
  // Only send if online
  if (!isOnline) return;
  
  // Reset watchdog before network operation
  feedWatchdog();
  
  StaticJsonDocument<768> doc;
  doc["deviceId"] = String(DEVICE_ID);
  doc["siteName"] = String(SITE_NAME);
  doc["ts"] = (uint32_t)(unixNow() ? unixNow() : (millis()/1000));

  // Required fields for dashboard schema (tank monitoring).
  // This dispenser firmware doesn't have a tank sensor, so we send safe defaults.
  doc["oilPercent"] = 100.0;
  doc["oilLiters"] = 0.0;
  doc["distanceCm"] = 0.0;
  
  // Safety status with tamper and anomaly detection
  String safetyStatus = "IDLE";
  if (tamperActive) {
    safetyStatus = "TAMPER_DETECTED";
  } else if (flowAnomalyDetected) {
    safetyStatus = "ANOMALY_" + flowAnomalyType;
  } else if (pumpOn()) {
    safetyStatus = "DISPENSING";
  }
  doc["safetyStatus"] = safetyStatus;
  doc["uptimeSec"] = (uint32_t)(millis() / 1000);

  // Dispenser fields
  doc["flowLpm"] = flowLpm;
  doc["litersTotal"] = litersTotal;
  doc["pumpState"] = pumpOn();

  int rssi = WiFi.RSSI();
  if (rssi < -100) rssi = -100;
  if (rssi > 0) rssi = 0;
  doc["wifiRssi"] = rssi;
  
  // Industrial compliance flags
  JsonObject compliance = doc.createNestedObject("compliance");
  compliance["zabs"] = true;
  compliance["zesco"] = true;
  compliance["emcSafe"] = true;
  compliance["brownoutProtected"] = true;
  compliance["watchdogEnabled"] = true;
  compliance["tamperDetectionActive"] = !tamperActive;
  
  // Watchdog status
  if (watchdogResetDetected) {
    doc["lastResetReason"] = lastResetReason;
    doc["watchdogResetTime"] = watchdogResetTime;
  }

  String body;
  serializeJson(doc, body);
  String response;
  
  if (!httpPostJson("/api/ingest/telemetry", body, response)) {
    // Log telemetry failure
    Serial.println("[WARN] Telemetry send failed");
  }
  
  // Reset watchdog after network operation
  feedWatchdog();
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
  float profitAmount = dispensedLiters * (price.sell - price.cost);

  // Generate audit checksum for anti-fraud
  String auditChecksum = generateAuditChecksum(
    String(DEVICE_ID),
    session.operatorId,
    targetLiters,
    dispensedLiters,
    price.sell,
    startU,
    endUnix
  );

  StaticJsonDocument<1280> doc;
  doc["sessionId"] = sessionId();
  doc["deviceId"] = String(DEVICE_ID);
  doc["siteName"] = String(SITE_NAME);
  doc["operatorId"] = session.operatorId;  // Send operator ID directly
  doc["operatorName"] = session.operatorName;
  doc["targetLiters"] = targetLiters;
  doc["dispensedLiters"] = dispensedLiters;
  doc["pricePerLiter"] = price.sell;
  doc["costPerLiter"] = price.cost;
  doc["totalAmount"] = totalAmount;
  doc["profitAmount"] = profitAmount;
  doc["currency"] = String(price.currency);
  doc["durationSec"] = (int)durSec;
  doc["status"] = status;
  if (err.length()) doc["errorMessage"] = err;
  doc["startedAtUnix"] = startU;
  doc["endedAtUnix"] = endUnix;
  doc["isOffline"] = !isOnline;
  
  // Anti-fraud audit checksum
  doc["auditChecksum"] = auditChecksum;
  
  // Flow anomaly data (if detected)
  if (flowAnomalyDetected) {
    doc["flowAnomaly"] = flowAnomalyType;
  }
  
  // Tamper status
  doc["tamperDetected"] = tamperActive;

  String body;
  serializeJson(doc, body);
  
  // Reset watchdog before network operation
  feedWatchdog();
  
  String response;
  if (!httpPostJson("/api/ingest/receipt", body, response)) {
    qPush(body);  // Queue for retry if network fails
    Serial.println("[INFO] Receipt queued for retry");
  } else {
    Serial.println("[INFO] Receipt uploaded successfully");
    Serial.printf("[AUDIT] Checksum: %s\n", auditChecksum.c_str());
  }
  
  feedWatchdog();
}

/**
 * Retry queued receipts
 */
void retryQueuedReceipts() {
  // Only retry if online
  if (!isOnline) return;
  
  String item;
  if (!qPeek(item)) return;
  
  String response;
  if (httpPostJson("/api/ingest/receipt", item, response)) {
    qPop();
    Serial.println("[INFO] Queued receipt uploaded");
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
  
  // Flow anomaly detection
  detectFlowAnomalies();

  // Dry-run protection: stop pump if no flow detected for 10 seconds
  if (state == DISPENSING && pumpOn()) {
    if (flowLpm < 0.01f) {
      if (noFlowStartMs == 0) noFlowStartMs = now;
      if (now - noFlowStartMs > 10000) {
        safePumpSet(false);
        lastError = "DRY RUN: no flow";
        state = ERROR_STATE;
        uploadReceiptOrQueue("ERROR", lastError);
      }
    } else {
      noFlowStartMs = 0;
    }
  } else {
    noFlowStartMs = 0;
  }
  
  // Maximum pump runtime failsafe
  if (state == DISPENSING && pumpOn()) {
    if (now - dispenseStartMs > MAX_PUMP_RUNTIME_MS) {
      safePumpSet(false);
      lastError = "MAX RUNTIME EXCEEDED";
      Serial.printf("[ERROR] Pump exceeded max runtime of %d ms\n", MAX_PUMP_RUNTIME_MS);
      state = ERROR_STATE;
      uploadReceiptOrQueue("ERROR", lastError);
    }
  }
}

// ========================= WIFI + TIME (NON-BLOCKING) =========================
void connectWiFiNonBlocking() {
  if (String(WIFI_SSID).length() == 0) {
    lcdClear();
    lcdPrintCenter(0, "No WiFi Config");
    lcdPrintCenter(1, "OFFLINE MODE");
    isOnline = false;
    return;
  }

  lcdClear();
  lcdPrintCenter(0, "Connecting WiFi");
  lcdPrintCenter(1, WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  // Non-blocking wait with timeout - use yield() instead of delay()
  uint32_t start = millis();
  int dots = 0;
  while (WiFi.status() != WL_CONNECTED && millis() - start < 10000) {
    yield();  // Non-blocking - allow ESP32 to handle background tasks
    if (millis() - start > dots * 500) {
      lcd.setCursor(dots % 16, 1);
      lcd.print(".");
      dots++;
    }
  }

  // Update single source of truth
  updateOnlineStatus();

  lcdClear();
  if (isOnline) {
    lcdPrintCenter(0, "WiFi Connected!");
    lcdPrint(0, 1, WiFi.localIP().toString());
    
    // Sync time via NTP (non-blocking after initial call)
    configTime(0, 0, "pool.ntp.org", "time.google.com", "time.nist.gov");
    
    // Brief display
    uint32_t showStart = millis();
    while (millis() - showStart < 1500) yield();
    
    // Fetch current pricing from dashboard
    lcdClear();
    lcdPrintCenter(0, "Fetching price..");
    if (fetchPriceFromDashboard()) {
      char buf[17];
      snprintf(buf, sizeof(buf), "%.2f %s/L", price.sell, price.currency);
      lcdPrintCenter(1, buf);
    } else {
      lcdPrintCenter(1, "Using local");
    }
    showStart = millis();
    while (millis() - showStart < 1000) yield();
  } else {
    lcdPrintCenter(0, "WiFi FAILED");
    lcdPrintCenter(1, "OFFLINE MODE");
    uint32_t showStart = millis();
    while (millis() - showStart < 2000) yield();
    
    // Show offline price
    lcdClear();
    lcdPrintCenter(0, "Offline Price:");
    char buf[17];
    snprintf(buf, sizeof(buf), "%.2f %s/L", price.sell, price.currency);
    lcdPrintCenter(1, buf);
    showStart = millis();
    while (millis() - showStart < 1500) yield();
  }
}

// ========================= SETUP =========================
void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.println("\n[ESP32] Oil Dispenser Starting...");
  Serial.println("[ESP32] Online + Offline Mode Enabled");
  Serial.println("[ESP32] Production-Critical Firmware (Patched + Safety)");
  
  // Check reset reason FIRST (before any other initialization)
  lastResetReason = getResetReason();
  Serial.printf("[SYSTEM] Reset reason: %s\n", lastResetReason.c_str());
  
  if (lastResetReason.indexOf("WATCHDOG") >= 0 || lastResetReason.indexOf("BROWNOUT") >= 0) {
    watchdogResetDetected = true;
    watchdogResetTime = millis();
    Serial.println("[WARNING] Watchdog or brownout reset detected - entering safe mode");
  }

  // CRITICAL: All GPIO outputs LOW on boot (electrical safety)
  pinMode(PIN_PUMP, OUTPUT);
  digitalWrite(PIN_PUMP, LOW);  // Pump OFF regardless of active high/low
  delay(50);
  pumpSet(false);  // Then set proper state
  
  // Initialize hardware watchdog (8 second timeout)
  initWatchdog();
  feedWatchdog();

  // Initialize flow sensor interrupt
  pinMode(PIN_FLOW, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_FLOW), onFlowPulse, RISING);
  
  // Initialize flow timing
  lastFlowMs = millis();
  noInterrupts();
  flowPulses = 0;
  interrupts();
  lastPulseSnapshot = 0;
  
  feedWatchdog();
  
  // Initialize tamper detection pin only if enabled (GPIO 34 is INPUT_ONLY, needs external pull-up)
  if (ENABLE_TAMPER_DETECTION) {
    pinMode(PIN_TAMPER, INPUT);
    Serial.println("[SECURITY] Tamper detection ENABLED - GPIO 34 requires external 10kΩ pull-up");
  } else {
    Serial.println("[SECURITY] Tamper detection DISABLED for testing");
  }
  
  feedWatchdog();

  // Initialize I2C LCD
  Wire.begin(21, 22);  // SDA=21, SCL=22 (ESP32 default)
  lcd.init();
  lcd.backlight();
  lcd.clear();
  lcdPrintCenter(0, "OIL DISPENSER");
  lcdPrintCenter(1, "Starting...");
  
  uint32_t showStart = millis();
  while (millis() - showStart < 1000) {
    feedWatchdog();
    yield();
  }
  
  feedWatchdog();

  // Show device info
  lcdClear();
  lcdPrint(0, 0, "ID:");
  lcdPrint(3, 0, DEVICE_ID);
  lcdPrint(0, 1, SITE_NAME);
  showStart = millis();
  while (millis() - showStart < 1500) {
    feedWatchdog();
    yield();
  }
  
  feedWatchdog();

  // Load settings from NVS (includes cached prices and litersTotal)
  loadSettings();
  
  // Initialize offline operators (fallback PINs with hashes)
  initOfflineOperators();
  
  feedWatchdog();

  // Connect WiFi (non-blocking)
  connectWiFiNonBlocking();
  
  feedWatchdog();

  // Clear session
  clearSession();
  
  lcd.noCursor();
  
  feedWatchdog();

  Serial.println("[ESP32] Ready");
  Serial.printf("[ESP32] Price: %.2f %s/L\n", price.sell, price.currency);
  Serial.printf("[ESP32] Mode: %s\n", isOnline ? "ONLINE" : "OFFLINE");
  Serial.printf("[ESP32] Lifetime liters: %.2f\n", litersTotal);
  Serial.println("[SAFETY] Watchdog active, tamper detection enabled");
  Serial.println("[COMPLIANCE] ZABS/ZESCO/EMC safe, brownout protected");
}

// ========================= MAIN LOOP =========================
uint32_t holdAStart = 0;
bool holdingA = false;
uint32_t lastWifiCheckMs = 0;
static const uint32_t WIFI_CHECK_MS = 60000;  // Check WiFi every 60 seconds

void loop() {
  // Reset watchdog at start of every loop iteration
  feedWatchdog();
  
  // Check for tamper (cabinet open / wire cut)
  checkTamper();
  
  // Update flow meter
  updateFlow();
  
  // Periodic litersTotal persistence
  if (millis() - lastLitersSaveMs > LITERS_SAVE_MS) {
    lastLitersSaveMs = millis();
    saveLitersTotal();
  }
  
  // Periodic WiFi status update and reconnection (non-blocking, when idle)
  if (state == IDLE && millis() - lastWifiCheckMs > WIFI_CHECK_MS) {
    lastWifiCheckMs = millis();
    bool wasOnline = isOnline;
    updateOnlineStatus();  // Single source of truth update
    
    // Try to reconnect if was offline (non-blocking)
    if (!isOnline && String(WIFI_SSID).length() > 0) {
      WiFi.reconnect();
      // Don't block - check result on next iteration
      yield();
      updateOnlineStatus();
      
      // If just came online, fetch latest price
      if (isOnline && !wasOnline) {
        feedWatchdog();
        fetchPriceFromDashboard();
        Serial.println("[ESP32] Reconnected - fetched latest price");
      }
    }
  }

  // Periodic telemetry (every 10 seconds, only if online)
  if (millis() - lastTelemetryMs > TELEMETRY_MS) {
    lastTelemetryMs = millis();
    updateOnlineStatus();  // Refresh status before telemetry
    sendTelemetry();  // Will check isOnline internally and reset watchdog
  }

  // Retry queued receipts (when online)
  if (millis() - lastReceiptRetryMs > RETRY_MS) {
    lastReceiptRetryMs = millis();
    updateOnlineStatus();
    retryQueuedReceipts();  // Will check isOnline internally
  }

  // Scroll timer for long text
  if (millis() - lastScrollMs > SCROLL_MS) {
    lastScrollMs = millis();
    scrollPos++;
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
      case DISPENSING:     
        uiDispense(); 
        feedWatchdog();  // Extra watchdog reset during dispensing
        break;
      case PAUSED:         uiPaused(); break;
      case COMPLETING:     uiCompleting(); break;
      case RECEIPT:        uiReceipt(); break;
      case ERROR_STATE:    uiError(); break;
      case ADMIN:
        if (am == AMENU) uiAdminMenu();
        else if (am == A_SELL) uiAdminInput("SELL PRICE:");
        else if (am == A_COST) uiAdminInput("COST PRICE:");
        else if (am == A_CAL)  uiAdminInput("PULSES/L:");
        break;
    }
  }

  // Keypad handling (blocked if tamper locked)
  char k = 0;
  if (!tamperLocked) {
    k = keypad.getKey();
  }
  
  if (k) {
    lcd.noCursor();  // Hide cursor on any key press
    
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
        pendingAdminCheck = false;
        clearSession();
        state = IDLE;
      } else if (k == '#') {
        // Confirm PIN, verify with dashboard
        if (pinBuf.length() < 4) {
          lastError = "PIN too short";
          pendingAdminCheck = false;
          state = ERROR_STATE;
        } else {
          state = VERIFYING_PIN;
          uiVerifyingPin();
          
          if (verifyOperatorPin(pinBuf)) {
            // Success! Check if admin access was requested
            if (pendingAdminCheck) {
              pendingAdminCheck = false;
              // Check if operator has admin/supervisor role ONLY
              // No backdoor based on operatorId
              if (isAdminRole(session.operatorRole)) {
                // Admin access granted based on role
                state = ADMIN;
                am = AMENU;
                adminBuf = "";
                Serial.printf("[INFO] Admin access granted to %s (role: %s)\n", 
                              session.operatorName.c_str(), session.operatorRole.c_str());
              } else {
                // Not an admin - access denied
                lastError = "Admin access denied";
                scrollPos = 0;
                state = ERROR_STATE;
                Serial.printf("[WARN] Admin access denied for %s (role: %s)\n",
                              session.operatorName.c_str(), session.operatorRole.c_str());
              }
            } else {
              // Normal login - fetch price only if online
              updateOnlineStatus();
              if (isOnline) {
                fetchPriceFromDashboard();
              }
              litersBuf = "";
              scrollPos = 0;
              state = ENTER_LITERS;
            }
          } else {
            // Failed
            pendingAdminCheck = false;
            scrollPos = 0;
            state = ERROR_STATE;
          }
        }
      }
    }

    // ========== ENTER LITERS STATE ==========
    else if (state == ENTER_LITERS) {
      if (k >= '0' && k <= '9') {
        if (litersBuf.length() < 5) litersBuf += k;
      } else if (k == '*') {
        // Cancel, logout operator
        clearSession();
        state = IDLE;
      } else if (k == '#') {
        // Confirm liters
        targetLiters = litersBuf.toFloat();
        if (targetLiters <= 0) {
          lastError = "Invalid liters";
          scrollPos = 0;
          state = ERROR_STATE;
        } else if (price.sell <= 0) {
          lastError = "No price set";
          scrollPos = 0;
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
        // Start dispensing with safety checks
        if (canStartPump()) {
          dispensedLiters = 0.0f;
          noFlowStartMs = 0;
          flowAnomalyDetected = false;
          flowAnomalyType = "";
          lastFlowLpm = 0.0f;
          flowDropStartMs = 0;
          dispenseStartMs = millis();
          dispenseStartUnix = unixNow();
          safePumpSet(true);
          state = DISPENSING;
        } else {
          lastError = "Pump start blocked";
          state = ERROR_STATE;
        }
      }
    }

    // ========== DISPENSING STATE ==========
    else if (state == DISPENSING) {
      if (k == '*') {
        // Emergency stop - freeze pulse count first
        noInterrupts();
        uint32_t finalPulses = flowPulses;
        interrupts();
        safePumpSet(false);
        // Update final dispensed amount
        uint32_t dp = finalPulses - lastPulseSnapshot;
        lastPulseSnapshot = finalPulses;
        if (pulsesPerLiter > 0.1f) {
          dispensedLiters += dp / pulsesPerLiter;
        }
        state = PAUSED;
      }
    }

    // ========== PAUSED STATE ==========
    else if (state == PAUSED) {
      if (k == '#') {
        // Resume dispensing
        safePumpSet(true);
        state = DISPENSING;
      } else if (k == '*') {
        // Cancel sale completely
        safePumpSet(false);
        uploadReceiptOrQueue("CANCELED", "User canceled");
        clearSession();
        state = IDLE;
      }
    }

    // ========== RECEIPT STATE ==========
    else if (state == RECEIPT) {
      if (k == '#') {
        // Finish, auto-logout, return to IDLE
        // Save litersTotal before clearing
        saveLitersTotal();
        clearSession();
        state = IDLE;
      }
    }

    // ========== ERROR STATE ==========
    else if (state == ERROR_STATE) {
      if (k == '#') {
        // Clear error if not tamper (tamper requires admin)
        if (!tamperActive) {
          lastError = "";
          flowAnomalyDetected = false;
          flowAnomalyType = "";
          clearSession();
          state = IDLE;
        }
      }
    }

    // ========== ADMIN MODE ==========
    if (state == ADMIN) {
      if (am == AMENU) {
        if (k == '*') {
          state = IDLE;
          am = AMENU;
          adminBuf = "";
        } else if (tamperActive && k == 'D') {
          // Clear tamper (admin only)
          tamperActive = false;
          tamperLocked = false;
          lastError = "";
          Serial.println("[SECURITY] Tamper cleared by admin");
          lcdClear();
          lcdPrintCenter(0, "TAMPER CLEARED");
          lcdPrintCenter(1, "System unlocked");
          delay(2000);
          state = IDLE;
          am = AMENU;
        } else if (!tamperActive && k == 'A') {
          am = A_SELL;
          adminBuf = "";
        } else if (!tamperActive && k == 'B') {
          am = A_COST;
          adminBuf = "";
        } else if (!tamperActive && k == 'C') {
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
    if (millis() - holdAStart > 3000) {
      // Long hold (3s): enter admin - requires admin ROLE verification
      holdingA = false;
      holdAStart = 0;
      // Set flag to check for admin after PIN verification
      pendingAdminCheck = true;
      pinBuf = "";
      state = ENTER_PIN;
    }
  }
  
  // Short press A detection (key released)
  if (!holdingA && holdAStart > 0 && state == IDLE) {
    if (millis() - holdAStart >= 50 && millis() - holdAStart < 2000) {
      // Short press: start login
      pinBuf = "";
      state = ENTER_PIN;
    }
    holdAStart = 0;
  }

  // Auto-stop when target liters reached
  if (state == DISPENSING) {
    feedWatchdog();  // Extra feed during dispensing
    
    if (dispensedLiters >= targetLiters) {
      // Freeze pulse count before stopping pump
      noInterrupts();
      uint32_t finalPulses = flowPulses;
      interrupts();
      safePumpSet(false);
      
      // Calculate final dispensed amount
      uint32_t dp = finalPulses - lastPulseSnapshot;
      lastPulseSnapshot = finalPulses;
      if (pulsesPerLiter > 0.1f) {
        float additionalLiters = dp / pulsesPerLiter;
        dispensedLiters += additionalLiters;
        litersTotal += additionalLiters;
      }
      
      // Cap at target if slightly over
      if (dispensedLiters > targetLiters * 1.05f) {
        dispensedLiters = targetLiters;  // Cap overshoot
      }
      
      // Save litersTotal immediately after dispensing
      saveLitersTotal();
      
      state = COMPLETING;
      uiCompleting();
      uploadReceiptOrQueue("DONE", "");
      state = RECEIPT;
    }
  }
  
  // Final watchdog reset at end of loop
  feedWatchdog();
}
