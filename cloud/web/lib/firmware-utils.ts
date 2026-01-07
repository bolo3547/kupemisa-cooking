/**
 * Firmware provisioning utilities
 * Generates Arduino snippets and provisioning JSON for ESP32 devices
 */

export interface ProvisioningData {
  deviceId: string;
  siteName: string;
  apiBaseUrl: string;
  apiKey: string;
}

/**
 * Generate Arduino #define snippet for manual firmware configuration
 */
export function generateArduinoSnippet(data: ProvisioningData): string {
  return `// ═══════════════════════════════════════════════════════════════════════════
// ✅ PASTE THIS IN THE "USER CONFIG" SECTION AT THE TOP OF THE FIRMWARE FILE
// ⚠️  DO NOT paste anywhere else — the code will not compile correctly!
// ═══════════════════════════════════════════════════════════════════════════

#define DEVICE_ID     "${data.deviceId}"
#define API_KEY       "${data.apiKey}"
#define API_BASE_URL  "${data.apiBaseUrl}"
#define SITE_NAME     "${data.siteName}"

// ═══════════════════════════════════════════════════════════════════════════`;
}

/**
 * Generate provisioning JSON for ESP32 AP portal
 */
export function generateProvisioningJson(data: ProvisioningData): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Generate compact provisioning JSON (for QR code)
 */
export function generateProvisioningJsonCompact(data: ProvisioningData): string {
  return JSON.stringify(data);
}

/**
 * Generate downloadable instructions text file
 */
export function generateInstructionsFile(data: ProvisioningData): string {
  const arduinoSnippet = generateArduinoSnippet(data);
  const provisioningJson = generateProvisioningJson(data);

  return `════════════════════════════════════════════════════════════════════════════════
                    FLEET OIL MONITORING SYSTEM
                    ESP32 DEVICE PROVISIONING
════════════════════════════════════════════════════════════════════════════════

Device ID:    ${data.deviceId}
Site Name:    ${data.siteName}
API Base URL: ${data.apiBaseUrl}
API Key:      ${data.apiKey}

⚠️  IMPORTANT: Save this file securely! The API Key is shown ONLY ONCE.

════════════════════════════════════════════════════════════════════════════════
                    METHOD A: ESP32 PROVISIONING PORTAL (Recommended)
════════════════════════════════════════════════════════════════════════════════

1. Flash the ESP32 with the firmware (esp32_oil_node.ino)
2. Power on the ESP32 — it will create a WiFi access point
3. Connect your phone/laptop to:
   • SSID:     oil-system
   • Password: 12345678
4. Open a browser and go to: http://192.168.4.1
5. Paste this JSON into the "Device Config" field:

${provisioningJson}

6. Enter your WiFi network name and password
7. Click "Save" — the device will reboot and connect

════════════════════════════════════════════════════════════════════════════════
                    METHOD B: ARDUINO IDE / MANUAL CONFIG
════════════════════════════════════════════════════════════════════════════════

Open the firmware file (esp32_oil_node.ino) in Arduino IDE.
Find the "USER CONFIG" section at the TOP of the file.
Replace the placeholder values with this snippet:

${arduinoSnippet}

Then:
1. Set your WiFi credentials below the device config
2. Upload the firmware to your ESP32
3. The device will connect automatically

════════════════════════════════════════════════════════════════════════════════
                    VERIFICATION
════════════════════════════════════════════════════════════════════════════════

After setup, verify your device is online:
• Check the dashboard for device status: "Online" / "OK"
• The ESP32's built-in LED should be solid (not blinking)
• Telemetry data should appear within 30 seconds

If issues occur:
• Check Serial Monitor at 115200 baud for debug info
• Ensure your WiFi credentials are correct
• Verify the API Base URL is reachable from the device's network

════════════════════════════════════════════════════════════════════════════════
                    Generated: ${new Date().toISOString()}
════════════════════════════════════════════════════════════════════════════════
`;
}

/**
 * Trigger file download in browser
 */
export function downloadTextFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
