volatile uint32_t pulses = 0;

void IRAM_ATTR isr() {
  pulses++;
}

void setup() {
  Serial.begin(115200);
  pinMode(27, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(27), isr, FALLING);
}

void loop() {
  static uint32_t t = 0;
  if (millis() - t > 500) {
    t = millis();
    Serial.println(pulses);
  }
}
