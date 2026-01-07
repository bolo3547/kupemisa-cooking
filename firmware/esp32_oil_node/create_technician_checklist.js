const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const out = path.join(__dirname, 'technician_checklist.pdf');
const doc = new PDFDocument({ size: 'A4', margin: 50 });

doc.pipe(fs.createWriteStream(out));

doc.fontSize(20).text('ESP32 Oil Node - Technician Checklist', { align: 'center' });
doc.moveDown();

doc.fontSize(12).text('Prepared: 2025-12-23');
doc.moveDown();

doc.fontSize(14).text('1) Visual & Wiring Checks', { underline: true });
doc.list([
  'Confirm common ground between ESP32, TFT, sensors, and relay.',
  'TFT VCC → 3.3V, TFT GND → GND, MOSI=GPIO23, SCK=GPIO18, CS=GPIO5, DC=GPIO2, RST=GPIO4.',
  'Flow sensor VCC → 5V, Signal → GPIO27, GND → GND.',
  'Pump relay IN → GPIO26, Relay VCC → 5V, Pump → 12V (fused).',
  'Ultrasonic TRIG/ECHO default GPIO18/19 (consider moving to 22/21 if conflict).'
]);

doc.moveDown();
doc.fontSize(14).text('2) Touchscreen & Display', { underline: true });
doc.list([
  'Confirm touchscreen wiring: CS → GPIO21 (or configured pin), GND, VCC.',
  'Power on device; verify TFT shows the home screen and status.',
  'On Admin page: Press "Calibrate Touch" (or long-press D) and follow prompts.',
  'Tap all calibration targets; verify captured raw values and saved message.'
]);

doc.moveDown();
doc.fontSize(14).text('3) Buzzer & Feedback (optional)', { underline: true });
doc.list([
  'If buzzer present, set BUZZER_PIN in firmware and enable TOUCH_FEEDBACK_BEEP.',
  'Verify beep on touch and on calibration steps.'
]);

doc.moveDown();
doc.fontSize(14).text('4) Flow Sensor Calibration', { underline: true });
doc.list([
  'From IDLE, press A to enter calibration mode.',
  'Press D to toggle pump and dispense a known volume (e.g., 1 L).',
  'Enter actual volume and press # to save pulses-per-liter.',
  'Verify reported pulses/liter is within expected range (400-500 for AICHI OF05ZAT).'
]);

doc.moveDown();
doc.fontSize(14).text('5) Functional Test', { underline: true });
doc.list([
  'Log in as operator (if required) and request a small dispense (1 L).',
  'Verify pump starts and stops at requested volume and receipt is displayed.',
  'Check cloud event (if online) for DISPENSE_DONE and PUMP_ON/PUMP_OFF events.'
]);

doc.moveDown();
doc.fontSize(12).text('Notes: Ensure fuses and flyback diodes are in place for the pump; test in safe controlled environment.');

doc.end();
console.log('Created:', out);