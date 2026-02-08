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

- **PIN Protection**: Password-protected access prevents unauthorized use
- **Operator Login**: PIN-based authentication via keypad
- **Preset Dispensing**: Enter target liters, system auto-stops
- **Flow Measurement**: Accurate volume tracking with calibrated flow sensor (263 PPL)
- **Sales Recording**: Persistent transaction counter and revenue totals (survives reboot)
- **Money Entry**: Dispense by Kwacha amount, liters, or milliliters
- **Transaction Recording**: All sales sent to cloud dashboard
- **Offline Support**: Works without internet, syncs when connected
- **Safety Features**: No-flow protection, over-dispense safety, emergency stop
- **Calibration Menu**: In-field calibration via keypad (hold * for 3s)

---

## Hardware Requirements

### Main Components

| Component | Specification | Purpose | Estimated Cost |
|-----------|--------------|---------|----------------|
| ESP32 Dev Board | ESP32-WROOM-32D | Main controller (WiFi + BT) | $5-10 |
| 16x2 LCD Display | I2C (PCF8574) | User interface | $3-5 |
| 4x4 Matrix Keypad | Membrane type | Input (PIN, liters, Kwacha) | $2-3 |
| Flow Sensor | AICHI OF05ZAT or YF-S201 | Measure oil volume | $5-10 |
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
│  1. LOCKED STATE                                                 │
│     LCD: "OIL DISPENSER"                                         │
│          "A = Login"                                             │
│     Pump: OFF, keypad locked                                     │
│                                                                  │
│              │                                                   │
│              ▼ Press 'A'                                         │
│                                                                  │
│  2. ENTER PIN                                                    │
│     LCD: "Enter PIN:"                                            │
│          "****_ #=OK *=Back"                                     │
│     Keys: 0-9 to enter, # to confirm, * to cancel               │
│     B = backspace, max 3 wrong attempts → 30s lockout            │
│                                                                  │
│              │                                                   │
│              ▼ Press '#' (PIN correct)                           │
│                                                                  │
│  3. SELECT AMOUNT (IDLE STATE)                                   │
│     LCD: "A=5L B=10 C=20"                                        │
│          "#=ENTER K  D=50L"                                      │
│     Presets: A=5L, B=10L, C=20L, D=50L                           │
│     Custom: # then enter K/L/mL, press D to cycle modes          │
│                                                                  │
│              │                                                   │
│              ▼ Select amount                                     │
│                                                                  │
│  4. DISPENSING                                                   │
│     LCD: "T5.00L D2.345L"                                        │
│          "1.5L/m *=STOP"                                         │
│     Pump: ON (relay activated)                                   │
│     Flow sensor: Counting pulses                                 │
│                                                                  │
│              │                                                   │
│              ▼ Target reached OR Press '*' to pause              │
│                                                                  │
│  5. SALE COMPLETE                                                │
│     LCD: "DONE! TX#42"                                           │
│          "K225 5.00L"                                            │
│     Pump: OFF                                                    │
│     Transaction recorded to NVS (persistent)                     │
│                                                                  │
│              │                                                   │
│              ▼ Press any key                                     │
│                                                                  │
│  → Return to LOCKED STATE (PIN required again)                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Key Functions

| Key | Function |
|-----|----------|
| `A` | Login (from locked screen) / Preset 5L (from idle) |
| `0-9` | Enter numbers (PIN, Kwacha, liters, mL) |
| `#` | Confirm/Submit |
| `*` | Cancel/Back/Emergency Stop (pause during dispense) |
| `D` | Preset 50L (from idle) / Cycle entry mode K→L→mL (custom entry) |
| `B` | Backspace (delete last digit) |
| `C` | Preset 20L (from idle) |

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
2. LCD should show "OIL DISPENSER / A = Login"
3. Press `A` to enter PIN mode
4. Enter PIN `1234` (default), press `#`
5. LCD shows "PIN OK! Welcome" then dispense menu
6. Select amount: press `A` for 5L, or `#` then enter custom Kwacha amount
7. System dispenses and auto-stops at target
8. LCD shows "DONE! TX#1" with amount — press any key to return to locked screen

### Serial Monitor Commands

Open serial monitor at 115200 baud:
- `s` = Status (current state, flow, calibration, sales totals)
- `t` = Sales report (transaction count, total liters, total revenue)
- `r` = Reset (stop pump, return to locked state)
- `d` = Reset calibration to defaults
- `h` = Help

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

The default calibration is 263 pulses per liter (empirically calibrated for OF05ZAT sensor).
Use the built-in calibration menu (hold `*` for 3 seconds from idle screen):

1. Press `1` then `#` to dispense exactly 1L
2. Measure the real volume dispensed in mL
3. Enter the real mL value, press `#`
4. New PPL is automatically calculated and saved to NVS

```cpp
// In src/main.cpp — default value (auto-adjusted by calibration menu)
static const float DEFAULT_PPL = 263.0f;  // corrected for 100% accuracy
```

### PIN Configuration

Change the default operator PIN in `src/main.cpp`:

```cpp
static const char* OPERATOR_PIN = "1234";  // change for your site
```

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
