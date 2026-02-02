/*
 * SIMPLE BLINK TEST
 * LED should blink every second
 * Relay should click every 2 seconds
 */

#include <Arduino.h>

#define LED_PIN 2     // Built-in LED
#define PUMP_PIN 23   // Relay

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  pinMode(LED_PIN, OUTPUT);
  pinMode(PUMP_PIN, OUTPUT);
  
  // Start with everything OFF
  digitalWrite(LED_PIN, LOW);
  digitalWrite(PUMP_PIN, HIGH);  // HIGH = OFF for active-low relay
  
  Serial.println("\n=== BLINK TEST ===");
  Serial.println("LED on GPIO 2 should blink every 1 second");
  Serial.println("Relay on GPIO 23 should click every 2 seconds");
}

int count = 0;

void loop() {
  count++;
  
  // Blink LED every second
  digitalWrite(LED_PIN, HIGH);
  Serial.print(count);
  Serial.println(": LED ON");
  delay(500);
  
  digitalWrite(LED_PIN, LOW);
  Serial.print(count);
  Serial.println(": LED OFF");
  delay(500);
  
  // Toggle relay every 2 seconds
  if (count % 2 == 0) {
    digitalWrite(PUMP_PIN, LOW);  // LOW = ON for active-low relay
    Serial.println(">>> RELAY ON <<<");
  } else {
    digitalWrite(PUMP_PIN, HIGH); // HIGH = OFF for active-low relay
    Serial.println(">>> RELAY OFF <<<");
  }
}
