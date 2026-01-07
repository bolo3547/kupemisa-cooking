import { checkRateLimit, getRateLimitStats } from '@/lib/rate-limit';

describe('Rate Limiting', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('allows the first request and blocks within the interval', () => {
    const key = 'rate-limit-test-1';
    const nowSpy = jest.spyOn(Date, 'now');

    nowSpy.mockReturnValue(1000);
    expect(checkRateLimit(key, 2000)).toEqual({ allowed: true, waitMs: 0 });

    nowSpy.mockReturnValue(1500);
    expect(checkRateLimit(key, 2000)).toEqual({ allowed: false, waitMs: 1500 });

    nowSpy.mockReturnValue(3000);
    expect(checkRateLimit(key, 2000)).toEqual({ allowed: true, waitMs: 0 });
  });

  it('uses custom minIntervalMs when provided', () => {
    const key = 'rate-limit-test-2';
    const nowSpy = jest.spyOn(Date, 'now');

    nowSpy.mockReturnValue(1000);
    expect(checkRateLimit(key, 1000)).toEqual({ allowed: true, waitMs: 0 });

    nowSpy.mockReturnValue(1500);
    expect(checkRateLimit(key, 1000)).toEqual({ allowed: false, waitMs: 500 });
  });

  it('tracks entries per key', () => {
    const key = 'rate-limit-test-3';
    checkRateLimit(key, 1000);

    const stats = getRateLimitStats();
    const entry = stats.entries.find((e) => e.deviceId === key);

    expect(entry).toBeDefined();
    expect(entry?.requests).toBeGreaterThan(0);
  });
});
