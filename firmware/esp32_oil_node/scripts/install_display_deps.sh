#!/usr/bin/env bash
# Install required Arduino libs for display-enabled build (local use)
set -euo pipefail

echo "Updating Arduino CLI library index..."
arduino-cli lib update-index

echo "Installing required libraries..."
arduino-cli lib install "TFT_eSPI"
arduino-cli lib install "Keypad"
arduino-cli lib install "TJpg_Decoder"
arduino-cli lib install "PNGdec"
arduino-cli lib install "XPT2046_Touchscreen"
arduino-cli lib install "ArduinoJson"

echo "Done. You can now compile the full firmware with arduino-cli or in Arduino IDE."