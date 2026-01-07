#!/usr/bin/env bash
# Simple helper to compile the esp32 headless build locally using arduino-cli
set -euo pipefail

echo "Updating Arduino CLI core index..."
arduino-cli core update-index

echo "Installing esp32 core (if not already installed)..."
arduino-cli core install esp32:esp32 || true

echo "Compiling sketch with DISABLE_DISPLAY defined (headless)..."
arduino-cli compile --fqbn esp32:esp32:esp32 --build-property compiler.cpp.extra_flags=-DDISABLE_DISPLAY --build-property compiler.c.extra_flags=-DDISABLE_DISPLAY firmware/esp32_oil_node

echo "Done."