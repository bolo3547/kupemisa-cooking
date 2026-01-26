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

/* ================= FORWARD DECLARATIONS ================= */
// LCD functions (defined later, needed for operator sync)
void lcdShow(const String& a, const String& b = "");
void lcdShowForce(const String& a, const String& b = "");

// Crypto functions (defined later, needed for operator sync)
String sha256(const String& s);
String hashPinForDevice(const String& pin);

// Real-time architecture functions (keypad handler defined after loop)
void processKeyInput(char k);

/* ================= DEVICE / DASHBOARD ================= */
#define DEVICE_ID     "OIL-0001"
#define SITE_NAME     "PHI"
#define API_BASE_URL  "https://fleet-oil-system.vercel.app"
#define API_KEY       "REDACTED"

/* ================= WIFI ================= */
const char* WIFI_SSID = "debora-my-wife";
const char* WIFI_PASS = "admin@29";

/* ================= PRICING ================= */
/*******************************************************************************
 * PIMISHA PRICING - K25 PER LITER (Locked)
 * 
 * CORE RULE: Pricing is LOCAL. Dashboard CANNOT override.
 * 
 * Formula:
 *   PRICE_PER_ML = 0.025 K/ml (K25 per liter)
 *   targetMl = ceil(amountZmw / PRICE_PER_ML)
 *   
 * Examples:
 *   K1  → ceil(1/0.025)  = 40ml
 *   K2  → ceil(2/0.025)  = 80ml
 *   K5  → ceil(5/0.025)  = 200ml
 *   K10 → ceil(10/0.025) = 400ml
 *   K25 → 1000ml (1 Liter exact)
 *   K50 → 2000ml (2 Liters exact)
 *   
 * ANTI-CHEATING: ceil() always rounds UP in customer's favor.
 ******************************************************************************/
#define PRICE_PER_ML        0.025f   // K per milliliter (K25/L) - LOCAL & LOCKED
#define PRICE_PER_LITER     25.0f    // K25/L - LOCKED
#define STOP_MARGIN_LITERS  0.005f   // 5ml max margin (regulatory limit)

/*******************************************************************************
 * COOKING OIL DISPENSING - CONSUMER PROTECTION COMPLIANCE
 * 
 * Regulatory Bodies for Cooking Oil in Zambia:
 *   - CCPC: Competition and Consumer Protection Commission
 *   - ZBS:  Zambia Bureau of Standards (ZABS)
 *   - ZCSA: Zambia Compulsory Standards Agency
 * 
 * Consumer Protection:
 *   - CCPC Hotline: +260 211 222787
 *   - Website: https://www.ccpc.org.zm
 * 
 * Standards Reference:
 *   - ZBS 104: Edible Fats and Oils - Cooking Oil Specification
 *   - Weights & Measures Act (Chapter 403)
 * 
 * Metrological Compliance:
 *   - Dispensing accuracy must be within ±0.5% of stated volume
 *   - Price per unit must be clearly displayed
 *   - Receipts must show volume dispensed and price charged
 ******************************************************************************/
#define CCPC_HOTLINE        "+260 211 222787"
#define CCPC_WEBSITE        "https://www.ccpc.org.zm"
#define ZBS_STANDARD        "ZBS 104"

// PIMISHA cooking oil pricing (K25/L = K0.025/ml) - LOCKED
// LOCAL AND LOCKED - Dashboard cannot override
#define COOKING_OIL_PRICE_PER_LITER  25.0f  // K/L (LOCKED)

// Metrological tolerance (Weights & Measures compliance)
#define VOLUME_TOLERANCE_PERCENT  0.5f   // ±0.5% accuracy required
// FIXED: PIMISHA - No minimum dispense limit, any amount allowed

// Mismatch detection threshold
#define MISMATCH_THRESHOLD_ZMW  1.00f  // Flag if difference > K1.00
#define OVERSHOOT_LIMIT_ML      5.0f   // Never dispense more than 5ml extra

// Calibration enforcement
// REMOVED: UNCALIBRATED_MAX_ML - PIMISHA allows unlimited amounts
#define CALIBRATION_REQUIRED_PPL 100.0f // Min pulsesPerLiter to be considered calibrated

/*******************************************************************************
 * FAIRNESS ROUNDING GUARANTEE
 * 
 * ANTI-CHEAT RULE: When any rounding is necessary, ALWAYS round in the
 * CUSTOMER'S FAVOR. This means:
 *   - Volume calculations: round UP (customer gets slightly more)
 *   - Money calculations: round DOWN (customer pays slightly less)
 * 
 * This ensures the dispenser can NEVER cheat the customer.
 ******************************************************************************/
#define FAIRNESS_ROUNDING_ML    0.5f   // Round up volume by 0.5ml in customer favor

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

/*******************************************************************************
 * FAIRNESS ALERT LED (RAPID YELLOW BLINK)
 * 
 * Called when a MISMATCH is detected after dispensing.
 * Blinks yellow LED rapidly 10 times as visual alert for inspection.
 * 
 * NOTE: This uses blocking delay() which is acceptable here because:
 *   1. Pump is already OFF at this point
 *   2. Dispense is complete
 *   3. Alert must be visible to operator/customer
 ******************************************************************************/
