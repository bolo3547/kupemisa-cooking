/********************************************************************
 * ESP32 Oil Dispenser - PRODUCTION CONFIGURATION
 * 
 * Site: PHI
 * Device: OIL-0001
 * 
 * ⚠️  DO NOT SHARE THIS FILE - Contains sensitive credentials!
 * 
 * Operator PIN for testing: 1234
 ********************************************************************/

// ========================= DEVICE CREDENTIALS =========================
#define DEVICE_ID "OIL-0001"
#define API_KEY "QV-nQArRlomVfBOiL1Ob1P4mtIz88a7mO0c3kXVZYK8"
#define API_BASE_URL "https://fleet-oil-system.vercel.app"
#define SITE_NAME "PHI"

// ========================= WIFI CREDENTIALS =========================
// Update these for your WiFi network
const char* WIFI_SSID = "kupemisa";
const char* WIFI_PASS = "123admin";

// ========================= INCLUDE MAIN CODE =========================
// The rest of the code is in esp32_oil_node.ino
// Copy the credentials above into that file OR include it here

// Uncomment the line below if using as a separate config file:
// #include "esp32_oil_node.ino"
