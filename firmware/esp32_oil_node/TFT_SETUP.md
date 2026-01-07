# TFT_eSPI Configuration for ILI9488 3.5" SPI Display

## Required Library

Install **TFT_eSPI** by Bodmer from Arduino Library Manager.

## User_Setup.h Configuration

After installing TFT_eSPI, navigate to:
```
Arduino/libraries/TFT_eSPI/User_Setup.h
```

Comment out all existing driver definitions and add/uncomment the following:

```cpp
// ==================== DRIVER SELECTION ====================
#define ILI9488_DRIVER

// ==================== DISPLAY RESOLUTION ====================
#define TFT_WIDTH  320
#define TFT_HEIGHT 480

// ==================== ESP32 SPI PIN DEFINITIONS ====================
// These pins are for ESP32-WROOM-32

#define TFT_MOSI 23    // SDA/MOSI - Data to display
#define TFT_SCLK 18    // SCK/CLK  - Clock
#define TFT_CS   5     // CS       - Chip Select
#define TFT_DC   2     // DC/RS    - Data/Command
#define TFT_RST  4     // RST      - Reset

// Optional: Hardware backlight control
// #define TFT_BL   15    // Backlight pin (optional)
// #define TFT_BACKLIGHT_ON HIGH

// ==================== SPI FREQUENCY ====================
#define SPI_FREQUENCY  40000000  // 40 MHz
#define SPI_READ_FREQUENCY  20000000
#define SPI_TOUCH_FREQUENCY  2500000

// ==================== OPTIONAL: TOUCH SCREEN ====================
// If your display has touch (XPT2046), uncomment:
// #define TOUCH_CS 21
```

## Hardware Wiring

### ILI9488 3.5" SPI TFT to ESP32-WROOM-32

| TFT Pin | ESP32 Pin | Description |
|---------|-----------|-------------|
| VCC     | 3.3V      | Power (3.3V only!) |
| GND     | GND       | Ground |
| CS      | GPIO 5    | Chip Select |
| RESET   | GPIO 4    | Reset |
| DC/RS   | GPIO 2    | Data/Command |
| SDI/MOSI| GPIO 23   | SPI Data In |
| SCK     | GPIO 18   | SPI Clock |
| LED     | GPIO 15   | Backlight (optional, can connect to 3.3V) |
| SDO/MISO| GPIO 19   | SPI Data Out (optional, for reading) |

### 4x4 Keypad Wiring

| Keypad Pin | ESP32 Pin | Description |
|------------|-----------|-------------|
| R1         | GPIO 32   | Row 1 |
| R2         | GPIO 33   | Row 2 |
| R3         | GPIO 25   | Row 3 |
| R4         | GPIO 13   | Row 4 |
| C1         | GPIO 12   | Column 1 |
| C2         | GPIO 14   | Column 2 |
| C3         | GPIO 16   | Column 3 |
| C4         | GPIO 17   | Column 4 |

### AICHI OF05ZAT Flow Sensor

| Sensor Pin | ESP32 Pin | Description |
|------------|-----------|-------------|
| VCC        | 5V        | Power (5-24V) |
| GND        | GND       | Ground |
| Signal     | GPIO 27   | Pulse output (use pull-up) |

### STARFLO 12V Pump (via Relay/MOSFET)

| Component | ESP32 Pin | Description |
|-----------|-----------|-------------|
| Relay IN  | GPIO 26   | Control signal |
| Relay VCC | 5V        | Relay power |
| Relay GND | GND       | Ground |

## Pin Conflict Notes

⚠️ **Important**: The default configuration uses:
- GPIO 18 for both TFT SCK and Ultrasonic TRIG
- GPIO 19 for both TFT MISO and Ultrasonic ECHO

**Solutions:**

### Option A: Use Separate Ultrasonic Pins
Change ultrasonic pins in the firmware:
```cpp
#define TRIG_PIN 22  // Changed from 18
#define ECHO_PIN 21  // Changed from 19
```

### Option B: Use Different SPI Pins for TFT
In User_Setup.h:
```cpp
#define TFT_MOSI 13   // Different MOSI
#define TFT_SCLK 14   // Different SCK
```

### Option C: Disable Ultrasonic (if not needed)
If you're only using the flow sensor for measurements, you can skip ultrasonic wiring.

## Keypad Library

Install **Keypad** by Mark Stanley from Arduino Library Manager.

The keypad layout in firmware:
```
  C1   C2   C3   C4
  ↓    ↓    ↓    ↓
┌────┬────┬────┬────┐
│ 1  │ 2  │ 3  │ A  │ ← R1
├────┼────┼────┼────┤
│ 4  │ 5  │ 6  │ B  │ ← R2
├────┼────┼────┼────┤
│ 7  │ 8  │ 9  │ C  │ ← R3
├────┼────┼────┼────┤
│ *  │ 0  │ #  │ D  │ ← R4
└────┴────┴────┴────┘
```

## Calibration

### Flow Sensor Calibration

1. From IDLE screen, press **A** to enter calibration mode
2. Press **D** to toggle the pump ON
3. Dispense a known volume (e.g., exactly 1 liter into a measuring container)
4. Press **D** to turn pump OFF
5. Enter the actual volume dispensed using the keypad
6. Press **#** to save the new calibration

The firmware will calculate and store the correct pulses-per-liter value.

### Default Calibration Values

```cpp
#define DEFAULT_PULSES_PER_LITER 450.0  // AICHI OF05ZAT typical value
```

Typical ranges:
- AICHI OF05ZAT: 400-500 pulses/liter
- YF-S201: ~450 pulses/liter
- Adjust based on your specific sensor and fluid viscosity

## State Machine Reference

| State | Description | Keys |
|-------|-------------|------|
| IDLE_READY | Waiting for user | # Start, A Calibrate |
| ENTER_TARGET | Enter liters | 0-9 Input, # Confirm, * Cancel, C Backspace |
| AUTH_PIN | Enter PIN (if enabled) | 0-9 Input, # Confirm, * Cancel |
| PRECHECK | Validating | Automatic |
| DISPENSING | Pump running | * Pause |
| PAUSED | Pump stopped | # Resume, * Cancel |
| DONE | Complete | # Continue (or auto after 10s) |
| ERROR | Error state | # Acknowledge |
| CALIBRATION | Flow calibration | D Pump, # Save, * Cancel |

## Cloud Events

The dispenser sends these events to the cloud:

| Event Type | Severity | When |
|------------|----------|------|
| DISPENSE_DONE | INFO | Successfully completed dispense |
| DISPENSE_ERROR | WARNING | Dispense failed or cancelled |
| PUMP_ON | INFO | Pump turned on |
| PUMP_OFF | INFO | Pump turned off |
| SAFETY_SHUTDOWN | CRITICAL | Safety system stopped pump |
| DRY_RUN_SHUTDOWN | CRITICAL | No flow detected with pump on |

Event metadata includes:
- `targetLiters`: Requested amount
- `dispensedLiters`: Actual amount dispensed
- `durationSec`: Time taken
- `transactionId`: Sequential transaction number
