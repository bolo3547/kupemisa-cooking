/********************************************************************
 * ESP32 D1 R32 Oil Dispenser (Filling Station Mode)
 * Hardware:
 *  - ESP32 D1 R32 (UNO style)
 *  - 3.5" SPI TFT ILI9488 (TFT_eSPI)
 *  - Flow sensor (pulse output)
 *  - Pump (12V) via relay/MOSFET
 * Features:
 *  - Enter liters + Operator PIN (per transaction)
 *  - Auto stop at target liters
 *  - Price/L, Total cost, Profit
 *  - Offline receipt queue + optional cloud upload
 ********************************************************************/

#include <WiFi.h>
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
// #define API_BASE_URL "https://yourdomain.com"
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

// ========================= WIFI (optional) =========================
// If you want WiFi, set these. Otherwise it runs offline fine.
const char* WIFI_SSID = "";   // e.g. "MTN_4G"
const char* WIFI_PASS = "";   // e.g. "password"
// ================================================================

// ========================= PINS (D1 R32 safe) =========================
// Pump control
static const int PIN_PUMP = 26;
static const bool PUMP_ACTIVE_HIGH = true;

// Flow sensor pulse input (interrupt)
static const int PIN_FLOW = 27;

// TFT is wired via TFT_eSPI config:
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
byte colPins[COLS] = {13, 16, 17, 22};  // <- safe pins
Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

// ========================= DISPLAY =========================
TFT_eSPI tft = TFT_eSPI();

// ========================= STORAGE =========================
Preferences prefs;

// ========================= FLOW METER =========================
volatile uint32_t flowPulses = 0;

// Default calibration; you MUST calibrate for your sensor
float pulsesPerLiter = 450.0f;

float dispensedLiters = 0.0f;
float litersTotal = 0.0f;
float flowLpm = 0.0f;

uint32_t lastFlowMs = 0;
uint32_t lastPulseSnapshot = 0;

// Dry-run protection
uint32_t noFlowStartMs = 0;

// ISR
void IRAM_ATTR onFlowPulse() { flowPulses++; }

// ========================= PRICING =========================
struct Price {
  float sell = 23.0f; // selling price per liter
  float cost = 0.0f;  // cost price per liter
  char currency[8] = "ZMW";
} price;

// ========================= RECEIPT QUEUE =========================
static const int QSIZE = 20;

// ========================= STATE MACHINE =========================
enum State {
  READY,
  ENTER_LITERS,
  ENTER_PIN,
  DISPENSING,
  PAUSED,
  RECEIPT,
  ERROR_STATE,
  ADMIN
};
State state = READY;

String litersBuf = "";
String pinBuf = "";
String operatorPin = "";

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

// ========================= UTIL =========================
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

// ========================= UI =========================
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

void uiReady() {
  header("READY");
  tft.setTextSize(2);
  tft.setCursor(10, 90);
  tft.println("Press # to Start");
  tft.setTextSize(1);
  tft.setCursor(10, 140);
  tft.printf("Price/L: %s %.2f", price.currency, price.sell);
  tft.setCursor(10, 160);
  tft.printf("FlowCal: %.1f pulses/L", pulsesPerLiter);
  tft.setCursor(10, 190);
  tft.println("Hold A for Admin");
}

void uiLiters() {
  header("ENTER LITERS");
  tft.setTextSize(2);
  tft.setCursor(10, 95);
  tft.printf("L: %s", litersBuf.c_str());
  tft.setTextSize(1);
  tft.setCursor(10, 150);
  tft.print("# confirm   * cancel");
}

void uiPin() {
  header("ENTER PIN");
  tft.setTextSize(2);
  tft.setCursor(10, 95);
  String masked;
  for (int i=0;i<pinBuf.length();i++) masked += "*";
  tft.printf("PIN: %s", masked.c_str());
  tft.setTextSize(1);
  tft.setCursor(10, 150);
  tft.print("# confirm   * cancel");
}

void uiDispense() {
  header("DISPENSING");
  float total = dispensedLiters * price.sell;
  float profit = dispensedLiters * (price.sell - price.cost);

  tft.setTextSize(2);
  tft.setCursor(10, 78);
  tft.printf("T:%.2fL", targetLiters);
  tft.setCursor(10, 104);
  tft.printf("D:%.2fL", dispensedLiters);

  tft.setTextSize(1);
  tft.setCursor(10, 135);
  tft.printf("Flow: %.2f L/min", flowLpm);
  tft.setCursor(10, 150);
  tft.printf("Price/L: %s %.2f", price.currency, price.sell);
  tft.setCursor(10, 165);
  tft.printf("Total: %s %.2f", price.currency, total);
  tft.setCursor(10, 180);
  tft.printf("Profit: %s %.2f", price.currency, profit);
  tft.setCursor(10, 205);
  tft.print("* pause");
}

void uiPaused() {
  header("PAUSED");
  tft.setTextSize(2);
  tft.setCursor(10, 95);
  tft.print("Pump OFF");
  tft.setTextSize(1);
  tft.setCursor(10, 150);
  tft.print("# resume   * cancel");
}

