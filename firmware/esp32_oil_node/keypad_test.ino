/*
 * Keypad Diagnostic Test
 * Upload this to test which keys are working
 * Open Serial Monitor at 115200 baud
 */

#include <Keypad.h>

const byte ROWS = 4, COLS = 4;
char keys[ROWS][COLS] = {
  {'1','2','3','A'},
  {'4','5','6','B'},
  {'7','8','9','C'},
  {'*','0','#','D'}
};

// Current pin assignment - adjust if needed
byte rowPins[ROWS] = {16, 17, 18, 19};
byte colPins[COLS] = {13, 25, 5, 26};

Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("\n========================================");
  Serial.println("       KEYPAD DIAGNOSTIC TEST");
  Serial.println("========================================");
  Serial.println("\nPin Configuration:");
  Serial.println("  Row pins: 16, 17, 18, 19");
  Serial.println("  Col pins: 13, 25, 5, 26");
  Serial.println("\nKeypad Layout:");
  Serial.println("  [1] [2] [3] [A]  <- Row 0 (GPIO 16)");
  Serial.println("  [4] [5] [6] [B]  <- Row 1 (GPIO 17)");
  Serial.println("  [7] [8] [9] [C]  <- Row 2 (GPIO 18)");
  Serial.println("  [*] [0] [#] [D]  <- Row 3 (GPIO 19)");
  Serial.println("   ^   ^   ^   ^");
  Serial.println("  C0  C1  C2  C3");
  Serial.println(" G13 G25  G5 G26");
  Serial.println("\nPress each key and check if it registers...\n");
}

void loop() {
  char key = keypad.getKey();
  
  if (key) {
    int row = -1, col = -1;
    
    // Find row and column of pressed key
    for (int r = 0; r < ROWS; r++) {
      for (int c = 0; c < COLS; c++) {
        if (keys[r][c] == key) {
          row = r;
          col = c;
          break;
        }
      }
    }
    
    Serial.print("✓ Key pressed: [");
    Serial.print(key);
    Serial.print("]  Row: ");
    Serial.print(row);
    Serial.print(" (GPIO ");
    Serial.print(rowPins[row]);
    Serial.print(")  Col: ");
    Serial.print(col);
    Serial.print(" (GPIO ");
    Serial.print(colPins[col]);
    Serial.println(")");
  }
}
