/*
 * Keypad Pin Mapping Diagnostic
 * This will help identify the correct row/column order for your keypad
 * 
 * Instructions:
 * 1. Upload this sketch
 * 2. Open Serial Monitor at 115200
 * 3. Press keys and note what's printed vs what you pressed
 * 4. Share the results with me
 */

#include <Keypad.h>

const byte ROWS = 4, COLS = 4;

// Standard layout - what SHOULD be printed
char keys[ROWS][COLS] = {
  {'1','2','3','A'},
  {'4','5','6','B'},
  {'7','8','9','C'},
  {'*','0','#','D'}
};

// Current wiring - we'll adjust this based on your results
byte rowPins[ROWS] = {16, 17, 18, 19};
byte colPins[COLS] = {13, 25, 5, 26};

Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("\n==========================================");
  Serial.println("    KEYPAD PIN MAPPING DIAGNOSTIC");
  Serial.println("==========================================");
  Serial.println("\nPress each key and tell me:");
  Serial.println("  - What key you PRESSED physically");
  Serial.println("  - What key was PRINTED on screen");
  Serial.println("\nExample: 'I pressed 2 but it shows 4'");
  Serial.println("\nCurrent wiring:");
  Serial.println("  Keypad pins 1-4 -> ESP32: 16, 17, 18, 19 (rows)");
  Serial.println("  Keypad pins 5-8 -> ESP32: 13, 25, 5, 26 (cols)");
  Serial.println("\n------------------------------------------\n");
}

void loop() {
  char key = keypad.getKey();
  
  if (key) {
    Serial.print(">>> Detected: [");
    Serial.print(key);
    Serial.println("]");
  }
}