void uiReceipt() {
  header("RECEIPT");
  float total = dispensedLiters * price.sell;
  float profit = dispensedLiters * (price.sell - price.cost);
  uint32_t durSec = (millis() - dispenseStartMs)/1000;

  tft.setTextSize(1);
  tft.setCursor(10, 80);
  tft.println("--------------------------------");
  tft.setCursor(10, 95);
  tft.println("      OIL DISPENSE RECEIPT");
  tft.setCursor(10, 110);
  tft.println("--------------------------------");

  tft.setCursor(10, 125);
  tft.printf("Price/L: %s %.2f", price.currency, price.sell);
  tft.setCursor(10, 138);
  tft.printf("Target:  %.2f L", targetLiters);
  tft.setCursor(10, 151);
  tft.printf("Disp:    %.2f L", dispensedLiters);
  tft.setCursor(10, 164);
  tft.printf("Total:   %s %.2f", price.currency, total);
  tft.setCursor(10, 177);
  tft.printf("Profit:  %s %.2f", price.currency, profit);
  tft.setCursor(10, 190);
  tft.printf("Time:    %lu s", (unsigned long)durSec);

  tft.setCursor(10, 210);
  tft.println("Press # finish");
}

void uiError() {
  header("ERROR");
  tft.setTextSize(2);
  tft.setCursor(10, 95);
  tft.print("STOPPED");
  tft.setTextSize(1);
  tft.setCursor(10, 130);
  tft.print(lastError);
  tft.setCursor(10, 160);
  tft.print("Press # to reset");
}

// ========================= NVS STORE =========================
void loadSettings() {
  // pricing
  prefs.begin("price", true);
  price.sell = prefs.getFloat("sell", price.sell);
  price.cost = prefs.getFloat("cost", price.cost);
  String cur = prefs.getString("cur", "ZMW");
  memset(price.currency, 0, sizeof(price.currency));
  cur.toCharArray(price.currency, sizeof(price.currency));
  prefs.end();

  // flow calib
  prefs.begin("flow", true);
  pulsesPerLiter = prefs.getFloat("ppl", pulsesPerLiter);
  prefs.end();

  // receipt queue init
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
  if (head - tail > QSIZE) tail++; // overwrite oldest

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

// ========================= HTTP =========================
bool httpPostJson(const char* path, const String& body) {
  if (WiFi.status() != WL_CONNECTED) return false;
  if (!isCloudEnabled()) return false;

  HTTPClient http;
  http.begin(endpoint(path));
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-id", String(DEVICE_ID));
  http.addHeader("x-api-key", String(API_KEY));
  int code = http.POST((uint8_t*)body.c_str(), body.length());
  http.end();
  return (code >= 200 && code < 300);
}

// ========================= TELEMETRY =========================
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
  httpPostJson("/api/ingest/telemetry", body);
}

// ========================= RECEIPT =========================
String sessionId() {
  return String(DEVICE_ID) + "-" + String(dispenseStartMs);
}

void uploadReceiptOrQueue(const char* status, const String& err) {
  uint32_t endU = unixNow();
  uint32_t startU = dispenseStartUnix ? dispenseStartUnix : (dispenseStartMs/1000);
  uint32_t endUnix = endU ? endU : (millis()/1000);

  uint32_t durSec = (millis() - dispenseStartMs) / 1000;

  StaticJsonDocument<768> doc;
  doc["sessionId"] = sessionId();
  doc["operatorPin"] = operatorPin;
  doc["targetLiters"] = targetLiters;
  doc["dispensedLiters"] = dispensedLiters;
  doc["durationSec"] = (int)durSec;
  doc["status"] = status;
  if (err.length()) doc["errorMessage"] = err;
  doc["startedAtUnix"] = startU;
  doc["endedAtUnix"] = endUnix;

  String body;
  serializeJson(doc, body);

  if (!httpPostJson("/api/ingest/receipt", body)) {
    qPush(body);
  }
}

void retryQueuedReceipts() {
  if (WiFi.status() != WL_CONNECTED) return;
  String item;
  if (!qPeek(item)) return;
  if (httpPostJson("/api/ingest/receipt", item)) qPop();
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

  // dry-run protection
  if (state == DISPENSING && pumpOn()) {
    if (flowLpm < 0.01f) {
      if (noFlowStartMs == 0) noFlowStartMs = now;
      if (now - noFlowStartMs > 10000) {
        pumpSet(false);
        lastError = "DRY RUN: no flow";
        state = ERROR_STATE;
      }
    } else noFlowStartMs = 0;
  } else noFlowStartMs = 0;
}

// ========================= ADMIN (simple) =========================
String adminBuf = "";
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

// ========================= WIFI + TIME =========================
void connectWiFi() {
  if (String(WIFI_SSID).length() == 0) return;

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 8000) {
    delay(200);
  }

  if (WiFi.status() == WL_CONNECTED) {
    configTime(0, 0, "pool.ntp.org", "time.google.com", "time.nist.gov");
  }
}

