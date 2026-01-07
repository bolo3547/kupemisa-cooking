// In-memory rate limiter for device telemetry submissions
// In production with multiple instances, use Redis instead

interface RateLimitEntry {
  lastRequestTime: number;
  requestCount: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

// Cleanup old entries every 5 minutes (skip in tests to avoid open handles)
if (process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    const now = Date.now();
    const fiveMinutesAgo = now - CLEANUP_INTERVAL_MS;

    Array.from(rateLimitMap.entries()).forEach(([key, entry]) => {
      if (entry.lastRequestTime < fiveMinutesAgo) {
        rateLimitMap.delete(key);
      }
    });
  }, CLEANUP_INTERVAL_MS);
}

export function checkRateLimit(
  deviceId: string,
  minIntervalMs?: number
): { allowed: boolean; waitMs: number } {
  const defaultIntervalMs = parseInt(process.env.DEVICE_RATE_LIMIT_MS || '2000', 10);
  const intervalMs = Number.isFinite(minIntervalMs) ? minIntervalMs! : defaultIntervalMs;
  const now = Date.now();
  
  const entry = rateLimitMap.get(deviceId);
  
  if (!entry) {
    rateLimitMap.set(deviceId, { lastRequestTime: now, requestCount: 1 });
    return { allowed: true, waitMs: 0 };
  }
  
  const elapsed = now - entry.lastRequestTime;
  
  if (elapsed < intervalMs) {
    return { allowed: false, waitMs: intervalMs - elapsed };
  }
  
  entry.lastRequestTime = now;
  entry.requestCount++;
  return { allowed: true, waitMs: 0 };
}

export function getRateLimitStats(): { totalDevices: number; entries: Array<{ deviceId: string; lastSeen: Date; requests: number }> } {
  const entries = Array.from(rateLimitMap.entries()).map(([deviceId, entry]) => ({
    deviceId,
    lastSeen: new Date(entry.lastRequestTime),
    requests: entry.requestCount,
  }));
  
  return {
    totalDevices: entries.length,
    entries,
  };
}
