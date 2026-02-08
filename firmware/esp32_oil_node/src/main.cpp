/********************************************************************
 * ESP32 OIL DISPENSER — CALIBRATION + SAFETY (OLD CODE, FIXED MONEY) ✅
 *
 * FIXES DONE (based on your "old codes"):
 *  1) ✅ Money mode now ALWAYS prints the ENTERED Kwacha (K5–K500),
 *     not the calculated amount (so K45 will finish as K45, not K41).
 *  2) ✅ Removed the "simple stop by volume" that was killing early-stop logic.
 *     Now early-stop overshoot compensation actually works.
 *  3) ✅ NVS is no longer cleared on every boot (calibration now persists).
 *  4) ✅ When dispensing stops (complete/pause/fault), flow interrupt is detached
 *     (software "flow sensor off"). Re-attached on start/resume.
 *
 * Hardware:
 *  - ESP32 Dev Module
 *  - 16x2 I2C LCD @ 0x27 (SDA=21, SCL=22)
 *  - 4x4 Keypad  rows=13,12,14,27  cols=26,25,33,32
 *  - Relay/Pump on GPIO23 (ACTIVE LOW)
 *  - AICHI OF05ZAT Flow Sensor signal on GPIO4
 *
 * Features:
 *  - Presets A/B/C/D + custom amount in L / mL / Kwacha
 *  - NVS-stored calibration (pulses per liter)
 *  - Overshoot compensation (tunable stopLag + stopExtra)
 *  - Over-dispense safety hard stop (+50mL = FAULT)
 *  - Improved no-flow protection (6s timeout)
 *  - Calibration menu (hold * for 3s from IDLE)
 *
 * CALIBRATION MENU (hold * for 3s):
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

// ========================= MONEY CONFIG =========================
static const float PRICE_PER_LITER = 45.0f;  // your selling price
static const float MIN_KWACHA = 5.0f;
static const float MAX_KWACHA = 500.0f;

static const float MIN_LITERS = 0.05f; // 50mL
static const float MAX_LITERS = 50.0f;

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
DeviceState state = STATE_IDLE;

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
      float liters = k / PRICE_PER_LITER;
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
  lcdPrintPadded(0, 0, "COMPLETE!");

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
  float cost = target_L * PRICE_PER_LITER;
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
      pumpOff();
      detachFlow();
      state = STATE_CAL_REAL_VOL;
      calInput = "";

      lcd.clear();
      lcdPrintPadded(0, 0, "Dispensed 1.000L");
      lcdPrintPadded(0, 1, "Enter REAL mL");
      delay(1200);

      showCalRealVol();
      Serial.printf("CAL STOP: pulses=%u\n", p);
    }
    return;
  }

  // -------- NORMAL DISPENSE STOP LOGIC (EARLY STOP + SAFETY) --------
  if (state == STATE_DISPENSING && pumpRunning && targetPulses > 0) {
    // Over-dispense safety in pulses
    const uint32_t overPulses = (uint32_t)lroundf(OVER_DISPENSE_LIMIT_L * pulsesPerLiter);
    if (p > (targetPulses + overPulses)) {
      pumpOff();
      detachFlow();
      state = STATE_FAULT;
      Serial.printf("FAULT: OVER-DISPENSE p=%u target=%u\n", p, targetPulses);
      showFault("OVER-DISPENSE!");
      return;
    }

    // Early stop compensation
    const float pulsesPerSec = (dt > 0) ? ((float)dp * 1000.0f / (float)dt) : 0.0f;
    uint32_t stopEarly = 0;

    // ✅ FIX: For small amounts (under 500mL), NO early-stop - just stop at target
    // For larger amounts, use early-stop with 40% cap
    const uint32_t smallAmountPulses = (uint32_t)(0.5f * pulsesPerLiter);  // 500mL threshold
    
    if (targetPulses > smallAmountPulses) {
      // Large amount: use early-stop compensation
      stopEarly = (uint32_t)lroundf(pulsesPerSec * ((float)stopLagMs / 1000.0f)) + stopExtraPulses;
      const uint32_t maxEarlyStop = targetPulses * 40 / 100;
      if (stopEarly > maxEarlyStop) {
        stopEarly = maxEarlyStop;
      }
    }
    // else: small amount, stopEarly stays 0 (no early stop)

    const uint32_t stopAt = (stopEarly < targetPulses) ? (targetPulses - stopEarly) : targetPulses;

    // ✅ SINGLE stop decision (no earlier "dispensed_L >= target_L" that ruins compensation)
    if (p >= stopAt) {
      pumpOff();
      detachFlow();
      state = STATE_COMPLETE;
      total_L += dispensed_L;

      Serial.printf("STOP: p=%u stopAt=%u target=%u disp=%.3fL\n",
                    p, stopAt, targetPulses, dispensed_L);
      showComplete();
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

            float liters = enteredKwacha / PRICE_PER_LITER;

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
      state = STATE_IDLE;
      resetDispense();
      resetMoneyMode();
      showIdle();
      break;

    case STATE_FAULT:
      pumpOff();
      detachFlow();
      state = STATE_IDLE;
      resetDispense();
      resetMoneyMode();
      showIdle();
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
      Serial.println("Commands: s=status, r=reset, d=defaults");
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
      Serial.println("==============\n");
      break;

    case 'r': case 'R':
      pumpOff();
      detachFlow();
      state = STATE_IDLE;
      resetAll();
      showIdle();
      break;

    case 'd': case 'D':
      resetCalibrationDefaults();
      Serial.println("Calibration reset to defaults.");
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
  lcdPrintPadded(0, 1, "PPL=" + String((int)roundf(pulsesPerLiter)));

  Serial.println("\n==========================================");
  Serial.println("ESP32 OIL DISPENSER — FIXED MONEY EDITION");
  Serial.println("==========================================");
  Serial.printf("FLOW_PIN=%u EDGE=%s\n", FLOW_PIN, (FLOW_EDGE == FALLING) ? "FALLING" : "RISING");
  Serial.printf("PPL=%.1f (NVS)\n", pulsesPerLiter);
  Serial.printf("StopLag=%lu ms, StopExtra=%u pulses\n", (unsigned long)stopLagMs, stopExtraPulses);
  Serial.printf("NoFlowTimeout=%lu ms, OverDispenseLimit=%.0fmL\n",
                (unsigned long)NO_FLOW_TIMEOUT_MS, OVER_DISPENSE_LIMIT_L * 1000.0f);
  Serial.println("Hold * for 3s to enter CAL menu.");
  Serial.println("==========================================\n");

  delay(1200);
  resetDispense();
  showIdle();
  state = STATE_IDLE;
}

void loop() {
  calculateFlow();
  handleKeypad();
  handleSerial();
  updateDisplay();
}
