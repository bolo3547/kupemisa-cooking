# LCD Display Message Feature

## Overview
New feature to send temporary messages to ESP32 device LCD displays (16x2 characters).

## Database Changes

### New Table: DeviceDisplayMessage
```sql
CREATE TABLE "DeviceDisplayMessage" (
    "id" TEXT PRIMARY KEY,
    "deviceId" TEXT UNIQUE NOT NULL,
    "line0" TEXT NOT NULL,       -- Max 16 chars
    "line1" TEXT NOT NULL,       -- Max 16 chars
    "expiresAt" TIMESTAMP NOT NULL,
    "createdAt" TIMESTAMP DEFAULT NOW(),
    "updatedAt" TIMESTAMP
);
```

## API Endpoints

### GET /api/device/config (Updated)
**Response now includes optional `display` field:**

```json
{
  "ok": true,
  "deviceId": "OIL-0001",
  "siteName": "PHI",
  "price": {
    "pricePerLiter": 25.50,
    "costPerLiter": 20.00,
    "currency": "ZMW"
  },
  "display": {
    "line0": "WELCOME",
    "line1": "Have a nice day!",
    "ttlSec": 45
  },
  "timestamp": 1736470800000
}
```

**Rules:**
- `display` only appears if message exists and hasn't expired
- Lines are truncated to 16 characters server-side
- `ttlSec` is remaining time in seconds

### POST /api/device/display (New)
**Set or update LCD display message**

**Headers:**
```
x-device-id: OIL-0001
x-api-key: your-api-key
Content-Type: application/json
```

**Request Body:**
```json
{
  "line0": "WELCOME",
  "line1": "Have a nice day!",
  "ttlSec": 60
}
```

**Response:**
```json
{
  "ok": true,
  "message": "Display message set",
  "expiresAt": "2026-01-09T12:34:56.789Z"
}
```

**To clear message, set `ttlSec: 0`**

### DELETE /api/device/display (New)
**Clear LCD display message**

**Headers:**
```
x-device-id: OIL-0001
x-api-key: your-api-key
```

**Response:**
```json
{
  "ok": true,
  "message": "Display message cleared"
}
```

## ESP32 Integration

### C++ Code Changes Needed

Add to `fetchPriceFromDashboard()` function:

```cpp
bool fetchPriceFromDashboard() {
  String response;
  if (!httpGetJson("/api/device/config", response)) {
    return false;
  }
  
  StaticJsonDocument<768> doc;  // Increased from 512 for display field
  DeserializationError err = deserializeJson(doc, response);
  if (err) {
    return false;
  }
  
  bool ok = doc["ok"] | false;
  if (!ok) {
    return false;
  }
  
  // Existing price parsing
  price.sell = doc["price"]["pricePerLiter"] | price.sell;
  price.cost = doc["price"]["costPerLiter"] | price.cost;
  String cur = doc["price"]["currency"] | "ZMW";
  cur.toCharArray(price.currency, sizeof(price.currency));
  
  // NEW: Check for display message
  if (doc.containsKey("display")) {
    String line0 = doc["display"]["line0"] | "";
    String line1 = doc["display"]["line1"] | "";
    int ttlSec = doc["display"]["ttlSec"] | 0;
    
    if (ttlSec > 0 && line0.length() > 0) {
      // Show custom message on LCD
      lcdClear();
      lcdPrint(0, 0, line0);
      lcdPrint(0, 1, line1);
      // Store message + expiry time for display during IDLE
    }
  }
  
  savePricing();
  return true;
}
```

## UI Component

New React component: `<LcdDisplayControl />`

**Usage in device details page:**
```tsx
import { LcdDisplayControl } from "@/components/lcd-display-control";

// In your page component
<LcdDisplayControl deviceId="OIL-0001" apiKey={deviceApiKey} />
```

**Features:**
- Live preview of LCD display
- Character counter (16 char limit per line)
- Duration selector (1-3600 seconds)
- Clear button
- Toast notifications

## Migration Steps

1. **Apply database migration:**
```bash
cd cloud/web
npx prisma migrate dev --name add_lcd_display
npx prisma generate
```

2. **Deploy to Vercel:**
```bash
git add .
git commit -m "feat: Add LCD display message feature"
git push origin main
```

3. **Update ESP32 firmware:**
- Increase `StaticJsonDocument` size in `fetchPriceFromDashboard()` to 768
- Add display message parsing code
- Store message with expiry timestamp
- Show message during IDLE state until expired

## Testing

### Test with curl:
```bash
# Set message
curl -X POST https://fleet-oil-system.vercel.app/api/device/display \
  -H "Content-Type: application/json" \
  -H "x-device-id: OIL-0001" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{"line0":"HELLO WORLD","line1":"Testing 123","ttlSec":60}'

# Check config (message should appear)
curl https://fleet-oil-system.vercel.app/api/device/config \
  -H "x-device-id: OIL-0001" \
  -H "x-api-key: YOUR_API_KEY"

# Clear message
curl -X DELETE https://fleet-oil-system.vercel.app/api/device/display \
  -H "x-device-id: OIL-0001" \
  -H "x-api-key: YOUR_API_KEY"
```

## Admin Usage

1. Navigate to device details page in dashboard
2. Find "LCD Display Message" card
3. Enter two lines of text (max 16 chars each)
4. Set duration in seconds
5. Click "Set Message"
6. ESP32 will receive message on next `/api/device/config` poll
7. Message expires automatically after TTL

## Security Notes

- Requires valid device authentication (x-device-id + x-api-key)
- Messages auto-expire (no manual cleanup needed)
- Lines truncated server-side (SQL injection safe)
- Rate limiting applies via existing device auth

## Future Enhancements

- Message queue (multiple messages)
- Priority/urgency levels
- Template library (common messages)
- Message history/audit log
- Broadcast to all devices
