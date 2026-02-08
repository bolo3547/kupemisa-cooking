volatile uint32_t pulses = 0;

// Calibration factor: pulses per liter for OF05ZAT flow sensor
// Default ~450 pulses/L — adjust via calibration for your specific sensor
static const float PULSES_PER_LITER = 450.0f;

float totalLiters = 0.0f;
float flowRate_Lpm = 0.0f;
uint32_t lastPulses = 0;
uint32_t lastTime = 0;

void IRAM_ATTR isr() {
  pulses++;
}

void setup() {
  Serial.begin(115200);
  delay(500);
  pinMode(27, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(27), isr, FALLING);

  Serial.println("\n========================================");
  Serial.println("   FLOW SENSOR MONITOR");
  Serial.println("========================================");
  Serial.printf("Flow Sensor: GPIO 27\n");
  Serial.printf("Calibration: %.1f pulses/L\n", PULSES_PER_LITER);
  Serial.println("========================================\n");
  Serial.println("Pulses | Flow (L/min) | Dispensed (L) | Dispensed (mL)");
  Serial.println("-------|--------------|---------------|---------------");

  lastTime = millis();
}

void loop() {
  static uint32_t t = 0;
  if (millis() - t > 1000) {
    uint32_t now = millis();

    noInterrupts();
    uint32_t p = pulses;
    interrupts();

    uint32_t dp = p - lastPulses;
    uint32_t dt = now - lastTime;
    lastPulses = p;
    lastTime = now;

    // Calculate volume from pulses
    float deltaLiters = dp / PULSES_PER_LITER;
    totalLiters += deltaLiters;
    float totalMl = totalLiters * 1000.0f;

    // Calculate flow rate in liters per minute
    flowRate_Lpm = (dt > 0) ? (deltaLiters * 60000.0f / (float)dt) : 0.0f;

    Serial.printf(" %5lu | %12.3f | %13.4f | %14.1f\n",
                  (unsigned long)dp, flowRate_Lpm, totalLiters, totalMl);

    t = now;
  }
  delay(50);
}