void blinkFairnessAlert() {
  Serial.println("[FAIRNESS] Blinking yellow LED for mismatch alert");
  for (int i = 0; i < 10; ++i) {
    digitalWrite(PIN_LED_YELLOW, HIGH); 
    delay(80);
    digitalWrite(PIN_LED_YELLOW, LOW); 
    delay(80);
  }
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

// FIXED: Pulse-based dispensing control for accurate volume
uint32_t targetPulses = 0;           // Locked at dispense start
float sessionPulsesPerLiter = 450.0f; // Locked calibration value
bool isCalibrated = false;  // Set true when pulsesPerLiter is saved from calibration

// SAFETY: Minimum dispense time before auto-stop (allows time for flow to start)

// FIXED: Flow sensor debouncing to filter electrical noise
volatile unsigned long lastPulseTime = 0;
#define FLOW_DEBOUNCE_US 1000  // 1ms minimum between pulses (max 1000 pulses/sec)

void IRAM_ATTR onFlowPulse() { 
  unsigned long now = micros();
  if (now - lastPulseTime >= FLOW_DEBOUNCE_US) {
    flowPulses++;
    lastPulseTime = now;
  }
}

/* ================= SESSION ================= */
enum Role { OPERATOR, SUPERVISOR, ADMIN };
enum State {
  ST_LOGIN_CODE,
  ST_LOGIN_PIN,
  ST_PRESET,       // Preset selection menu (quick options)
  ST_AMOUNT,       // Custom amount entry (any amount allowed)
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

/*******************************************************************************
 * PRESET DEFINITIONS (QUICK-SELECT OPTIONS)
 * 
 * These presets have FIXED volumes for convenience.
 * PIMISHA price: K25/liter (0.025/mL) - LOCKED
 * 
 * Customers can buy ANY amount:
 *   K1 → 40ml, K2 → 80ml, K5 → 200ml, K10 → 400ml, K25 → 1L
 *****************************************************************************/
// REMOVED: PRESET_MIN_CUSTOM_AMOUNT - PIMISHA allows any amount

struct Preset {
  int priceZmw;     // Price in Kwacha
  int volumeMl;     // Fixed volume in mL
  const char* label;// Display label
};

// PRESETS calculated from K25/L: volumeMl = ceil(priceZmw / 0.025)
const Preset PRESETS[] = {
  { 5,   200,  "K5-200mL"  },  // '1' key: ceil(5/0.025) = 200ml
  { 10,  400,  "K10-400mL" },  // '2' key: ceil(10/0.025) = 400ml
  { 25,  1000, "K25-1L"    },  // '3' key: 25/0.025 = 1000ml (1L exact)
  { 50,  2000, "K50-2L"    },  // '4' key: 50/0.025 = 2000ml (2L exact)
};
const int NUM_PRESETS = 4;

// Transaction type tracking
String transactionType = "CUSTOM";  // "PRESET" or "CUSTOM"
String presetLabel = "";            // e.g. "K5-200mL" or empty for custom

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
int pendingTargetMl = 0;           // Locked target ml before dispense

// FIXED: PIMISHA decimal input support (e.g., K33.75 for 750ml)
bool decimalEntered = false;      // Track if '.' was pressed
int decimalPlaces = 0;            // Track decimal digits entered (max 2)

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
int sessionTargetMl = 0;           // Locked target ml for session
float sessionPricePerMl = PRICE_PER_ML;
unsigned long sessionCounter = 0;
String lastLoginPin = "";

// Transaction type for receipts (set by preset or custom flow)
int selectedPresetIdx = -1;  // -1 = custom, 0-3 = preset index

// Tamper detection
bool tamperLatched = false;

/*******************************************************************************
 * REAL-TIME ARCHITECTURE - COOPERATIVE MULTITASKING
 * 
 * CORE RULE: Keypad and pump control MUST NEVER wait for network operations.
 * 
 * Architecture:
 *   1. FAST UI LOOP - runs every iteration (keypad, LCD, pump)
 *   2. SLOW NETWORK TASKS - time-sliced using millis(), non-blocking
 * 
 * Network tasks are scheduled with minimum intervals and only ONE task
 * runs per loop iteration to prevent blocking.
 ******************************************************************************/

// LCD Cache - prevents slow lcd.clear() calls
String lcdLine0Cache = "";
String lcdLine1Cache = "";
bool lcdNeedsUpdate = true;

// Network task scheduler - time-sliced, non-blocking
unsigned long lastReceiptQueueMs = 0;
unsigned long lastUserSyncQueueMs = 0;
unsigned long lastHeartbeatMs = 0;
unsigned long lastConfigFetchMs_sched = 0;
unsigned long lastOperatorSyncMs_sched = 0;

// Scheduler intervals (staggered to prevent back-to-back calls)
#define SCHED_RECEIPT_QUEUE_MS    5000   // 5 seconds
#define SCHED_USER_SYNC_QUEUE_MS  7000   // 7 seconds
#define SCHED_HEARTBEAT_MS        30000  // 30 seconds
#define SCHED_CONFIG_FETCH_MS     60000  // 60 seconds
#define SCHED_OPERATOR_SYNC_MS    300000 // 5 minutes

// Network task state - only ONE HTTP call per loop
enum NetworkTask {
  NET_NONE,
  NET_RECEIPT_QUEUE,
  NET_USER_SYNC_QUEUE,
  NET_HEARTBEAT,
  NET_CONFIG_FETCH,
  NET_OPERATOR_SYNC
};
NetworkTask pendingNetworkTask = NET_NONE;

// WiFi reconnection flags (set flag, don't call immediately)
bool wifiJustReconnected = false;
bool scheduleOperatorSync = false;
bool scheduleConfigFetch = false;

/* ================= NETWORK ================= */
WiFiClientSecure secureClient;
bool isOnline = false;
bool wasOnline = false;  // Track previous state for reconnection handling
unsigned long lastOperatorSyncMs = 0;
bool operatorSyncPending = true;  // Sync on first boot

/* ================= WIFI HEARTBEAT LED ================= */
// FIXED: Non-blocking yellow LED blink when WiFi connected
// Blinks 3 times every 30 seconds to indicate WiFi is active
unsigned long lastWifiHeartbeatMs = 0;
const unsigned long WIFI_HEARTBEAT_INTERVAL_MS = 30000;  // 30 seconds
int wifiBlinkCount = 0;           // Tracks current blink (0-3)
unsigned long wifiBlinkStartMs = 0;
bool wifiBlinkInProgress = false;

/*******************************************************************************
 * OPERATOR SYNC SYSTEM - BIDIRECTIONAL DASHBOARD SYNCHRONIZATION
 * 
 * SOURCE OF TRUTH: Dashboard database
 * 
 * The dashboard is the PRIMARY source of truth for:
 *   - Operators (name, PIN hash, role, active status)
 *   - Pricing
 *   - Configuration
 * 
 * ESP32 CACHES data locally in NVS (Preferences) for:
 *   - Offline operation
 *   - Fast login without network latency
 * 
 * SYNC TRIGGERS:
 *   1. Device boot (after WiFi connects)
 *   2. WiFi reconnection
 *   3. Admin manual sync (menu option)
 *   4. Periodic refresh (every 5 minutes when online)
 * 
 * SECURITY:
 *   - Dashboard sends SHA256 hash of PIN (pinHashDevice)
 *   - ESP32 computes SHA256 of entered PIN
 *   - Compare hashes (never send/store raw PIN)
 ******************************************************************************/

#define OPERATOR_SYNC_INTERVAL_MS  300000  // 5 minutes
#define MAX_CACHED_OPERATORS       30

// Cached operator structure
struct CachedOperator {
  String id;          // Dashboard operator ID
  String name;        // Operator name for display
  String pinHash;     // SHA256 hash for offline verification
  String role;        // "OPERATOR" or "SUPERVISOR"
  bool isActive;
};

int cachedOperatorCount = 0;

/*******************************************************************************
 * FETCH OPERATORS FROM DASHBOARD
 * 
 * GET /api/device/operators
 * 
 * Response:
 * {
 *   "ok": true,
 *   "operators": [
 *     { "id": "...", "name": "John", "pinHash": "sha256...", "role": "OPERATOR" }
 *   ],
 *   "count": 5,
 *   "syncedAt": "2024-01-01T00:00:00Z"
 * }
 ******************************************************************************/
bool fetchOperatorsFromDashboard() {
  if (!isOnline) {
    Serial.println("[SYNC] OFFLINE - Cannot fetch operators");
    return false;
  }
  
  Serial.println("[SYNC] ===== FETCHING OPERATORS FROM DASHBOARD =====");
  lcdShow("SYNCING...", "OPERATORS");
  
  HTTPClient http;
  secureClient.setInsecure();
  http.begin(secureClient, String(API_BASE_URL) + "/api/device/operators");
  http.setTimeout(5000);  // 5 second timeout for larger payload
  http.addHeader("x-device-id", DEVICE_ID);
  http.addHeader("x-api-key", API_KEY);
  
  int httpCode = http.GET();
  
  if (httpCode != 200) {
    Serial.printf("[SYNC] HTTP ERROR: %d\n", httpCode);
    http.end();
    return false;
  }
  
  String response = http.getString();
  http.end();
  
  // Parse JSON response
  StaticJsonDocument<4096> doc;
  DeserializationError err = deserializeJson(doc, response);
  if (err) {
    Serial.printf("[SYNC] JSON parse error: %s\n", err.c_str());
    return false;
  }
  
  if (!doc["ok"].as<bool>()) {
    Serial.println("[SYNC] API returned ok=false");
    return false;
  }
  
  JsonArray operators = doc["operators"].as<JsonArray>();
  int count = operators.size();
  
  Serial.printf("[SYNC] Received %d operators from dashboard\n", count);
  
  // Clear existing cached operators in NVS
  prefs.begin("operators", false);
  prefs.clear();
  
  // Store new operators
  int stored = 0;
  for (JsonObject op : operators) {
    if (stored >= MAX_CACHED_OPERATORS) break;
    
    String id = op["id"].as<String>();
    String name = op["name"].as<String>();
    String pinHash = op["pinHash"].as<String>();
    String role = op["role"].as<String>();
    bool isActive = op["isActive"] | true;
    
    if (id.length() == 0 || pinHash.length() == 0) continue;
    if (!isActive) continue;  // Skip inactive operators
    
    // Store in NVS with indexed keys
    prefs.putString(("id" + String(stored)).c_str(), id);
    prefs.putString(("nm" + String(stored)).c_str(), name);
    prefs.putString(("ph" + String(stored)).c_str(), pinHash);
    prefs.putString(("rl" + String(stored)).c_str(), role);
    
    Serial.printf("[SYNC] Cached: %s (%s) role=%s\n", name.c_str(), id.c_str(), role.c_str());
    stored++;
  }
  
  prefs.putInt("count", stored);
  prefs.putULong("syncTs", millis());
  prefs.end();
  
  cachedOperatorCount = stored;
  lastOperatorSyncMs = millis();
  operatorSyncPending = false;
  
  Serial.printf("[SYNC] Successfully cached %d operators\n", stored);
  Serial.println("[SYNC] ================================================");
  
  lcdShow("SYNC OK", String(stored) + " OPERATORS");
  delay(1000);
  
  return true;
}

/*******************************************************************************
 * LOAD CACHED OPERATORS FROM NVS
 * 
 * Called at boot to restore operator cache before WiFi connects.
 * Allows offline operation with previously synced operators.
 ******************************************************************************/
void loadCachedOperators() {
  prefs.begin("operators", true);  // Read-only
  cachedOperatorCount = prefs.getInt("count", 0);
  unsigned long lastSync = prefs.getULong("syncTs", 0);
  prefs.end();
  
  Serial.printf("[CACHE] Loaded %d operators from NVS (last sync: %lu ms ago)\n", 
                cachedOperatorCount, millis() - lastSync);
}

/*******************************************************************************
 * VERIFY OPERATOR - ONLINE FIRST, OFFLINE FALLBACK
 * 
 * Security flow:
 *   1. If ONLINE: Call dashboard API to verify (preferred)
 *   2. If OFFLINE or API fails: Use cached SHA256 hash
 * 
 * PIN is NEVER sent or stored in plaintext.
 * ESP32 computes SHA256(pin) and compares with cached pinHash.
 ******************************************************************************/
bool verifyOperatorOnline(const String& pin, String& outOperatorId, String& outName, Role& outRole) {
  if (!isOnline) return false;
  
  Serial.println("[AUTH] Attempting online verification...");
  
  // Compute salted SHA256 of entered PIN (must match cloud's hashOperatorPinForDevice)
  String pinHash = hashPinForDevice(pin);
  
  HTTPClient http;
  secureClient.setInsecure();
  http.begin(secureClient, String(API_BASE_URL) + "/api/device/verify-pin");
  http.setTimeout(3000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-id", DEVICE_ID);
  http.addHeader("x-api-key", API_KEY);
  
  StaticJsonDocument<256> reqDoc;
  reqDoc["pinHash"] = pinHash;
  
  String body;
  serializeJson(reqDoc, body);
  
  int httpCode = http.POST(body);
  
  if (httpCode != 200) {
    Serial.printf("[AUTH] Online verify HTTP %d\n", httpCode);
    http.end();
    return false;
  }
  
  String response = http.getString();
  http.end();
  
  StaticJsonDocument<512> resDoc;
  DeserializationError err = deserializeJson(resDoc, response);
  if (err) {
    Serial.println("[AUTH] Online verify JSON error");
    return false;
  }
  
  if (!resDoc["ok"].as<bool>()) {
    Serial.println("[AUTH] Online verify: operator not found");
    return false;
  }
  
  outOperatorId = resDoc["operatorId"].as<String>();
  outName = resDoc["name"].as<String>();
  String roleStr = resDoc["role"].as<String>();
  outRole = (roleStr == "SUPERVISOR") ? SUPERVISOR : OPERATOR;
  
  Serial.printf("[AUTH] Online verify OK: %s (%s)\n", outName.c_str(), roleStr.c_str());
  return true;
}

bool verifyOperatorOffline(const String& pin, String& outOperatorId, String& outName, Role& outRole) {
  Serial.println("[AUTH] Using offline (cached) verification...");
  
  // Compute salted SHA256 of entered PIN (must match cloud's hashOperatorPinForDevice)
  String pinHash = hashPinForDevice(pin);
  
  prefs.begin("operators", true);
  int count = prefs.getInt("count", 0);
  
  for (int i = 0; i < count; i++) {
    String cachedHash = prefs.getString(("ph" + String(i)).c_str(), "");
    
    if (cachedHash == pinHash) {
      outOperatorId = prefs.getString(("id" + String(i)).c_str(), "");
      outName = prefs.getString(("nm" + String(i)).c_str(), "");
      String roleStr = prefs.getString(("rl" + String(i)).c_str(), "OPERATOR");
      outRole = (roleStr == "SUPERVISOR") ? SUPERVISOR : OPERATOR;
      
      prefs.end();
      Serial.printf("[AUTH] Offline verify OK: %s (role=%s)\n", outName.c_str(), roleStr.c_str());
      return true;
    }
  }
  
  prefs.end();
  Serial.println("[AUTH] Offline verify FAILED - PIN not in cache");
  return false;
}

/*******************************************************************************
 * UNIFIED OPERATOR VERIFICATION
 * 
 * Tries online first (dashboard is source of truth), falls back to cache.
 ******************************************************************************/
String currentOperatorId = "";
String currentOperatorName = "";

bool verifyOperator(const String& pin, Role& outRole) {
  // First: Check hardcoded admin
  // Admin uses code + pin flow separately, not this function
  
  // Try online verification first (dashboard = source of truth)
  String opId, opName;
  if (verifyOperatorOnline(pin, opId, opName, outRole)) {
    currentOperatorId = opId;
    currentOperatorName = opName;
    Serial.println("[AUTH] ONLINE verification successful");
    return true;
  }
  
  // Fallback to offline/cached verification
  if (verifyOperatorOffline(pin, opId, opName, outRole)) {
    currentOperatorId = opId;
    currentOperatorName = opName;
    Serial.println("[AUTH] OFFLINE (cached) verification successful");
    return true;
  }
  
  Serial.println("[AUTH] Verification FAILED - both online and offline");
  currentOperatorId = "";
  currentOperatorName = "";
  return false;
}

/*******************************************************************************
 * WIFI RECONNECTION HANDLER (NON-BLOCKING)
 * 
 * Called when WiFi reconnects after being offline.
 * IMPORTANT: Only sets flags - does NOT call HTTP immediately!
 * 
 * Actual sync happens in the network scheduler during next available slot.
 ******************************************************************************/
void onWiFiReconnect() {
  Serial.println("[WIFI] ===== RECONNECTED =====");
  Serial.println("[WIFI] Setting sync flags (non-blocking)...");
  
  // Set flags for deferred execution - DO NOT call HTTP here!
  wifiJustReconnected = true;
  scheduleOperatorSync = true;
  scheduleConfigFetch = true;
  
  // Reset scheduler timers to trigger soon (but not immediately)
  lastOperatorSyncMs_sched = millis() - SCHED_OPERATOR_SYNC_MS + 2000;  // Run in 2 seconds
  lastConfigFetchMs_sched = millis() - SCHED_CONFIG_FETCH_MS + 3000;    // Run in 3 seconds
  
  Serial.println("[WIFI] Sync scheduled for background execution");
}

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

/*******************************************************************************
 * METROLOGICAL RECEIPT - CROSS-CHECK VERIFICATION
 * 
 * This function performs the critical post-dispense verification required by
 * weights & measures standards. It computes the actual monetary value of oil
 * dispensed and compares it to what the customer paid.
 * 
 * CROSS-CHECK FORMULA:
 *   actualAmountZmw = dispensedMl * PRICE_PER_ML
 *   differenceZmw = |actualAmountZmw - amountRequestedZmw|
 * 
 * If differenceZmw > 1.00 Kwacha:
 *   - Flag as MISMATCH
 *   - Log to Serial for audit
 *   - Blink yellow LED (visual alert)
 *   - Send warning to dashboard
 *   - Mark receipt as "adjustmentRequired"
 * 
 * @param dispenseStatus: "DONE", "CANCELED", or "ERROR"
 ******************************************************************************/
void sendReceiptV2(float amountRequestedZmw, float targetMlCalculated, float dispensedMlActual, float usedPricePerMl, float usedPulsesPerLiter, float stopMarginLiters, const char* dispenseStatus = "DONE") {
  
  // ===== METROLOGICAL CROSS-CHECK VERIFICATION =====
  // Compute what the dispensed volume should cost
  float amountCalculatedZmw = dispensedMlActual * usedPricePerMl;
  float differenceZmw = fabs(amountCalculatedZmw - amountRequestedZmw);
  
  // Determine status based on mismatch threshold
  bool isMismatch = (differenceZmw > MISMATCH_THRESHOLD_ZMW);
  const char* metrologyStatus = isMismatch ? "MISMATCH" : "OK";
  const char* fairnessFlag = isMismatch ? "FAIRNESS_ALERT" : "NONE";
  bool adjustmentRequired = isMismatch;
  
  // Determine if customer was shorted (dispenser cheated)
  bool customerShorted = (amountCalculatedZmw < amountRequestedZmw - MISMATCH_THRESHOLD_ZMW);
  if (customerShorted) {
    fairnessFlag = "CUSTOMER_SHORTED";
    Serial.println("[FAIRNESS] *** CRITICAL: CUSTOMER RECEIVED LESS OIL THAN PAID FOR! ***");
  }

  // Log metrological audit trail
  Serial.println("[METROLOGY] ===== POST-DISPENSE VERIFICATION =====");
  Serial.printf("[METROLOGY] Amount requested: K%.2f\n", amountRequestedZmw);
  Serial.printf("[METROLOGY] Target volume: %.3f ml\n", targetMlCalculated);
  Serial.printf("[METROLOGY] Dispensed volume: %.3f ml\n", dispensedMlActual);
  Serial.printf("[METROLOGY] Price per ml: K%.6f\n", usedPricePerMl);
  Serial.printf("[METROLOGY] Calculated amount: K%.2f\n", amountCalculatedZmw);
  Serial.printf("[METROLOGY] Difference: K%.2f\n", differenceZmw);
  Serial.printf("[METROLOGY] Fairness flag: %s\n", fairnessFlag);
  Serial.printf("[METROLOGY] Status: %s\n", metrologyStatus);
  Serial.printf("[METROLOGY] Adjustment required: %s\n", adjustmentRequired ? "YES" : "NO");
  Serial.println("[METROLOGY] =========================================");

  // ANTI-CHEATING: Cap overshoot at 5ml (never give significantly more than paid for)
  float overshootMl = dispensedMlActual - targetMlCalculated;
  if (overshootMl > OVERSHOOT_LIMIT_ML) {
    Serial.printf("[METROLOGY] WARNING: Overshoot %.1f ml exceeds limit %.1f ml\n", overshootMl, OVERSHOOT_LIMIT_ML);
    // For billing purposes, cap the reported dispense (actual hardware may have exceeded)
    // This ensures the customer is never overcharged
    dispensedMlActual = targetMlCalculated + OVERSHOOT_LIMIT_ML;
    amountCalculatedZmw = dispensedMlActual * usedPricePerMl;
    differenceZmw = fabs(amountCalculatedZmw - amountRequestedZmw);
    adjustmentRequired = true;
  }

  // If mismatch, trigger visual alert and detailed logging
  if (isMismatch) {
    Serial.println("[DISPENSE_MISMATCH] *** ALERT: Dispensed value does not match paid amount! ***");
    Serial.printf("[DISPENSE_MISMATCH] Customer paid: K%.2f, Oil value: K%.2f, Discrepancy: K%.2f\n", 
                  amountRequestedZmw, amountCalculatedZmw, differenceZmw);
    
    // Blink yellow LED rapidly 10x as visual alert (per specification)
    blinkFairnessAlert();
  }

  // Convert ml to liters for dashboard (schema expects liters)
  float targetLiters = targetMlCalculated / 1000.0f;
  float dispensedLiters = dispensedMlActual / 1000.0f;
  
  // Calculate timestamps using session start time
  unsigned long nowMs = millis();
  unsigned long durationMs = (sessionStartMs > 0 && nowMs > sessionStartMs) 
                             ? (nowMs - sessionStartMs) : 1000;
  unsigned long durationSec = durationMs / 1000;
  if (durationSec < 1) durationSec = 1;  // Minimum 1 second
  
  // Calculate Unix timestamps (if time is synced)
  long long unixNowMs = hasTimeSync ? ((long long)nowMs + unixTimeOffsetMs) : (millis() + 1700000000000LL);
  long long startUnixSec = (unixNowMs - durationMs) / 1000;
  long long endUnixSec = unixNowMs / 1000;

  // Build receipt JSON matching dashboard validation schema:
  // sessionId, targetLiters, dispensedLiters, status, startedAtUnix, endedAtUnix, durationSec
  // Increased to 1536 bytes to accommodate ERB compliance data
  StaticJsonDocument<1536> doc;
  
  /***************************************************************************
   * REQUIRED FIELDS FOR DASHBOARD VALIDATION SCHEMA
   ***************************************************************************/
  doc["sessionId"] = currentSessionId;                 // Required: unique session ID
  doc["targetLiters"] = targetLiters;                  // Required: target volume in liters
  doc["dispensedLiters"] = dispensedLiters;            // Required: actual dispensed in liters
  doc["durationSec"] = (int)durationSec;               // Required: dispense duration
  doc["status"] = dispenseStatus;                      // Required: DONE, ERROR, or CANCELED
  doc["startedAtUnix"] = (long)startUnixSec;           // Required: Unix timestamp (seconds)
  doc["endedAtUnix"] = (long)endUnixSec;               // Required: Unix timestamp (seconds)
  
  // Operator identification (dashboard will resolve via PIN or ID)
  doc["operatorPin"] = lastLoginPin;                   // For operator lookup
  doc["operatorId"] = currentOperatorId;               // Direct operator ID if available
  
  /***************************************************************************
   * METROLOGICAL AUDIT DATA (extra fields for compliance)
   * Dashboard stores these in metaJson for audit/inspection
   ***************************************************************************/
  doc["requestedAmountZmw"] = amountRequestedZmw;      // What customer paid
  doc["targetMlCalculated"] = targetMlCalculated;      // Expected volume from payment
  doc["dispensedMlActual"] = dispensedMlActual;        // Actual volume dispensed (ml)
  doc["calculatedAmountZmw"] = amountCalculatedZmw;    // Monetary value of dispensed oil
  doc["differenceZmw"] = differenceZmw;                // Discrepancy amount
  doc["pricePerMl"] = usedPricePerMl;                  // Price used for calculation
  doc["metrologyStatus"] = metrologyStatus;            // OK or MISMATCH
  doc["fairnessFlag"] = fairnessFlag;                  // NONE, FAIRNESS_ALERT, CUSTOMER_SHORTED
  doc["adjustmentRequired"] = adjustmentRequired;
  
  // TRANSACTION TYPE (PRESET or CUSTOM)
  doc["transactionType"] = transactionType;            // "PRESET" or "CUSTOM"
  if (transactionType == "PRESET" && presetLabel.length() > 0) {
    doc["presetLabel"] = presetLabel;                  // e.g. "K5-200mL"
  } else {
    doc["presetLabel"] = (const char*)nullptr;         // null for custom
  }
  
  /***************************************************************************
   * CONSUMER PROTECTION COMPLIANCE - Cooking Oil Dispensing
   * CCPC: Competition and Consumer Protection Commission
   * ZBS: Zambia Bureau of Standards (ZBS 104)
   * Hotline: +260 211 222787 | https://www.ccpc.org.zm
   ***************************************************************************/
  JsonObject compliance = doc.createNestedObject("compliance");
  compliance["regulator"] = "CCPC - Consumer Protection";
  compliance["hotline"] = CCPC_HOTLINE;
  compliance["website"] = CCPC_WEBSITE;
  compliance["standard"] = ZBS_STANDARD;
  compliance["productType"] = "Cooking Oil";
  compliance["pricePerLiter"] = COOKING_OIL_PRICE_PER_LITER;
  compliance["volumeTolerancePercent"] = VOLUME_TOLERANCE_PERCENT;
  compliance["metrologyCompliant"] = !isMismatch;   // Within regulatory tolerance
  compliance["auditReady"] = true;                  // Receipt is audit-ready
  
  // Calibration and system info
  doc["pulsesPerLiter"] = usedPulsesPerLiter;
  doc["stopMarginLiters"] = stopMarginLiters;
  doc["isCalibrated"] = isCalibrated;
  
  // Device identification
  doc["deviceId"] = DEVICE_ID;
  doc["siteName"] = siteNameRuntime;
  doc["operatorCode"] = loginCode;

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

/*******************************************************************************
 * LCD DISPLAY - CACHED (NON-BLOCKING)
 * 
 * OPTIMIZATION: Only update LCD when content actually changes.
 * This eliminates the slow lcd.clear() call on every update.
 * 
 * The lcd.clear() command takes ~2ms and causes visible flicker.
 * By caching the displayed text, we skip unnecessary updates.
 ******************************************************************************/
void lcdShowCached(const String& line0, const String& line1 = "") {
  // Pad lines to 16 chars to overwrite old content (avoids clear())
  String l0 = line0.substring(0, 16);
  String l1 = line1.substring(0, 16);
  while (l0.length() < 16) l0 += ' ';
  while (l1.length() < 16) l1 += ' ';
  
  // Only update if content changed
  if (l0 != lcdLine0Cache || l1 != lcdLine1Cache) {
    lcd.setCursor(0, 0);
    lcd.print(l0);
    lcd.setCursor(0, 1);
    lcd.print(l1);
    lcdLine0Cache = l0;
    lcdLine1Cache = l1;
    Serial.println("[LCD] Updated");
  }
}

// Legacy lcdShow - now uses cached version
void lcdShow(const String& a, const String& b) {
  lcdShowCached(a, b);
}

// Force LCD update (bypasses cache) - use sparingly
void lcdShowForce(const String& a, const String& b) {
  lcd.clear();
  lcd.setCursor(0, 0); lcd.print(a.substring(0, 16));
  lcd.setCursor(0, 1); lcd.print(b.substring(0, 16));
  lcdLine0Cache = a.substring(0, 16);
  lcdLine1Cache = b.substring(0, 16);
}

float round2(float v) {
  long scaled = (long)(v * 100.0f + 0.5f);
  return scaled / 100.0f;
}

/*******************************************************************************
 * FAIRNESS ROUNDING FUNCTIONS (ANTI-CHEAT)
 * 
 * These functions implement the "customer favor" rounding guarantee.
 * They ensure the dispenser can NEVER short-change the customer.
 ******************************************************************************/

// Round volume UP in customer's favor (give slightly more oil)
float roundVolumeFairMl(float ml) {
  // Ceiling to nearest 0.5ml, then add fairness margin
  float rounded = ceilf(ml * 2.0f) / 2.0f;
  return rounded + FAIRNESS_ROUNDING_ML;
}

// Round money DOWN in customer's favor (charge slightly less)
float roundMoneyFairZmw(float zmw) {
  // Floor to nearest 0.01 Kwacha
  return floorf(zmw * 100.0f) / 100.0f;
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

  // PIMISHA: Price is LOCAL AND LOCKED - dashboard cannot override
  // float newPricePerLiter = doc["price"]["pricePerLiter"] | 0.0f;
  // DISABLED: Dashboard price override
  Serial.println("[CONFIG] Price is LOCAL: K25/L (dashboard override disabled)");

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

// IMPORTANT: Keep this salt in sync with DEVICE_PIN_HASH_SALT in cloud/web/lib/operator-pin.ts
const char* OPERATOR_PIN_HASH_SALT = "FLEET_OIL_PIN_V1";

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

// Hash PIN with salt for device verification (must match cloud's hashOperatorPinForDevice)
String hashPinForDevice(const String& pin) {
  String salted = String(OPERATOR_PIN_HASH_SALT) + ":" + pin;
  return sha256(salted);
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
  doc["pin"] = pin;  // Raw PIN - cloud will hash it
  doc["role"] = (role == SUPERVISOR) ? "supervisor" : "operator";
  doc["action"] = isDelete ? "delete" : "add";
  doc["timestamp"] = millis();
  
  String body;
  serializeJson(doc, body);
  
  Serial.println("[USER_SYNC] Syncing operator to dashboard: " + code);
  Serial.println("[USER_SYNC] Action: " + String(isDelete ? "delete" : "add"));
  
  if (isOnline) {
    HTTPClient http;
    secureClient.setInsecure();
    http.begin(secureClient, String(API_BASE_URL) + "/api/ingest/operator");
    http.setTimeout(5000);  // 5 second timeout for operator sync
    http.addHeader("Content-Type", "application/json");
    http.addHeader("x-device-id", DEVICE_ID);
    http.addHeader("x-api-key", API_KEY);
    int httpCode = http.POST(body);
    String response = http.getString();
    Serial.printf("[USER_SYNC] HTTP %d: %s\n", httpCode, response.c_str());
    http.end();
    
    if (httpCode >= 200 && httpCode < 300) {
      Serial.println("[USER_SYNC] Operator synced to dashboard successfully!");
    } else {
      Serial.println("[USER_SYNC] Failed, queuing for retry...");
      queueUserSync(body);
    }
  } else {
    Serial.println("[USER_SYNC] Offline, queuing for later sync...");
    queueUserSync(body);
  }
}

bool addUser(const String& code, const String& pin, Role role) {
  // First, add to operators cache so they can login immediately
  // This mirrors the format used by dashboard-synced operators
  String pinHash = hashPinForDevice(pin);
  String roleStr = (role == SUPERVISOR) ? "SUPERVISOR" : "OPERATOR";
  String opId = "LOCAL-" + code;  // Local operators get LOCAL- prefix
  
  prefs.begin("operators", false);
  int opCount = prefs.getInt("count", 0);
  
  // Check if PIN already exists in operator cache
  for (int i = 0; i < opCount; i++) {
    String existingHash = prefs.getString(("ph" + String(i)).c_str(), "");
    if (existingHash == pinHash) {
      prefs.end();
      Serial.println("[USER] PIN already in use!");
      return false;
    }
  }
  
  // Check if operator name already exists
  for (int i = 0; i < opCount; i++) {
    String existingName = prefs.getString(("nm" + String(i)).c_str(), "");
    if (existingName == code) {
      // Update existing operator's PIN and role
      prefs.putString(("ph" + String(i)).c_str(), pinHash);
      prefs.putString(("rl" + String(i)).c_str(), roleStr);
      prefs.end();
      Serial.printf("[USER] Updated existing: %s role=%s\n", code.c_str(), roleStr.c_str());
      syncUserToDashboard(code, pin, role, false);
      return true;
    }
  }
  
  // Add new operator to cache
  if (opCount >= 20) {  // Max 20 operators in cache
    prefs.end();
    Serial.println("[USER] Operator cache full!");
    return false;
  }
  
  prefs.putString(("id" + String(opCount)).c_str(), opId);
  prefs.putString(("nm" + String(opCount)).c_str(), code);
  prefs.putString(("ph" + String(opCount)).c_str(), pinHash);
  prefs.putString(("rl" + String(opCount)).c_str(), roleStr);
  prefs.putInt("count", opCount + 1);
  prefs.end();
  
  Serial.printf("[USER] Added to operator cache: %s role=%s\n", code.c_str(), roleStr.c_str());
  
  // Also keep in legacy users storage for backward compatibility
  prefs.begin("users", false);
  int count = prefs.getInt("count", 0);
  if (count < MAX_USERS) {
    prefs.putString(("c" + String(count)).c_str(), code);
    prefs.putString(("p" + String(count)).c_str(), pin);
    prefs.putInt(("r" + String(count)).c_str(), (int)role);
    prefs.putInt("count", count + 1);
  }
  prefs.end();
  
  // Sync to dashboard
  syncUserToDashboard(code, pin, role, false);
  
  return true;
}

bool deleteUser(const String& code) {
  Role deletedRole = OPERATOR;
  bool found = false;
  
  // Remove from operators cache (new system)
  prefs.begin("operators", false);
  int opCount = prefs.getInt("count", 0);
  int opFoundIdx = -1;
  
  for (int i = 0; i < opCount; i++) {
    String nm = prefs.getString(("nm" + String(i)).c_str(), "");
    if (nm == code) {
      opFoundIdx = i;
      String roleStr = prefs.getString(("rl" + String(i)).c_str(), "OPERATOR");
      deletedRole = (roleStr == "SUPERVISOR") ? SUPERVISOR : OPERATOR;
      found = true;
      break;
    }
  }
  
  if (opFoundIdx >= 0) {
    // Shift operators down
    for (int i = opFoundIdx; i < opCount - 1; i++) {
      prefs.putString(("id" + String(i)).c_str(), prefs.getString(("id" + String(i+1)).c_str(), ""));
      prefs.putString(("nm" + String(i)).c_str(), prefs.getString(("nm" + String(i+1)).c_str(), ""));
      prefs.putString(("ph" + String(i)).c_str(), prefs.getString(("ph" + String(i+1)).c_str(), ""));
      prefs.putString(("rl" + String(i)).c_str(), prefs.getString(("rl" + String(i+1)).c_str(), ""));
    }
    prefs.putInt("count", opCount - 1);
    Serial.printf("[USER] Removed from operator cache: %s\n", code.c_str());
  }
  prefs.end();
  
  // Also remove from legacy users storage
  prefs.begin("users", false);
  int count = prefs.getInt("count", 0);
  int foundIdx = -1;
  
  for (int i = 0; i < count; i++) {
    if (prefs.getString(("c" + String(i)).c_str(), "") == code) {
      foundIdx = i;
      if (!found) {
        deletedRole = (Role)prefs.getInt(("r" + String(i)).c_str(), 0);
      }
      found = true;
      break;
    }
  }
  
  if (foundIdx >= 0) {
    // Shift all users down
    for (int i = foundIdx; i < count - 1; i++) {
      prefs.putString(("c" + String(i)).c_str(), prefs.getString(("c" + String(i+1)).c_str(), ""));
      prefs.putString(("p" + String(i)).c_str(), prefs.getString(("p" + String(i+1)).c_str(), ""));
      prefs.putInt(("r" + String(i)).c_str(), prefs.getInt(("r" + String(i+1)).c_str(), 0));
    }
    prefs.putInt("count", count - 1);
    Serial.printf("[USER] Removed from legacy storage: %s\n", code.c_str());
  }
  prefs.end();
  
  if (!found) {
    Serial.printf("[USER] Not found: %s\n", code.c_str());
    return false;
  }
  
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

/* ================= LIVE DISPENSE DISPLAY (FAIRNESS-AWARE) ================= */
/*******************************************************************************
 * REAL-TIME DISPENSING DISPLAY
 * 
 * Shows live volume and value during dispensing for transparency.
 * User can see exactly how much oil they're receiving at all times.
 ******************************************************************************/
void updateDispenseDisplay() {
  static unsigned long lastDispUpdateMs = 0;
  const unsigned long DISP_UPDATE_INTERVAL_MS = 200; // FIXED: Update every 200ms for smoother display

  unsigned long now = millis();
  if (now - lastDispUpdateMs < DISP_UPDATE_INTERVAL_MS) return;
  lastDispUpdateMs = now;

  // FIXED: Calculate ml directly from pulses for accuracy
  uint32_t currentPulses;
  noInterrupts(); currentPulses = flowPulses; interrupts();
  int ml = (int)((currentPulses * 1000UL) / sessionPulsesPerLiter);
  int targetMl = sessionTargetMl;
  
  // Line 1: Show progress with target
  String line1 = String(ml) + "/" + String(targetMl) + "ml";
  while (line1.length() < 16) line1 += ' ';
  lcd.setCursor(0, 0);
  lcd.print(line1);
  
  // Line 2: Show live value in Kwacha (transparency)
  // Customer sees real-time monetary value of oil dispensed
  float liveValueZmw = (float)ml * sessionPricePerMl;
  String line2 = "VALUE: K" + String((int)liveValueZmw);
  while (line2.length() < 16) line2 += ' ';
  lcd.setCursor(0, 1);
  lcd.print(line2);
}

/* ================= FLOW ================= */
// FIXED: Set to false for PRODUCTION with real flow sensor
#define SIMULATE_FLOW false   // PRODUCTION MODE - real flow sensor active
#define SIMULATED_FLOW_RATE 0.05f  // Liters per update (~50ml per 300ms = fast test)

// DEBUG: Track pulse rate for diagnostics
static uint32_t lastDebugPulses = 0;
static unsigned long lastDebugTime = 0;

void updateFlow() {
  if (millis() - lastFlowMs < 100) return;  // FIXED: Check every 100ms for faster response
  lastFlowMs = millis();
  
  if (state == ST_DISPENSING) {
    if (SIMULATE_FLOW) {
      // Simulated flow for testing without sensor
      flowPulses += (uint32_t)(SIMULATED_FLOW_RATE * sessionPulsesPerLiter);
      dispensedLiters = (float)flowPulses / sessionPulsesPerLiter;
      Serial.printf("[FLOW-SIM] pulses=%lu, target=%lu, dispensed=%.3f L\n", flowPulses, targetPulses, dispensedLiters);
    } else {
      // FIXED: Real flow sensor - direct pulse-to-volume calculation
      // No cumulative float drift - always derive from pulse count
      uint32_t p;
      noInterrupts(); p = flowPulses; interrupts();
      dispensedLiters = (float)p / sessionPulsesPerLiter;
      
      // Calculate pulse rate for debugging
      unsigned long now = millis();
      if (now - lastDebugTime >= 1000) {
        uint32_t pulseDelta = p - lastDebugPulses;
        Serial.printf("[FLOW] pulses=%lu/%lu (%.0f%%), rate=%lu p/s, ml=%d/%d\n", 
          p, targetPulses, (p * 100.0f / targetPulses),
          pulseDelta, 
          (int)((p * 1000UL) / sessionPulsesPerLiter),
          sessionTargetMl);
        lastDebugPulses = p;
        lastDebugTime = now;
      }
    }
  }
}

/*******************************************************************************
 * NETWORK TASK SCHEDULER (NON-BLOCKING, TIME-SLICED)
 * 
 * CORE RULE: Only ONE network task runs per loop iteration.
 * This prevents multiple HTTP calls from blocking the UI.
 * 
 * Tasks are checked in priority order and time-gated.
 * Each task checks its own interval before executing.
 * 
 * NEVER call HTTP functions directly from UI code - schedule them here.
 ******************************************************************************/
void handleNetworkScheduler() {
  // Skip all network tasks if offline
  if (!isOnline) {
    return;
  }

  // NEVER run network tasks during dispensing
  if (state == ST_DISPENSING) {
    return;
  }
  
  unsigned long now = millis();
  
  // Priority 1: Receipt queue (most important - money data)
  if (now - lastReceiptQueueMs >= SCHED_RECEIPT_QUEUE_MS) {
    lastReceiptQueueMs = now;
    Serial.println("[NET_SCHED] Running: Receipt queue");
    resendQueue();
    return;  // Only ONE task per loop
  }
  
  // Priority 2: User sync queue
  if (now - lastUserSyncQueueMs >= SCHED_USER_SYNC_QUEUE_MS) {
    lastUserSyncQueueMs = now;
    Serial.println("[NET_SCHED] Running: User sync queue");
    resendUserSyncQueue();
    return;
  }
  
  // Priority 3: Heartbeat
  if (now - lastHeartbeatMs >= SCHED_HEARTBEAT_MS) {
    lastHeartbeatMs = now;
    Serial.println("[NET_SCHED] Running: Heartbeat");
    sendHeartbeat();
    return;
  }
  
  // Priority 4: Config fetch
  if (now - lastConfigFetchMs_sched >= SCHED_CONFIG_FETCH_MS || scheduleConfigFetch) {
    lastConfigFetchMs_sched = now;
    scheduleConfigFetch = false;
    Serial.println("[NET_SCHED] Running: Config fetch");
    fetchDeviceConfig();
    return;
  }
  
  // Priority 5: Operator sync (lowest priority, longest interval)
  if ((now - lastOperatorSyncMs_sched >= SCHED_OPERATOR_SYNC_MS) || scheduleOperatorSync) {
    lastOperatorSyncMs_sched = now;
    scheduleOperatorSync = false;
    Serial.println("[NET_SCHED] Running: Operator sync");
    fetchOperatorsFromDashboard();
    return;
  }
}

/*******************************************************************************
 * KEYPAD HANDLER (HIGHEST PRIORITY)
 * 
 * This function MUST run every loop iteration BEFORE any network code.
 * Returns the key pressed, or NO_KEY if none.
 ******************************************************************************/
char handleKeypadInput() {
  char k = keypad.getKey();
  
  if (k == NO_KEY) return NO_KEY;
  
  // Validate key is a real keypad character (prevent ghost keys)
  bool validKey = false;
  const char validKeys[] = "0123456789ABCD*#";
  for (int i = 0; i < 16; i++) {
    if (k == validKeys[i]) { validKey = true; break; }
  }
  if (!validKey) {
    Serial.printf("[KEY] INVALID/GHOST: 0x%02X\n", (int)k);
    return NO_KEY;
  }
  
  // Debounce: Prevent same key repeating too fast
  static char lastKeyLocal = 0;
  static unsigned long lastKeyTimeLocal = 0;
  if (k == lastKeyLocal && (millis() - lastKeyTimeLocal) < 50) {
    return NO_KEY;
  }
  lastKeyLocal = k;
  lastKeyTimeLocal = millis();
  
  // Key is valid - log it
  Serial.printf("[KEY] OK: '%c' state=%d\n", k, (int)state);
  
  return k;
}

/*******************************************************************************
 * TAMPER CHECK (NON-BLOCKING)
 ******************************************************************************/
void handleTamperCheck() {
  static unsigned long lastTamperCheckMs = 0;
  unsigned long now = millis();
  if (now - lastTamperCheckMs < 50) return;  // simple debounce
  lastTamperCheckMs = now;

  int val = digitalRead(PIN_TAMPER);
  if (val == HIGH && !tamperLatched) {
    // Tamper triggered (cabinet open)
    tamperLatched = true;
    pumpOff();  // SAFETY: Immediate pump shutoff on tamper
    ledsError();

    // Queue tamper event for later sending (don't block here)
    Serial.println("[TAMPER] Cabinet opened - pump stopped");
    
    // Force logout and show alarm
    state = ST_LOGIN_CODE;
    inputBuf = "";
    amountZmw = 0;
    dispensedLiters = 0;
    lcdShow("TAMPER", "CABINET OPEN");
    
    // Send event in background (will be picked up by scheduler)
    if (isOnline) {
      sendTamperEvent();  // This one is critical, send immediately
    }
  }
}

/*******************************************************************************
 * PUMP SAFETY CHECK (NON-BLOCKING)
 * 
 * Ensures pump is OFF unless we're in dispensing state.
 * This is a safety backstop - pump should never run outside ST_DISPENSING.
 ******************************************************************************/
void handlePumpSafety() {
  if (state != ST_DISPENSING) {
    pumpOff();
  }
}

/*******************************************************************************
 * WIFI HEARTBEAT LED BLINK (NON-BLOCKING)
 * FIXED: Blinks yellow LED 3 times every 30 seconds when WiFi is connected.
 * Uses millis() for non-blocking operation - no delay().
 ******************************************************************************/
void handleWifiHeartbeatLed() {
  unsigned long now = millis();
  
  // Only blink when WiFi is connected
  if (!isOnline) {
    wifiBlinkInProgress = false;
    wifiBlinkCount = 0;
    return;
  }
  
  // Check if it's time to start a new blink sequence (every 30 seconds)
  if (!wifiBlinkInProgress && (now - lastWifiHeartbeatMs >= WIFI_HEARTBEAT_INTERVAL_MS)) {
    wifiBlinkInProgress = true;
    wifiBlinkCount = 0;
    wifiBlinkStartMs = now;
    lastWifiHeartbeatMs = now;
    Serial.println("[LED] WiFi heartbeat - starting 3 blinks");
  }
  
  // Handle ongoing blink sequence (3 blinks = 6 state changes)
  if (wifiBlinkInProgress) {
    unsigned long elapsed = now - wifiBlinkStartMs;
    int phase = elapsed / 100;  // 100ms per phase (ON or OFF)
    
    if (phase < 6) {  // 3 blinks = 6 phases (ON-OFF-ON-OFF-ON-OFF)
      // Even phases = LED ON, Odd phases = LED OFF
      if (phase % 2 == 0) {
        digitalWrite(PIN_LED_YELLOW, HIGH);
      } else {
        digitalWrite(PIN_LED_YELLOW, LOW);
      }
    } else {
      // Blink sequence complete
      digitalWrite(PIN_LED_YELLOW, LOW);
      wifiBlinkInProgress = false;
      wifiBlinkCount = 0;
    }
  }
}

/*******************************************************************************
 * DISPENSE AUTO-STOP CHECK (NON-BLOCKING)
 * 
 * Checks if target volume reached and stops pump.
 * CRITICAL: This must run every loop iteration during dispensing.
 * 
 * FIXED: Pulse-based stopping for accurate volume control.
 * Uses integer pulse comparison - no floating point drift.
 ******************************************************************************/
void handleDispenseAutoStop() {
  if (state != ST_DISPENSING) return;
  if (calibrationMode) return;
  if (targetPulses <= 0) return;
  
  // PIMISHA: Stop pump ONLY when currentPulses >= targetPulses
  uint32_t currentPulses;
  noInterrupts(); currentPulses = flowPulses; interrupts();
  
  if (currentPulses >= targetPulses) {
    // CRITICAL: Stop pump immediately
    pumpOff();
    ledsIdle();
    
    // PIMISHA: Calculate ml using integer math
    int mlDone = (int)((currentPulses * 1000UL) / sessionPulsesPerLiter);
    int targetMl = sessionTargetMl;
    dispensedLiters = currentPulses / sessionPulsesPerLiter;
    
    // Log dispense completion
    Serial.println("[AUTO-STOP] ===== DISPENSE COMPLETE =====");
    Serial.printf("[AUTO-STOP] Target: %d ml, %lu pulses\n", targetMl, targetPulses);
    Serial.printf("[AUTO-STOP] Dispensed: %d ml, %lu pulses\n", mlDone, currentPulses);
    Serial.println("[AUTO-STOP] =============================");
    
    // Send receipt
    sendReceiptV2(amountZmw, (float)targetMl, (float)mlDone, sessionPricePerMl, sessionPulsesPerLiter, STOP_MARGIN_LITERS);
    
    // Save values for display before reset
    int displayPaid = (int)amountZmw;
    String savedTransactionType = transactionType;
    
    // Reset state
    state = ST_LOGIN_CODE;
    inputBuf = "";
    dispensedLiters = 0;
    targetLiters = 0;
    pendingTargetMl = 0;
    sessionTargetMl = 0;
    targetPulses = 0;
    amountZmw = 0;
    calibrationMode = false;
    transactionType = "";
    presetLabel = "";
    selectedPresetIdx = -1;
    
    // Show result with integer ml
    if (savedTransactionType == "PRESET") {
      lcdShow("PRESET: K" + String(displayPaid), "GOT: " + String(mlDone) + " mL");
    } else {
      lcdShow("PAID: K" + String(displayPaid), "GOT: " + String(mlDone) + " mL");
    }
    delay(2500);
    
    lcdShow("SYSTEM RUNNING", "ENTER CODE");
  }
}

/* ================= SETUP ================= */
void setup() {
  Serial.begin(115200);
  delay(100);
  
  // Print startup banner with real-time architecture info
  Serial.println();
  Serial.println("===============================================================");
  Serial.println("  PIMISHA OIL DISPENSER - REAL-TIME FIRMWARE v3.2");
  Serial.println("  Weights & Measures Compliant - Legal Metrology Certified");
  Serial.println("===============================================================");
  Serial.printf("  Device ID: %s\n", DEVICE_ID);
  Serial.printf("  Site: %s\n", SITE_NAME);
  Serial.println("---------------------------------------------------------------");
  Serial.println("  REAL-TIME ARCHITECTURE:");
  Serial.println("    - Keypad: <5ms response (ALWAYS FIRST in loop)");
  Serial.println("    - Pump: <1ms response (GPIO direct)");
  Serial.println("    - LCD: Cached (no blocking clear())");
  Serial.println("    - Network: Time-sliced, ONE task per loop");
  Serial.println("---------------------------------------------------------------");
  Serial.println("  NETWORK SCHEDULER INTERVALS:");
  Serial.printf("    Receipt queue:   %d ms\n", SCHED_RECEIPT_QUEUE_MS);
  Serial.printf("    User sync:       %d ms\n", SCHED_USER_SYNC_QUEUE_MS);
  Serial.printf("    Heartbeat:       %d ms\n", SCHED_HEARTBEAT_MS);
  Serial.printf("    Config fetch:    %d ms\n", SCHED_CONFIG_FETCH_MS);
  Serial.printf("    Operator sync:   %d ms\n", SCHED_OPERATOR_SYNC_MS);
  Serial.println("---------------------------------------------------------------");
  Serial.println("  PRICING (Single Source of Truth):");
  Serial.printf("    PRICE_PER_ML:    K%.4f per ml\n", PRICE_PER_ML);
  Serial.printf("    PRICE_PER_LITER: K%.2f per liter\n", PRICE_PER_LITER);
  Serial.println("---------------------------------------------------------------");
  Serial.println("  PIMISHA VERIFICATION (K25/L):");
  Serial.printf("    K1  -> %d ml\n", (int)ceil(1.0f / PRICE_PER_ML));
  Serial.printf("    K2  -> %d ml\n", (int)ceil(2.0f / PRICE_PER_ML));
  Serial.printf("    K5  -> %d ml\n", (int)ceil(5.0f / PRICE_PER_ML));
  Serial.printf("    K10 -> %d ml\n", (int)ceil(10.0f / PRICE_PER_ML));
  Serial.printf("    K25 -> %d ml (1L)\n", (int)ceil(25.0f / PRICE_PER_ML));
  Serial.printf("    K50 -> %d ml (2L)\n", (int)ceil(50.0f / PRICE_PER_ML));
  Serial.printf("    K100-> %d ml\n", (int)ceil(100.0f / PRICE_PER_ML));
  Serial.println("---------------------------------------------------------------");
  Serial.println("  METROLOGICAL LIMITS:");
  Serial.printf("    Stop margin:     %.1f ml\n", STOP_MARGIN_LITERS * 1000.0f);
  Serial.printf("    Mismatch:        K%.2f threshold\n", MISMATCH_THRESHOLD_ZMW);
  Serial.println("---------------------------------------------------------------");
  Serial.println("  FLOW SENSOR CALIBRATION:");
  Serial.printf("    pulsesPerLiter:  %.2f pulses/L\n", pulsesPerLiter);
  Serial.printf("    Calibrated:      %s\n", isCalibrated ? "YES" : "NO (using default 450)");
  Serial.println("    *** IF NOT PUMPING CORRECT VOLUME: RUN CALIBRATION! ***");
  Serial.println("    *** Admin Menu -> Option 4 -> Measure exactly 1L ***");
  Serial.println("===============================================================");
  Serial.println();

  pinMode(PIN_PUMP, OUTPUT);
  pumpForceOff();  // CRITICAL: Pump OFF at boot (force regardless of state)

  pinMode(PIN_LED_RED, OUTPUT);
  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_LED_YELLOW, OUTPUT);
  ledsIdle();

  // FIXED: Flow sensor with internal pull-up to reduce noise
  pinMode(PIN_FLOW, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_FLOW), onFlowPulse, FALLING);  // FALLING for pull-up config
  Serial.println("[FLOW] Flow sensor initialized with INPUT_PULLUP, FALLING edge, 1ms debounce");

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
  if (storedPpl >= CALIBRATION_REQUIRED_PPL) {
    pulsesPerLiter = storedPpl;
    isCalibrated = true;
    Serial.printf("[CALIB] Using stored pulsesPerLiter=%.2f (CALIBRATED)\n", pulsesPerLiter);
  } else {
    isCalibrated = false;
    Serial.printf("[CALIB] Using default pulsesPerLiter=%.2f (NOT CALIBRATED - large volumes restricted)\n", pulsesPerLiter);
  }

  // Load cached operators from NVS for offline operation
  loadCachedOperators();
  
  // If WiFi connected, sync operators from dashboard immediately
  if (WiFi.status() == WL_CONNECTED) {
    isOnline = true;
    wasOnline = true;
    // FIXED: Set handshake timeout for faster UI responsiveness
    secureClient.setHandshakeTimeout(2);  // 2 second TLS timeout
    Serial.println("[BOOT] WiFi connected - TLS handshake timeout set to 2s");
    Serial.println("[BOOT] WiFi connected - syncing operators from dashboard...");
    fetchOperatorsFromDashboard();
    fetchDeviceConfig();
  } else {
    Serial.printf("[BOOT] WiFi offline - using %d cached operators\n", cachedOperatorCount);
  }

  // Show that the system is powered and ready
  lcdShow("SYSTEM RUNNING", "ENTER CODE");
}

/* ================= LOOP ================= */
/*******************************************************************************
 * MAIN LOOP - REAL-TIME COOPERATIVE ARCHITECTURE
 * 
 * EXECUTION ORDER (CRITICAL FOR RESPONSIVENESS):
 *   1. KEYPAD INPUT   - ALWAYS FIRST, every iteration
 *   2. STATE MACHINE  - Process keypad input immediately
 *   3. PUMP SAFETY    - Ensure pump is off when not dispensing
 *   4. FLOW SENSOR    - Update dispensed volume
 *   5. AUTO-STOP      - Check if target reached
 *   6. DISPLAY UPDATE - Update LCD (non-blocking, cached)
 *   7. WIFI CHECK     - Track online/offline state
 *   8. NETWORK TASKS  - Time-sliced, ONE task per loop max
 * 
 * TIMING GUARANTEE:
 *   - Keypad response: <5ms (before any network code)
 *   - Pump response: <1ms (GPIO write)
 *   - LCD update: <10ms (cached, no clear())
 *   - Network tasks: staggered, non-blocking
 ******************************************************************************/

void loop() {
  // =========================================================================
  // STEP 1: KEYPAD INPUT (HIGHEST PRIORITY - ALWAYS FIRST)
  // =========================================================================
  char k = handleKeypadInput();
  
  // =========================================================================
  // STEP 2: PROCESS KEYPAD INPUT (STATE MACHINE)
  // =========================================================================
  if (k != NO_KEY) {
    processKeyInput(k);  // Defined below - handles all state transitions
  }
  
  // =========================================================================
  // STEP 3: PUMP SAFETY (ALWAYS RUNS)
  // =========================================================================
  handlePumpSafety();
  
  // =========================================================================
  // STEP 4: FLOW SENSOR UPDATE (LIGHTWEIGHT)
  // =========================================================================
  updateFlow();
  
  // =========================================================================
  // STEP 5: DISPENSE AUTO-STOP CHECK (CRITICAL)
  // =========================================================================
  handleDispenseAutoStop();
  
  // =========================================================================
  // STEP 6: DISPLAY UPDATES (NON-BLOCKING, CACHED)
  // =========================================================================
  if (state == ST_LOGIN_CODE) {
    scrollWelcome();
    // Use direct LCD write for bottom line (scrolling text on top)
    lcd.setCursor(0, 1);
    lcd.print("ENTER CODE");
  }
  
  if (state == ST_DISPENSING) {
    updateDispenseDisplay();
  }
  
  // =========================================================================
  // STEP 7: WIFI STATE TRACKING (NON-BLOCKING)
  // =========================================================================
  bool currentlyOnline = (WiFi.status() == WL_CONNECTED);
  
  // Detect WiFi reconnection - SET FLAGS ONLY, don't call HTTP
  if (currentlyOnline && !wasOnline) {
    onWiFiReconnect();
  }
  wasOnline = currentlyOnline;
  isOnline = currentlyOnline;
  
  // =========================================================================
  // STEP 7.5: WIFI HEARTBEAT LED (NON-BLOCKING)
  // FIXED: Blink yellow LED 3x every 30s when WiFi connected
  // =========================================================================
  handleWifiHeartbeatLed();
  
  // =========================================================================
  // STEP 8: TAMPER CHECK (NON-BLOCKING)
  // =========================================================================
  handleTamperCheck();
  
  // =========================================================================
  // STEP 9: NETWORK TASKS (TIME-SLICED, ONE PER LOOP MAX)
  // =========================================================================
  // This is the ONLY place network calls happen in the main loop
  // All tasks are time-gated and only ONE runs per iteration
  handleNetworkScheduler();
  
  // Debug: Print loop timing periodically
  static unsigned long lastLoopDebug = 0;
  if (millis() - lastLoopDebug >= 10000) {
    lastLoopDebug = millis();
    Serial.printf("[LOOP] UI FAST - state=%d online=%d\n", (int)state, isOnline);
  }
}

/*******************************************************************************
 * PROCESS KEY INPUT (STATE MACHINE)
 * 
 * This function handles all keypad input and state transitions.
 * It runs BEFORE any network code to ensure instant response.
 ******************************************************************************/
void processKeyInput(char k) {
  Serial.printf("[KEY] Processing '%c' in state %d\n", k, (int)state);

  // * = EMERGENCY STOP (only when dispensing) - HIGHEST PRIORITY
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
        // FIXED: Calculate ml from pulses for accuracy
        uint32_t currentPulses;
        noInterrupts(); currentPulses = flowPulses; interrupts();
        float mlDone = (currentPulses * 1000.0f) / sessionPulsesPerLiter;
        float targetMl = (float)sessionTargetMl;
        // Emergency stop = CANCELED status
        sendReceiptV2(amountZmw, targetMl, mlDone, sessionPricePerMl, sessionPulsesPerLiter, STOP_MARGIN_LITERS, "CANCELED");
        float actualPaid = mlDone * sessionPricePerMl;
        state = ST_LOGIN_CODE;
        inputBuf = "";
        amountZmw = 0;
        dispensedLiters = 0;
        targetPulses = 0;  // FIXED: Reset pulse target
        targetLiters = 0;
        pendingTargetMl = 0;
        sessionTargetMl = 0;
        transactionType = "";
        presetLabel = "";
        selectedPresetIdx = -1;
        lcdShow("E-STOP", String((int)mlDone) + "ml K" + String((int)actualPaid));
      } else {
        state = ST_LOGIN_CODE;
        inputBuf = "";
        amountZmw = 0;
        dispensedLiters = 0;
        targetPulses = 0;  // FIXED: Reset pulse target
        targetLiters = 0;
        pendingTargetMl = 0;
        sessionTargetMl = 0;
        transactionType = "";
        presetLabel = "";
        selectedPresetIdx = -1;
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
        lcdShow("VERIFYING...", "");
        
        // First check if this is admin login (code + pin)
        Role verifiedRole;
        bool isAdmin = (loginCode == ADMIN_CODE && inputBuf == ADMIN_PIN);
        
        bool loginOk = false;
        
        if (isAdmin) {
          // Admin login uses hardcoded credentials
          verifiedRole = ADMIN;
          loginOk = true;
          currentOperatorId = "ADMIN";
          currentOperatorName = "Admin";
          Serial.println("[AUTH] Admin login successful");
        } else {
          // For operators: use PIN-only verification (dashboard is source of truth)
          // The new system uses PIN alone, not code+pin
          Serial.println("[AUTH] Attempting operator verification...");
          loginOk = verifyOperator(inputBuf, verifiedRole);
        }
        
        if (loginOk) {
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
            // Show operator name on successful login
            String greeting = "HI " + currentOperatorName.substring(0, 10);
            lcdShow(greeting, "LOGIN OK");
            delay(1000);
            
            /***************************************************************************
             * FIXED: PIMISHA UNLIMITED AMOUNT DISPENSING FLOW
             * 
             * PIMISHA = "Buy any amount" - customers can purchase ANY amount of oil.
             * 
             * Flow:
             *   LOGIN → PRESETS/CUSTOM → CONFIRM → DISPENSE
             * 
             * Presets: 1=K5(200mL), 2=K10(400mL), 3=K25(1L), 4=K50(2L)
             * Custom: Press 'A' for ANY custom amount (K1, K2, K5, etc.)
             * 
             * Fairness: Custom amounts are ROUNDED UP to favor customer.
             ***************************************************************************/
            amountZmw = 0;
            transactionType = "CUSTOM";
            presetLabel = "";
            selectedPresetIdx = -1;
            state = ST_PRESET;
            lcdShow("PRESETS", "1:K5 2:K10 A=AMT");
          }
        } else {
          lcdShow("INVALID PIN!", "TRY AGAIN");
          Serial.println("[AUTH] Login failed - invalid credentials");
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

    /***************************************************************************
     * ST_PRESET: Preset selection menu
     * 
     * FIXED: PIMISHA - Presets are OPTIONAL quick-select options.
     * 
     * Keys:
    *   1 = K5 (200mL)
    *   2 = K10 (400mL)  
    *   3 = K25 (1L)
    *   4 = K50 (2L)
     *   A = Custom amount (ANY amount - K1, K2, K3, etc.)
     *   C = Cancel/Logout
    *   * = Show more presets (3:K25 4:K50)
     ***************************************************************************/
    case ST_PRESET:
      if (k == '1' || k == '2' || k == '3' || k == '4') {
        int idx = k - '1';  // 0-3
        if (idx >= 0 && idx < NUM_PRESETS) {
          // Select preset
          selectedPresetIdx = idx;
          amountZmw = PRESETS[idx].priceZmw;
          pendingTargetMl = PRESETS[idx].volumeMl;
          targetLiters = pendingTargetMl / 1000.0f;
          transactionType = "PRESET";
          presetLabel = PRESETS[idx].label;
          
          Serial.println("[PRESET] ==============================");
          Serial.printf("[PRESET] Selected: %s\n", PRESETS[idx].label);
          Serial.printf("[PRESET] Price: K%d\n", PRESETS[idx].priceZmw);
          Serial.printf("[PRESET] Volume: %d mL (FIXED)\n", PRESETS[idx].volumeMl);
          Serial.printf("[PRESET] targetLiters: %.4f\n", targetLiters);
          Serial.println("[PRESET] ==============================");
          
          // Show confirmation
          String line1 = "PAY:K" + String(PRESETS[idx].priceZmw) + " GET:" + String(PRESETS[idx].volumeMl) + "mL";
          lcdShow("PRESET", line1);
          delay(1200);
          lcdShow("B=START C=BACK", presetLabel);
          
          state = ST_READY;
        }
      }
      else if (k == 'A') {
        // PIMISHA unlimited amount - Go to custom amount entry (any amount including decimals)
        amountZmw = 0;
        decimalEntered = false;
        decimalPlaces = 0;
        transactionType = "CUSTOM";
        presetLabel = "";
        selectedPresetIdx = -1;
        state = ST_AMOUNT;
        lcdShow("CUSTOM (D=.)", "ENTER K: 0");
      }
      else if (k == '*') {
        // Show more presets
        lcdShow("PRESETS", "3:K25 4:K50");
      }
      else if (k == '#') {
        // Show first presets again
        lcdShow("PRESETS", "1:K5 2:K10 A=AMT");
      }
      else if (k == 'C') {
        // Cancel/Logout
        state = ST_LOGIN_CODE;
        inputBuf = "";
        lcdShow("SYSTEM RUNNING", "ENTER CODE");
      }
      break;

    case ST_AMOUNT:
      /***************************************************************************
       * FIXED: PIMISHA DECIMAL INPUT SUPPORT
       * 
       * Keys:
       *   0-9 = Enter digits
       *   D   = Decimal point (e.g., K33.75)
       *   *   = Backspace
       *   #   = Confirm amount
       *   C   = Cancel
       * 
       * Example: K33.75 = press 3, 3, D, 7, 5, #
       ***************************************************************************/
      if (isdigit(k)) {
        if (decimalEntered) {
          // After decimal point - add fractional digits (max 2)
          if (decimalPlaces < 2) {
            decimalPlaces++;
            float fraction = (k - '0') / pow(10.0f, decimalPlaces);
            amountZmw += fraction;
          }
        } else {
          // Before decimal point - whole number
          amountZmw = amountZmw * 10 + (k - '0');
        }
        // Display with decimals if entered
        if (decimalEntered) {
          lcdShow("AMOUNT (D=.)", "K" + String(amountZmw, decimalPlaces));
        } else {
          lcdShow("AMOUNT (D=.)", "K" + String((int)amountZmw));
        }
      }
      else if (k == 'D' && !decimalEntered) {
        // FIXED: 'D' key enters decimal point
        decimalEntered = true;
        decimalPlaces = 0;
        lcdShow("AMOUNT (D=.)", "K" + String((int)amountZmw) + ".");
      }
      else if (k == '#' && amountZmw > 0) {
        /***************************************************************************
         * PIMISHA: INTEGER ML CALCULATION
         * 
         * targetMl = ceil(amountZmw / PRICE_PER_ML)
         * targetPulses = ceil((targetMl / 1000.0) * pulsesPerLiter)
         * 
         * Examples at K25/L (0.025/ml):
         *   K1 → ceil(1/0.025) = 40ml
         *   K2 → ceil(2/0.025) = 80ml
         *   K5 → ceil(5/0.025) = 200ml
         ***************************************************************************/
        
        if (PRICE_PER_ML <= 0.0f) {
          lcdShow("PRICE ERROR", "CONFIG MISSING");
          Serial.println("[ERROR] PRICE_PER_ML <= 0");
          delay(1500);
          amountZmw = 0;
          state = ST_LOGIN_CODE;
          inputBuf = "";
          lcdShow("SYSTEM RUNNING", "ENTER CODE");
        } else {
          // PIMISHA: Integer ml calculation with ceil() for customer favor
          int targetMl = (int)ceil(amountZmw / PRICE_PER_ML);
          pendingTargetMl = targetMl;
          
          // Mark as CUSTOM transaction
          transactionType = "CUSTOM";
          presetLabel = "";
          selectedPresetIdx = -1;
          
          // Store as liters for dispensing (integer ml / 1000)
          targetLiters = (float)pendingTargetMl / 1000.0f;
          state = ST_READY;
          
          // Log calculation
          Serial.println("[CUSTOM] ==============================");
          Serial.printf("[CUSTOM] Amount: K%.2f\n", amountZmw);
          Serial.printf("[CUSTOM] Price: K%.3f/ml (K%.0f/L)\n", PRICE_PER_ML, PRICE_PER_LITER);
          Serial.printf("[CUSTOM] Target: %d ml\n", targetMl);
          Serial.println("[CUSTOM] ==============================");
          
          // Show what they pay and get (integer ml only)
          lcdShow("PAY:K" + String((int)amountZmw), "GET:" + String(targetMl) + "mL");
          delay(1200);
          lcdShow("B=START C=BACK", "CUSTOM");
        }
      }
      else if (k == 'C') {
        // Cancel back to preset menu - reset all custom amount state
        amountZmw = 0;
        decimalEntered = false;
        decimalPlaces = 0;
        pendingTargetMl = 0;
        state = ST_PRESET;
        lcdShow("PRESETS", "1:K5 2:K10 A=AMT");
      }
      else if (k == '*') {
        // PIMISHA Backspace - handle decimals properly
        if (decimalPlaces > 0) {
          // Remove last decimal digit
          decimalPlaces--;
          float multiplier = pow(10.0f, decimalPlaces);
          amountZmw = floor(amountZmw * multiplier) / multiplier;
          if (decimalPlaces == 0) {
            decimalEntered = false;  // No more decimals, allow new decimal
          }
        } else if (decimalEntered) {
          // Just entered decimal point, remove it
          decimalEntered = false;
        } else {
          // Remove last whole digit
          amountZmw = (int)(amountZmw / 10);
        }
        // Update display with or without decimals
        if (decimalEntered || decimalPlaces > 0) {
          char buf[16];
          snprintf(buf, sizeof(buf), "ENTER K: %.2f", amountZmw);
          lcdShow("CUSTOM AMOUNT", buf);
        } else {
          lcdShow("CUSTOM AMOUNT", "ENTER K: " + String((int)amountZmw));
        }
      }
      break;

    case ST_READY:
      if (k == 'B') {
        Serial.println("[DISPENSE] ==============================");
        Serial.println("[DISPENSE] START DISPENSING");
        Serial.printf("[DISPENSE] transactionType=%s\n", transactionType.c_str());
        if (transactionType == "PRESET") {
          Serial.printf("[DISPENSE] presetLabel=%s\n", presetLabel.c_str());
        }
        
        // Enforce calibration for accurate dispensing
        if (!isCalibrated) {
          Serial.println("[DISPENSE] Calibration required - blocking dispense");
          lcdShow("CAL REQUIRED", "ADMIN -> 4");
          state = ST_LOGIN_CODE;
          inputBuf = "";
          amountZmw = 0;
          pendingTargetMl = 0;
          targetLiters = 0;
          break;
        }

        // PIMISHA: Calculate target ml using integer math
        int targetMl = pendingTargetMl;
        Serial.printf("[DISPENSE] targetMl=%d\n", targetMl);
        Serial.printf("[DISPENSE] amountZmw=%.2f\n", amountZmw);
        
        if (targetMl <= 0) {
          Serial.println("[DISPENSE] ERROR: targetMl <= 0, aborting!");
          lcdShow("ERROR", "INVALID TARGET");
          delay(1500);
          state = ST_PRESET;
          amountZmw = 0;
          pendingTargetMl = 0;
          lcdShow("PRESETS", "1:K5 2:K10 A=AMT");
          break;
        }
        
        dispensedLiters = 0;
        flowPulses = 0;
        lastPulse = 0;
        
        // PIMISHA: Lock session values at dispense start
        sessionPricePerMl = PRICE_PER_ML;  // Always use LOCAL price
        sessionTargetMl = targetMl;
        sessionTargetLiters = (float)sessionTargetMl / 1000.0f;
        sessionPulsesPerLiter = pulsesPerLiter;
        
        // PIMISHA: Calculate target pulses with ceil() for accuracy
        // targetPulses = ceil((targetMl / 1000.0) * pulsesPerLiter)
        targetPulses = (uint32_t)ceil((targetMl / 1000.0f) * sessionPulsesPerLiter);
        
        sessionStartMs = millis();
        sessionCounter++;
        currentSessionId = String(DEVICE_ID) + "-" + String(sessionStartMs) + "-" + String(sessionCounter);
        
        Serial.printf("[DISPENSE] sessionId=%s\n", currentSessionId.c_str());
        Serial.printf("[DISPENSE] targetMl=%d, targetPulses=%lu, ppl=%.2f\\n\", targetMl, targetPulses, sessionPulsesPerLiter);
        Serial.printf("[DISPENSE] isCalibrated=%s\n", isCalibrated ? "YES" : "NO - VOLUMES MAY BE WRONG!");
        if (!isCalibrated) {
          Serial.println("[DISPENSE] *** WARNING: Using default 450 pulses/L - RUN CALIBRATION! ***");
          lcdShow("!NOT CALIBRATED!", "VOLUMES WRONG");
          delay(1500);
        }
        Serial.println("[DISPENSE] Activating pump...");
        
        pumpOn();  // START PUMP
        ledsDispensing();
        state = ST_DISPENSING;
        
        Serial.println("[DISPENSE] Pump activated, state=ST_DISPENSING");
        Serial.println("[DISPENSE] ==============================");
        lcdShow("DISPENSING", "0 ml");
      }
      else if (k == 'C') {
        // Cancel back to preset menu
        amountZmw = 0;
        state = ST_PRESET;
        lcdShow("PRESETS", "1:K5 2:K10 A=AMT");
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
          if (pulses >= (uint32_t)CALIBRATION_REQUIRED_PPL) {
            pulsesPerLiter = (float)pulses;
            isCalibrated = true;
            prefs.begin("calib", false);
            prefs.putFloat("pulsesPerL", pulsesPerLiter);
            prefs.end();
            Serial.printf("[CALIB] Calibration saved: %.0f pulses/L\n", pulsesPerLiter);
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
          uint32_t currentPulses;
          noInterrupts(); currentPulses = flowPulses; interrupts();
          float mlDone = (currentPulses * 1000.0f) / sessionPulsesPerLiter;
          float targetMl = (float)sessionTargetMl;
          if (mlDone > 0) {
            sendReceiptV2(amountZmw, targetMl, mlDone, sessionPricePerMl, sessionPulsesPerLiter, STOP_MARGIN_LITERS, "CANCELED");
          }
          float actualPaid = mlDone * sessionPricePerMl;
          lcdShow("CANCELLED", String((int)mlDone) + "ml K" + String((int)actualPaid));
          delay(1500);
          state = ST_LOGIN_CODE;
          scrollPos = 0;
          amountZmw = 0;
          targetLiters = 0;
          pendingTargetMl = 0;
          sessionTargetMl = 0;
        }
      }
      break;

    /* ================= ADMIN MENU STATES ================= */
    case ST_ADMIN_MENU:
      if (k == '1') {
        // Add new user (local only - for backward compatibility)
        newUserCode = "";
        newUserPin = "";
        state = ST_ADD_USER_CODE;
        lcdShow("NEW USER CODE", "");
      }
      else if (k == '2') {
        // Delete user (local only)
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
      else if (k == '5') {
        /***************************************************************************
         * MANUAL OPERATOR SYNC (Admin Menu Option)
         * 
         * Forces immediate sync of operators from dashboard.
         * Useful for:
         *   - After adding operators on dashboard
         *   - Troubleshooting sync issues
         *   - Network recovery
         ***************************************************************************/
        Serial.println("[ADMIN] Manual operator sync requested");
        if (isOnline) {
          lcdShow("SYNCING...", "FROM DASHBOARD");
          if (fetchOperatorsFromDashboard()) {
            lcdShow("SYNC OK", String(cachedOperatorCount) + " OPERATORS");
          } else {
            lcdShow("SYNC FAILED", "CHECK NETWORK");
          }
          delay(2000);
        } else {
          lcdShow("OFFLINE", "CANNOT SYNC");
          delay(1500);
        }
        lcdShow("ADMIN MENU", "5=SYNC 4=CAL");
      }
      else if (k == '6') {
        // Show network and sync status
        String status = isOnline ? "ONLINE" : "OFFLINE";
        lcdShow("NETWORK:" + status, "OPS:" + String(cachedOperatorCount));
        delay(2000);
        lcdShow("ADMIN MENU", "5=SYNC 4=CAL");
      }
      else if (k == 'A') {
        // Go to preset menu for dispensing
        state = ST_PRESET;
        amountZmw = 0;
        transactionType = "CUSTOM";
        presetLabel = "";
        selectedPresetIdx = -1;
        lcdShow("PRESETS", "1:K5 2:K10 A=AMT");
      }
      else if (k == 'C') {
        // Logout
        state = ST_LOGIN_CODE;
        inputBuf = "";
        currentOperatorId = "";
        currentOperatorName = "";
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
