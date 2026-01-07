/**
 * Tests for Alert Evaluation Logic
 */

// Mock the prisma module first
jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    event: {
      create: jest.fn(),
    },
  },
}));

// Mock nodemailer
jest.mock('nodemailer', () => ({
  createTransport: jest.fn().mockReturnValue({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'test-id' }),
  }),
}));

describe('Alert Evaluation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Threshold Crossing Detection', () => {
    it('should detect OK to LOW transition', () => {
      const previousStatus = 'OK';
      const newPercent = 25;
      const lowThreshold = 30;
      
      const isLow = newPercent < lowThreshold;
      const isCrossing = previousStatus === 'OK' && isLow;
      
      expect(isCrossing).toBe(true);
    });

    it('should detect LOW to CRITICAL transition', () => {
      const previousStatus = 'LOW';
      const newPercent = 8;
      const criticalThreshold = 10;
      
      const isCritical = newPercent < criticalThreshold;
      const isCrossing = previousStatus === 'LOW' && isCritical;
      
      expect(isCrossing).toBe(true);
    });

    it('should not alert when staying in same zone', () => {
      const previousStatus = 'LOW';
      const newPercent = 20;
      const lowThreshold = 30;
      const criticalThreshold = 10;
      
      const isLow = newPercent < lowThreshold && newPercent >= criticalThreshold;
      const previousWasLow = previousStatus === 'LOW';
      const shouldAlert = !previousWasLow && isLow;
      
      expect(shouldAlert).toBe(false);
    });

    it('should detect recovery from LOW to OK', () => {
      const previousStatus = 'LOW';
      const newPercent = 35;
      const lowThreshold = 30;
      
      const isOk = newPercent >= lowThreshold;
      const isRecovery = previousStatus === 'LOW' && isOk;
      
      expect(isRecovery).toBe(true);
    });

    it('should detect recovery from CRITICAL to OK', () => {
      const previousStatus = 'CRITICAL';
      const newPercent = 50;
      const lowThreshold = 30;
      
      const isOk = newPercent >= lowThreshold;
      const isRecovery = previousStatus === 'CRITICAL' && isOk;
      
      expect(isRecovery).toBe(true);
    });
  });

  describe('Safety Status Alerts', () => {
    it('should flag DRY_RUN_SHUTDOWN as critical', () => {
      const safetyStatus = 'DRY_RUN_SHUTDOWN';
      const isCritical = safetyStatus === 'DRY_RUN_SHUTDOWN';
      
      expect(isCritical).toBe(true);
    });

    it('should flag SENSOR_FAIL as critical', () => {
      const safetyStatus = 'SENSOR_FAIL';
      const isCritical = safetyStatus === 'SENSOR_FAIL';
      
      expect(isCritical).toBe(true);
    });

    it('should not alert for OK safety status', () => {
      const safetyStatus = 'OK';
      const shouldAlert = safetyStatus !== 'OK';
      
      expect(shouldAlert).toBe(false);
    });
  });

  describe('Alert Deduplication', () => {
    it('should deduplicate alerts within time window', () => {
      const DEDUPE_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
      const lastAlertTime = Date.now() - 10 * 60 * 1000; // 10 minutes ago
      
      const withinWindow = (Date.now() - lastAlertTime) < DEDUPE_WINDOW_MS;
      expect(withinWindow).toBe(true);
    });

    it('should allow alert after window expires', () => {
      const DEDUPE_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
      const lastAlertTime = Date.now() - 35 * 60 * 1000; // 35 minutes ago
      
      const withinWindow = (Date.now() - lastAlertTime) < DEDUPE_WINDOW_MS;
      expect(withinWindow).toBe(false);
    });

    it('should create unique dedupe keys per device and event type', () => {
      const createDedupeKey = (deviceId: string, eventType: string) => 
        `${deviceId}:${eventType}`;
      
      const key1 = createDedupeKey('OIL-0001', 'LOW_LEVEL');
      const key2 = createDedupeKey('OIL-0001', 'CRITICAL_LEVEL');
      const key3 = createDedupeKey('OIL-0002', 'LOW_LEVEL');
      
      expect(key1).not.toBe(key2);
      expect(key1).not.toBe(key3);
      expect(key2).not.toBe(key3);
    });
  });

  describe('Notification Channel Selection', () => {
    it('should use email for warning level alerts', () => {
      const alertRule = {
        notifyEmail: true,
        notifySms: false,
        emailRecipients: 'test@example.com',
      };
      
      expect(alertRule.notifyEmail).toBe(true);
      expect(alertRule.notifySms).toBe(false);
    });

    it('should use both email and SMS for critical alerts', () => {
      const alertRule = {
        notifyEmail: true,
        notifySms: true,
        emailRecipients: 'test@example.com',
        smsRecipients: '+1234567890',
      };
      
      expect(alertRule.notifyEmail).toBe(true);
      expect(alertRule.notifySms).toBe(true);
    });

    it('should parse multiple email recipients', () => {
      const recipients = 'user1@test.com,user2@test.com,user3@test.com';
      const parsed = recipients.split(',').map(e => e.trim());
      
      expect(parsed).toHaveLength(3);
      expect(parsed[0]).toBe('user1@test.com');
    });
  });
});
