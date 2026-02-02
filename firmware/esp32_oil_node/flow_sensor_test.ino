/*
 * FLOW SENSOR + PUMP TEST
 * Type 'P' in Serial Monitor to toggle pump ON/OFF
 */

#include <Arduino.h>

#define FLOW_PIN 4    // Flow sensor - GPIO 4 (has internal pull-up)
#define PUMP_PIN 23   // Relay for pump - back to GPIO 23 (was working before)
#define LED_PIN 2     // Built-in LED for visual feedback
#define RELAY_ACTIVE_HIGH false  // Active LOW - most relay modules

volatile int flowPulses = 0;
unsigned long oldTime = 0;
float flowRate = 0.0;
float totalLiters = 0.0;
bool pumpRunning = false;

// Calibration factor (pulses per liter) - adjust based on your sensor
// Typical for OF05ZAT: around 4000-5000 pulses/L (test and calibrate)
const float CALIBRATION_FACTOR = 4500.0;

void IRAM_ATTR pulseCounter() {
  flowPulses++;
}

void pumpOn() {
  digitalWrite(PUMP_PIN, RELAY_ACTIVE_HIGH ? HIGH : LOW);
  digitalWrite(LED_PIN, HIGH);  // LED ON when pump ON
  pumpRunning = true;
  Serial.println("\n>>> PUMP ON <<<  (LED should be ON)");
}

void pumpOff() {
  digitalWrite(PUMP_PIN, RELAY_ACTIVE_HIGH ? LOW : HIGH);
  digitalWrite(LED_PIN, LOW);   // LED OFF when pump OFF
  pumpRunning = false;
  Serial.println("\n>>> PUMP OFF <<< (LED should be OFF)");
}

void setup() {
  Serial.begin(115200);
  delay(500);
  
  // Setup LED for feedback
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);
  
  // Setup pump relay
  pinMode(PUMP_PIN, OUTPUT);
  pumpOff();
  
  // Setup flow sensor
  pinMode(FLOW_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(FLOW_PIN), pulseCounter, FALLING);
  
  Serial.println("\n========================================");
  Serial.println("   FLOW SENSOR + PUMP TEST");
  Serial.println("========================================");
  Serial.printf("Flow Sensor: GPIO %d\n", FLOW_PIN);
  Serial.printf("Pump Relay:  GPIO %d\n", PUMP_PIN);
  Serial.println("");
  Serial.println("COMMANDS (type in Serial Monitor):");
  Serial.println("  P = Toggle pump ON/OFF");
  Serial.println("  R = Reset total volume");
  Serial.println("========================================\n");
  
  Serial.println("Pump | Pulses | Flow (L/min) | Total (L)");
  Serial.println("-----|--------|--------------|----------");
  
  oldTime = millis();
}

void loop() {
  // Check for serial commands
  if (Serial.available()) {
    char cmd = Serial.read();
    if (cmd == 'P' || cmd == 'p') {
      if (pumpRunning) pumpOff(); else pumpOn();
    }
    if (cmd == 'R' || cmd == 'r') {
      totalLiters = 0;
      Serial.println("\n>>> TOTAL RESET <<<");
    }
  }
  
  if ((millis() - oldTime) > 1000) {  // Update every second
    noInterrupts();
    int pulses = flowPulses;
    flowPulses = 0;
    interrupts();
    
    // Calculate flow rate (liters per minute)
    flowRate = ((1000.0 / (millis() - oldTime)) * pulses) / CALIBRATION_FACTOR;
    totalLiters += pulses / CALIBRATION_FACTOR;
    
    // Display on serial console
    Serial.printf(" %s  | %6d | %12.3f | %9.4f\n",
                  pumpRunning ? "ON " : "OFF", pulses, flowRate, totalLiters);
    
    oldTime = millis();
  }
  
  delay(50);
}