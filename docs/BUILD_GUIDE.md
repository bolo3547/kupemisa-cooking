# Oil Dispensing System - Build & Development Guide

A complete IoT-based oil dispensing system for filling stations, featuring operator authentication, automated dispensing, and cloud-based transaction tracking.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Hardware Requirements](#hardware-requirements)
3. [Software Requirements](#software-requirements)
4. [Wiring Diagram](#wiring-diagram)
5. [How It Works](#how-it-works)
6. [Setup Instructions](#setup-instructions)
7. [Configuration](#configuration)
8. [Troubleshooting](#troubleshooting)

---

## System Overview

This system works like a fuel station pump but for cooking oil:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        OIL DISPENSING SYSTEM                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌──────────────┐      ┌──────────────┐      ┌──────────────────────┐ │
│   │   OPERATOR   │      │    ESP32     │      │   CLOUD DASHBOARD    │ │
│   │   (Keypad)   │─────►│   DEVICE     │◄────►│   (Web App)          │ │
│   └──────────────┘      └──────┬───────┘      └──────────────────────┘ │
│                                │                                        │
│                    ┌───────────┼───────────┐                           │
│                    ▼           ▼           ▼                           │
│              ┌─────────┐ ┌─────────┐ ┌─────────┐                       │
│              │  RELAY  │ │  FLOW   │ │   LCD   │                       │
│              │  (Pump) │ │ SENSOR  │ │ DISPLAY │                       │
│              └────┬────┘ └─────────┘ └─────────┘                       │
│                   ▼                                                     │
│              ┌─────────┐                                               │
│              │ 12V PUMP│                                               │
│              └─────────┘                                               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key Features

- **Operator Login**: PIN-based authentication via keypad
- **Preset Dispensing**: Enter target liters, system auto-stops
- **Flow Measurement**: Accurate volume tracking with flow sensor
- **Transaction Recording**: All sales sent to cloud dashboard
- **Offline Support**: Works without internet, syncs when connected
- **Safety Features**: Watchdog timer, tamper detection, emergency stop

---

## Hardware Requirements

### Main Components

| Component | Specification | Purpose | Estimated Cost |
|-----------|--------------|---------|----------------|
| ESP32 Dev Board | ESP32-WROOM-32 | Main controller | $5-10 |
| 16x2 LCD Display | I2C (PCF8574) | User interface | $3-5 |
| 4x4 Matrix Keypad | Membrane type | Input (PIN, liters) | $2-3 |
| Flow Sensor | YF-S201 or similar | Measure oil volume | $5-10 |
| Relay Module | 5V, 4-channel | Control 12V pump | $3-5 |
| 12V DC Pump | 3-5A capacity | Dispense oil | $15-30 |
| Buzzer | 3.3V active | Audio feedback | $1 |
| Power Supply | 12V 5A DC | Power pump | $5-10 |
| Power Supply | 5V 2A (USB) | Power ESP32 | $3-5 |

### Additional Materials

| Item | Quantity | Purpose |
|------|----------|---------|
| Breadboard or PCB | 1 | Connections |
| Jumper wires | 30+ | Wiring |
| 10kΩ Resistor | 2 | Pull-up for flow sensor |
| Enclosure/Cabinet | 1 | Housing |
| Terminal blocks | 5-10 | Secure connections |

### Total Estimated Cost: **$50-90 USD**

---

## Software Requirements

### Development Environment

1. **VS Code** - Code editor
   - Download: https://code.visualstudio.com/

2. **PlatformIO Extension** - ESP32 development
   - Install from VS Code Extensions marketplace

3. **Node.js** (for web dashboard)
   - Download: https://nodejs.org/

### Libraries (Auto-installed by PlatformIO)

- ArduinoJson
- LiquidCrystal_I2C
- Keypad
- WiFi (built-in)
- HTTPClient (built-in)
- Preferences (built-in)

---

## Wiring Diagram

### Pin Connections

```
ESP32 GPIO PINOUT FOR OIL DISPENSER
====================================

                    ┌─────────────────────┐
                    │       ESP32         │
                    │                     │
     LCD SDA ◄──────│ GPIO 21        VIN  │──────► 5V Power
     LCD SCL ◄──────│ GPIO 22        GND  │──────► Common Ground
                    │                     │
  Keypad R1 ◄───────│ GPIO 26       GPIO 32│──────► Relay IN1 (Pump)
  Keypad R2 ◄───────│ GPIO 25       GPIO 33│──────► Buzzer (+)
  Keypad R3 ◄───────│ GPIO 5        GPIO 35│◄────── Flow Sensor Signal
  Keypad R4 ◄───────│ GPIO 27       GPIO 34│◄────── Tamper Switch (optional)
                    │                     │
  Keypad C1 ◄───────│ GPIO 16        3.3V │──────► (spare)
  Keypad C2 ◄───────│ GPIO 17         EN  │
  Keypad C3 ◄───────│ GPIO 18             │
  Keypad C4 ◄───────│ GPIO 19             │
                    │                     │
                    └─────────────────────┘
```

### Component Wiring Details

#### 1. LCD Display (I2C)

| LCD Pin | ESP32 Pin |
|---------|-----------|
| VCC | 5V (VIN) |
| GND | GND |
| SDA | GPIO 21 |
| SCL | GPIO 22 |

#### 2. 4x4 Keypad

| Keypad Wire | ESP32 Pin | Function |
|-------------|-----------|----------|
| Pin 1 | GPIO 26 | Row 1 (1,2,3,A) |
| Pin 2 | GPIO 25 | Row 2 (4,5,6,B) |
| Pin 3 | GPIO 5 | Row 3 (7,8,9,C) |
| Pin 4 | GPIO 27 | Row 4 (*,0,#,D) |
| Pin 5 | GPIO 16 | Column 1 |
| Pin 6 | GPIO 17 | Column 2 |
| Pin 7 | GPIO 18 | Column 3 |
| Pin 8 | GPIO 19 | Column 4 |

#### 3. Relay Module (4-Channel)

| Relay Pin | Connection |
|-----------|------------|
| VCC | ESP32 VIN (5V) |
| GND | ESP32 GND |
| IN1 | ESP32 GPIO 32 |
| IN2-IN4 | Not used |

**Relay Output (Channel 1):**
| Terminal | Connection |
|----------|------------|
| COM | 12V Power Supply (+) |
| NO | Pump Red Wire (+) |
| NC | Not used |

**Pump Ground:**
| From | To |
|------|-----|
| Pump Black (-) | 12V Power Supply (-) |

#### 4. Flow Sensor

| Sensor Wire | Connection |
|-------------|------------|
| Red (VCC) | ESP32 VIN (5V) |
| Black (GND) | ESP32 GND |
| Yellow (Signal) | ESP32 GPIO 35 |

**Note:** Add 10kΩ pull-up resistor between GPIO 35 and 3.3V

#### 5. Buzzer

| Buzzer | Connection |
|--------|------------|
| + (Positive) | ESP32 GPIO 33 |
| - (Negative) | ESP32 GND |

### Complete Wiring Diagram

```
                                         ┌─────────────────┐
                                         │  12V POWER      │
                                         │  SUPPLY         │
    ┌────────────────┐                   └────┬───────┬────┘
    │     ESP32      │                        │       │
    │                │                        │       │
    │  VIN ──────────┼────┬───────────────────┼───────┘
    │                │    │                   │
    │  GND ──────────┼────┼─────┬─────┬───────┼──────────────────┐
    │                │    │     │     │       │                  │
    │  GPIO 32 ──────┼────┼─────┼─────┼───────┼──┐               │
    │                │    │     │     │       │  │               │
    └────────────────┘    │     │     │       │  │               │
                          │     │     │       │  │               │
    ┌─────────────────────┼─────┼─────┼───────┼──┼───────────────┼─┐
    │  4-CH RELAY MODULE  │     │     │       │  │               │ │
    │                     │     │     │       │  │               │ │
    │  VCC ◄──────────────┘     │     │       │  │               │ │
    │  GND ◄────────────────────┘     │       │  │               │ │
    │  IN1 ◄──────────────────────────┼───────┼──┘               │ │
    │                                 │       │                  │ │
    │  CH1: COM ◄─────────────────────┼───────┘                  │ │
    │       NO  ──────────────────────┼─────────────┐            │ │
    │                                 │             │            │ │
    └─────────────────────────────────┼─────────────┼────────────┘ │
                                      │             │              │
                              ┌───────┼─────────────┼──────────────┼─┐
                              │ PUMP  │             │              │ │
                              │       │             │              │ │
                              │  (+) ◄┼─────────────┘              │ │
                              │  (-) ◄┼────────────────────────────┘ │
                              │       │                              │
                              └───────┘                              │
                                                                     │
    ┌─────────────────────┐                                          │
    │  FLOW SENSOR        │                                          │
    │                     │                                          │
    │  VCC ◄──────────────┼──── 5V (VIN)                             │
    │  GND ◄──────────────┼──────────────────────────────────────────┘
    │  Signal ────────────┼──── GPIO 35
    │                     │
    └─────────────────────┘
```

---

## How It Works

### Operating Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                      OPERATING SEQUENCE                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. IDLE STATE                                                   │
│     LCD: "WAIT AUTH"                                             │
│          "Press A Login"                                         │
│     Pump: OFF                                                    │
│                                                                  │
│              │                                                   │
│              ▼ Press 'A'                                         │
│                                                                  │
│  2. ENTER PIN                                                    │
│     LCD: "Enter PIN:"                                            │
│          "****"                                                  │
│     Keys: 0-9 to enter, # to confirm, * to cancel               │
│                                                                  │
│              │                                                   │
│              ▼ Press '#'                                         │
│                                                                  │
│  3. VERIFY PIN                                                   │
│     - Online: Send to cloud API for verification                 │
│     - Offline: Check against cached PIN hashes                   │
│                                                                  │
│              │                                                   │
│              ▼ PIN Valid                                         │
│                                                                  │
│  4. ENTER LITERS                                                 │
│     LCD: "Enter Liters:"                                         │
│          "0"                                                     │
│     Keys: 0-9 to enter, # to confirm, * to cancel               │
│                                                                  │
│              │                                                   │
│              ▼ Press '#'                                         │
│                                                                  │
│  5. READY TO DISPENSE                                            │
│     LCD: "READY 50.0L"                                           │
│          "D=Start *=Cancel"                                      │
│                                                                  │
│              │                                                   │
│              ▼ Press 'D'                                         │
│                                                                  │
│  6. DISPENSING                                                   │
│     LCD: "PUMPING..."                                            │
│          "25.5 / 50.0 L"                                         │
│     Pump: ON (relay activated)                                   │
│     Flow sensor: Counting pulses                                 │
│                                                                  │
│              │                                                   │
│              ▼ Target reached OR Press '*'                       │
│                                                                  │
│  7. SALE COMPLETE                                                │
│     LCD: "DONE! 50.0L"                                           │
│          "K1,250.00"                                             │
│     Pump: OFF                                                    │
│     Transaction sent to cloud                                    │
│                                                                  │
│              │                                                   │
│              ▼ Auto-logout after 3 seconds                       │
│                                                                  │
│  → Return to IDLE STATE                                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Key Functions

| Key | Function |
|-----|----------|
| `A` | Start login (enter PIN mode) |
| `0-9` | Enter numbers (PIN or liters) |
| `#` | Confirm/Submit |
| `*` | Cancel/Emergency Stop |
| `D` | Start dispensing |
| `B` | Backspace (delete last digit) |
| `C` | Clear all input |

### Data Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   ESP32     │────►│   CLOUD     │────►│  DATABASE   │
│   Device    │◄────│   API       │◄────│  (Postgres) │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │
       │                   ▼
       │            ┌─────────────┐
       │            │  DASHBOARD  │
       │            │  (Web App)  │
       │            └─────────────┘
       │                   │
       ▼                   ▼
  - Verify PIN        - View transactions
  - Send telemetry    - Manage operators
  - Record sales      - Set prices
  - Get prices        - View reports
```

---

## Setup Instructions

### Step 1: Hardware Assembly

1. **Mount components** on breadboard or PCB
2. **Connect wiring** according to diagram above
3. **Double-check** all connections before powering on
4. **Test continuity** with multimeter

### Step 2: Install Development Tools

```bash
# Install VS Code from website

# Install PlatformIO extension in VS Code

# Clone or download the project
git clone https://github.com/your-repo/fleet-oil-system.git
```

### Step 3: Configure Device

Edit the configuration in `esp32_oil_node.ino`:

```cpp
// Device identification
#define DEVICE_ID "OIL-0001"           // Unique device ID
#define API_KEY "your-api-key-here"    // From dashboard
#define API_BASE_URL "https://your-dashboard.vercel.app"
#define SITE_NAME "Your Site Name"

// WiFi credentials
const char* WIFI_SSID = "your-wifi-name";
const char* WIFI_PASS = "your-wifi-password";
```

### Step 4: Upload Firmware

1. Connect ESP32 via USB
2. Open project in VS Code
3. Click PlatformIO upload button (→)
4. Wait for "SUCCESS" message

### Step 5: Test the System

1. Power on the system
2. LCD should show "WAIT AUTH / Press A Login"
3. Press `A`, enter PIN `1234`, press `#`
4. Enter liters, press `#`
5. Press `D` to start pump
6. Press `*` to stop

---

## Configuration

### Relay Type

In `esp32_oil_node.ino`, set based on your relay:

```cpp
// For ACTIVE LOW relay (most common - LOW = relay ON)
static const bool PUMP_ACTIVE_HIGH = false;

// For ACTIVE HIGH relay (HIGH = relay ON)
static const bool PUMP_ACTIVE_HIGH = true;
```

### Flow Sensor Calibration

Adjust pulses per liter for your specific sensor:

```cpp
#define PULSES_PER_LITER 450  // YF-S201 default
// Calibrate by measuring actual volume vs counted pulses
```

### Offline Operators

Pre-configure operators for offline mode:

```cpp
#define OFFLINE_HASH_1 "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4"  // PIN: 1234
#define OFFLINE_NAME_1 "Operator 1"
```

Generate SHA256 hash: `echo -n "1234" | sha256sum`

---

## Troubleshooting

### Common Issues

| Problem | Possible Cause | Solution |
|---------|---------------|----------|
| LCD blank | Wrong I2C address | Try 0x27 or 0x3F |
| Keypad not working | Loose wires | Check GPIO connections |
| Some keys don't work | Row/column wire loose | Check specific GPIO |
| Relay always ON | Wrong PUMP_ACTIVE_HIGH | Change true/false |
| Relay clicks but pump off | Wiring on NO/COM wrong | Swap wires |
| Flow not counting | Sensor needs 5V | Connect to VIN not 3.3V |
| WiFi not connecting | Wrong credentials | Check SSID/password |
| Upload fails | Wrong COM port | Check device manager |

### LED Indicators (on relay module)

| State | Meaning |
|-------|---------|
| Power LED on, Signal LED off | Relay OFF (pump stopped) |
| Power LED on, Signal LED on | Relay ON (pump running) |
| Power LED off | No power to relay module |

### Serial Monitor Debug

Open serial monitor at 115200 baud to see debug messages:

```
[ESP32] Oil Dispenser Starting...
[PUMP] Relay initialized to OFF state
[WIFI] Connected!
[KEYPAD] Key accepted: 1
```

---

## Cloud Dashboard

### Features

- **Device Overview**: See all dispensers and their status
- **Transactions**: View all sales with operator, volume, amount
- **Operators**: Add/edit/deactivate operator PINs
- **Pricing**: Set selling and cost prices per liter
- **Reports**: Daily/weekly/monthly sales and profit reports
- **Analytics**: Usage trends and charts

### API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /api/device/verify-pin` | Verify operator PIN |
| `POST /api/ingest/receipt` | Record transaction |
| `POST /api/ingest/telemetry` | Send sensor data |
| `GET /api/device/config` | Get prices and settings |
| `GET /api/device/operators` | Sync operator list |

---

## Safety Features

1. **Watchdog Timer**: Auto-reset if system hangs
2. **Maximum Runtime**: Pump auto-stops after 10 minutes
3. **Emergency Stop**: Press `*` anytime to stop pump
4. **Tamper Detection**: Optional cabinet open sensor
5. **Offline Queueing**: Transactions saved if internet down
6. **PIN Security**: Hashed PINs, rate limiting

---

## License

This project is proprietary. For licensing inquiries, contact the developer.

---

## Support

For technical support or custom development:
- Email: [your-email]
- GitHub: [your-repo]

---

*Document Version: 1.0*
*Last Updated: January 2026*
