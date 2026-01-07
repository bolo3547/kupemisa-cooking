# ESP32 Filling Station Dispenser - Firmware Update Summary

## Overview

The ESP32 firmware has been updated to function as a **filling-station oil dispenser** while maintaining all existing cloud telemetry, device authentication, command pull/ack, and WiFi provisioning features.

## New Hardware Support

### Components Added
| Component | Model | GPIO Pins | Purpose |
|-----------|-------|-----------|---------|
| TFT Display | ILI9488 3.5" SPI | 23 (MOSI), 18 (SCK), 5 (CS), 2 (DC), 4 (RST) | User interface |
| Keypad | 4x4 Matrix | 32,33,25,13 (rows), 12,14,16,17 (cols) | User input |
| Flow Sensor | AICHI OF05ZAT | 27 (interrupt) | Measure dispensed volume |
| Pump | STARFLO 12V | 26 (relay) | Oil delivery |

### Existing Components (Unchanged)
- Ultrasonic sensor: GPIO 18 (TRIG), 19 (ECHO)
- Flow sensor: GPIO 27
- Pump relay: GPIO 26

## State Machine

The dispenser operates with a non-blocking finite state machine:

```
                    ┌──────────────┐
                    │  IDLE_READY  │◄──────────────────────┐
                    └──────┬───────┘                       │
                           │ # pressed                     │
                           ▼                               │
                ┌─────────────────────┐                    │
                │ ENTER_TARGET_LITERS │                    │
                └──────────┬──────────┘                    │
                           │ # confirm                     │
                           ▼                               │
              ┌─────────────────────────┐                  │
              │ AUTH_PIN (if enabled)   │                  │
              └────────────┬────────────┘                  │
                           │ PIN correct                   │
                           ▼                               │
                    ┌────────────┐                         │
                    │  PRECHECK  │                         │
                    └──────┬─────┘                         │
                   ok │    │ fail                          │
                      ▼    └──────►┌─────────┐             │
               ┌────────────┐      │  ERROR  │─────────────┤
               │ DISPENSING │◄─────┴─────────┘             │
               └──────┬─────┘                              │
                      │ * pressed                          │
                      ▼                                    │
               ┌────────────┐                              │
               │   PAUSED   │──────────────────────────────┤
               └──────┬─────┘  * cancel                    │
                      │ # resume                           │
                      ▼                                    │
               ┌────────────┐                              │
               │ DISPENSING │                              │
               └──────┬─────┘                              │
                      │ target reached                     │
                      ▼                                    │
               ┌────────────┐                              │
               │    DONE    │──────────────────────────────┘
               └────────────┘     # or auto 10s
```

## State Details

| State | Actions | Display | Keypad |
|-------|---------|---------|--------|
| **IDLE_READY** | Show tank level, status | Tank %, liters, WiFi status | # Start, A Calibrate |
| **ENTER_TARGET_LITERS** | Collect numeric input | Input box with limits | 0-9 digits, # confirm, * cancel, C backspace |
| **AUTH_PIN** | Collect PIN (optional) | Masked PIN display | 0-9 digits, # confirm, * cancel |
| **PRECHECK** | Validate tank level, config | Brief transition | Automatic |
| **DISPENSING** | Pump ON, track flow | Target/dispensed/flow/progress | * pause |
| **PAUSED** | Pump OFF, hold state | Paused message | # resume, * cancel |
| **DONE** | Log transaction, send event | Summary with duration | # continue (auto 10s) |
| **ERROR** | Pump OFF, show error | Error message | # acknowledge |
| **CALIBRATION** | Manual calibration mode | Instructions + measured flow | D toggle pump, # save, * cancel |

## Safety Features

1. **Low Level Protection**: Blocks pump if tank < 5%
2. **Dry Run Detection**: Stops pump if no flow for 10 seconds
3. **Safety Margin**: Requires `targetLiters + 10L` available in tank
4. **Overshoot Correction**: Stops 0.05L early to prevent over-dispensing
5. **State Error Handling**: Any critical error transitions to ERROR state

## Cloud Integration

### Telemetry (Enhanced)
```json
{
  "ts": 1234567890,
  "oilPercent": 75.5,
  "oilLiters": 755.0,
  "flowLpm": 12.5,
  "pumpState": true,
  "safetyStatus": "OK",
  "meta": {
    "dispenserState": "DISPENSING",
    "transactionCounter": 42,
    "targetLiters": 50.0,
    "dispensedLiters": 23.5
  }
}
```

### Events
- **DISPENSE_DONE**: Successful completion with metadata
- **DISPENSE_ERROR**: Failed/cancelled with reason
- **PUMP_ON/OFF**: State changes
- **SAFETY_SHUTDOWN**: Critical safety stops

### Event Metadata
```json
{
  "targetLiters": 50.0,
  "dispensedLiters": 49.98,
  "durationSec": 245,
  "transactionId": 42
}
```

## Calibration Mode

Access by pressing **A** from IDLE screen:

1. Press **D** to toggle pump ON/OFF
2. Dispense a known volume into a measuring container
3. Enter the actual volume using keypad
4. Press **#** to calculate and save new pulses-per-liter

The calibration value is stored in NVS (non-volatile storage) and persists across reboots.

## Configuration Constants

```cpp
// Dispenser limits
#define MIN_DISPENSE_LITERS 1.0
#define MAX_DISPENSE_LITERS 500.0
#define SAFETY_MARGIN_LITERS 10.0
#define OVERSHOOT_CORRECTION 0.05

// Flow sensor
#define DEFAULT_PULSES_PER_LITER 450.0

// Timing
#define TELEMETRY_INTERVAL_MS 10000      // Normal
#define TELEMETRY_FAST_INTERVAL_MS 2000  // During dispensing
#define DISPLAY_REFRESH_MS 100

// Safety
#define CRITICAL_LEVEL_PERCENT 5.0
#define DRY_RUN_TIMEOUT_MS 10000
#define DRY_RUN_MIN_FLOW 0.1

// Authentication (optional)
#define AUTH_PIN_ENABLED false
#define AUTH_PIN "1234"
```

## Required Libraries

Install via Arduino Library Manager:
1. **ArduinoJson** (v6+)
2. **TFT_eSPI** by Bodmer
3. **Keypad** by Mark Stanley

## TFT_eSPI Setup

See `TFT_SETUP.md` for detailed configuration of `User_Setup.h`.

## Files Modified/Created

| File | Action | Description |
|------|--------|-------------|
| `esp32_oil_node.ino` | Modified | Added filling station mode (1785 lines) |
| `TFT_SETUP.md` | Created | TFT_eSPI configuration guide |
| `FIRMWARE_CHANGES.md` | Created | This summary document |

## Backward Compatibility

All existing features are preserved:
- ✅ Cloud telemetry reporting
- ✅ Device authentication
- ✅ Remote command pull/ack
- ✅ WiFi provisioning portal
- ✅ Offline data buffering
- ✅ Safety shutdown logic

The filling station mode runs **on top** of the existing system as a non-blocking state machine.
