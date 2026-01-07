# Installing dependencies for ESP32 firmware

Follow these steps to resolve the `TFT_eSPI.h: No such file or directory` error and prepare your Arduino IDE to build the firmware.

1. Open Arduino IDE → Sketch → Include Library → Manage Libraries...
2. In the Library Manager search box, install:
   - **TFT_eSPI** (by Bodmer)
   - **Keypad** (by Mark Stanley)
   - **XPT2046_Touchscreen** (if you use touch)
   - **TJpg_Decoder** (optional, for JPEG wallpapers)
   - **PNGdec** (optional, for PNG wallpapers)
   - **ArduinoJson** (v6+)

3. After installing `TFT_eSPI`, edit its `User_Setup.h` file to match your display/pinout. See `TFT_SETUP.md` in this folder for recommended settings for ILI9488 (320×480) and ESP32.

   Typical edit path:
   - Windows: `C:/Users/<you>/Documents/Arduino/libraries/TFT_eSPI/User_Setup.h`

   Required defines (example):
   ```cpp
   #define ILI9488_DRIVER
   #define TFT_WIDTH 320
   #define TFT_HEIGHT 480
   #define TFT_MOSI 23
   #define TFT_SCLK 18
   #define TFT_CS   5
   #define TFT_DC   2
   #define TFT_RST  4
   // optional backlight pin: #define TFT_BL 15
   ```

4. Confirm Board and Core:
   - Tools → Board → select **ESP32 Dev Module** (or your target board)
   - Ensure ESP32 core is installed via Boards Manager (the project was developed with ESP32 core 3.x, newer cores usually work)

5. Optional: enable verbose compile/ upload in File → Preferences to see full error messages.

6. Build again. If you still see errors, run a quick check:
   - Open `sketchbook/libraries` and confirm `TFT_eSPI` folder exists.
   - Verify `User_Setup.h` is present and configured.

If you'd like, I can add a short note in the repo README or adjust the firmware to `#error` with a friendly message (I already added a compile-time check to produce a clear error if `TFT_eSPI` is missing).

## Headless / quick-compile option
If you don't want to install the `TFT_eSPI` and `Keypad` libraries right now, the firmware supports a **headless** build mode. Either:

- Uncomment `#define DISABLE_DISPLAY` at the top of `esp32_oil_node.ino` to force building without display/keypad support, or
- Leave the libraries uninstalled — the sketch will auto-detect missing libraries and define `DISABLE_DISPLAY` automatically, compiling with minimal stubs so you can test other subsystems (flow sensor, pump, telemetry, etc.).

Note: In `DISABLE_DISPLAY` mode the TFT and keypad functionality becomes no-op stubs (no UI) but core features like pump control, flow measurement and telemetry still work.