// ========================= SETUP =========================
void setup() {
  Serial.begin(115200);

  pinMode(PIN_PUMP, OUTPUT);
  pumpSet(false);

  pinMode(PIN_FLOW, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_FLOW), onFlowPulse, RISING);

  tft.init();
  tft.setRotation(1);

  loadSettings();
  connectWiFi();

  uiReady();
}

// ========================= LOOP =========================
uint32_t holdAStart = 0;
bool holdingA = false;

void loop() {
  updateFlow();

  // periodic tasks
  if (millis() - lastTelemetryMs > TELEMETRY_MS) {
    lastTelemetryMs = millis();
    sendTelemetry();
  }
  if (millis() - lastReceiptRetryMs > RETRY_MS) {
    lastReceiptRetryMs = millis();
    retryQueuedReceipts();
  }

  // UI refresh
  if (millis() - lastUiMs > UI_MS) {
    lastUiMs = millis();
    switch (state) {
      case READY: uiReady(); break;
      case ENTER_LITERS: uiLiters(); break;
      case ENTER_PIN: uiPin(); break;
      case DISPENSING: uiDispense(); break;
      case PAUSED: uiPaused(); break;
      case RECEIPT: uiReceipt(); break;
      case ERROR_STATE: uiError(); break;
      case ADMIN:
        if (am == AMENU) uiAdminMenu();
        else if (am == A_SELL) uiAdminInput("Enter SELL price (e.g 23.5)");
        else if (am == A_COST) uiAdminInput("Enter COST price (e.g 18.0)");
        else if (am == A_CAL)  uiAdminInput("Enter pulsesPerLiter");
        break;
    }
  }

  // keypad
  char k = keypad.getKey();
  if (k) {
    // admin hold detection: pressing A in READY starts hold timer
    if (state == READY && k == 'A') {
      if (!holdingA) { holdingA = true; holdAStart = millis(); }
    } else {
      holdingA = false;
    }

    // ---------- NORMAL MODE ----------
    if (state == READY) {
      if (k == '#') { litersBuf = ""; state = ENTER_LITERS; }
    }
    else if (state == ENTER_LITERS) {
      if (k >= '0' && k <= '9') {
        if (litersBuf.length() < 6) litersBuf += k;
      } else if (k == '*') {
        state = READY;
      } else if (k == '#') {
        targetLiters = litersBuf.toFloat();
        if (targetLiters <= 0) { lastError = "Invalid liters"; state = ERROR_STATE; }
        else { pinBuf = ""; state = ENTER_PIN; }
      }
    }
    else if (state == ENTER_PIN) {
      if (k >= '0' && k <= '9') {
        if (pinBuf.length() < 8) pinBuf += k;
      } else if (k == '*') {
        state = READY;
      } else if (k == '#') {
        operatorPin = pinBuf;
        // start dispensing
        dispensedLiters = 0.0f;
        noFlowStartMs = 0;
        dispenseStartMs = millis();
        dispenseStartUnix = unixNow();
        pumpSet(true);
        state = DISPENSING;
      }
    }
    else if (state == DISPENSING) {
      if (k == '*') {
        pumpSet(false);
        state = PAUSED;
      }
    }
    else if (state == PAUSED) {
      if (k == '#') { pumpSet(true); state = DISPENSING; }
      else if (k == '*') {
        pumpSet(false);
        uploadReceiptOrQueue("CANCELED", "User canceled");
        state = READY;
      }
    }
    else if (state == RECEIPT) {
      if (k == '#') state = READY;
    }
    else if (state == ERROR_STATE) {
      if (k == '#') { lastError = ""; state = READY; }
    }

    // ---------- ADMIN MODE ----------
    if (state == ADMIN) {
      if (am == AMENU) {
        if (k == '*') { state = READY; am = AMENU; adminBuf = ""; }
        else if (k == 'A') { am = A_SELL; adminBuf = ""; }
        else if (k == 'B') { am = A_COST; adminBuf = ""; }
        else if (k == 'C') { am = A_CAL;  adminBuf = ""; }
      } else {
        if (k >= '0' && k <= '9') {
          if (adminBuf.length() < 10) adminBuf += k;
        } else if (k == '*') {
          am = AMENU; adminBuf = "";
        } else if (k == '#') {
          float v = adminBuf.toFloat();
          if (am == A_SELL) { if (v >= 0) price.sell = v; savePricing(); }
          if (am == A_COST) { if (v >= 0) price.cost = v; savePricing(); }
          if (am == A_CAL)  {
            if (v > 1 && v < 1000000) {
              pulsesPerLiter = v;
              prefs.begin("flow", false);
              prefs.putFloat("ppl", pulsesPerLiter);
              prefs.end();
            }
          }
          am = AMENU; adminBuf = "";
        }
      }
    }
  }

  // hold A -> enter admin
  if (holdingA && state == READY) {
    if (millis() - holdAStart > 1200) {
      holdingA = false;
      state = ADMIN;
      am = AMENU;
      adminBuf = "";
    }
  }

  // auto stop at target
  if (state == DISPENSING) {
    if (dispensedLiters >= targetLiters) {
      pumpSet(false);
      uploadReceiptOrQueue("DONE", "");
      state = RECEIPT;
    }
  }
}
