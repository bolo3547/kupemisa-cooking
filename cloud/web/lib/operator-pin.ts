import crypto from 'crypto';

// Keep in sync with OPERATOR_PIN_HASH_SALT in esp32_oil_node.ino
const DEVICE_PIN_HASH_SALT = 'FLEET_OIL_PIN_V1';

export function hashOperatorPinForDevice(pin: string): string {
  return crypto
    .createHash('sha256')
    .update(`${DEVICE_PIN_HASH_SALT}:${pin}`)
    .digest('hex');
}
