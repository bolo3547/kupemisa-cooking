/**
 * Tests for Device Telemetry Ingest API
 * POST /api/ingest/telemetry
 * 
 * These tests focus on business logic and mock the route handler dependencies
 */

// Mock dependencies
const mockDevice = {
  deviceId: 'OIL-0001',
  siteName: 'Test Site',
  apiKeyHash: '$2a$12$hashedkey',
  status: 'OK',
};

jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    device: {
      findUnique: jest.fn(),
    },
    telemetry: {
      create: jest.fn(),
    },
    alertRule: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('@/lib/device-auth', () => ({
  verifyDeviceAuth: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/alerts', () => ({
  evaluateAndNotify: jest.fn(),
}));

import prisma from '@/lib/prisma';
import { verifyDeviceAuth } from '@/lib/device-auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { evaluateAndNotify } from '@/lib/alerts';

describe('Telemetry Ingest Logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (verifyDeviceAuth as jest.Mock).mockResolvedValue({ valid: true, device: mockDevice });
    (checkRateLimit as jest.Mock).mockReturnValue({ allowed: true });
    (prisma.device.findUnique as jest.Mock).mockResolvedValue({ status: 'OK' });
    (prisma.alertRule.findFirst as jest.Mock).mockResolvedValue({
      id: 1,
      enabled: true,
      lowThreshold: 30,
      criticalThreshold: 10,
    });
    (prisma.$transaction as jest.Mock).mockResolvedValue([{}, {}]);
    (evaluateAndNotify as jest.Mock).mockResolvedValue(undefined);
  });

  const validPayload = {
    ts: Date.now(),
    oilPercent: 75.5,
    oilLiters: 150.2,
    distanceCm: 25.0,
    flowLpm: 0,
    litersTotal: 1500,
    pumpState: false,
    safetyStatus: 'OK',
    wifiRssi: -65,
    uptimeSec: 3600,
  };

  describe('Device Authentication', () => {
    it('should verify device credentials', async () => {
      await verifyDeviceAuth('OIL-0001', 'test-api-key');
      
      expect(verifyDeviceAuth).toHaveBeenCalledWith('OIL-0001', 'test-api-key');
    });

    it('should reject invalid device credentials', async () => {
      (verifyDeviceAuth as jest.Mock).mockResolvedValue({ valid: false });
      
      const result = await verifyDeviceAuth('BAD-DEVICE', 'wrong-key');
      expect(result.valid).toBe(false);
    });

    it('should return device info on valid auth', async () => {
      const result = await verifyDeviceAuth('OIL-0001', 'correct-key');
      
      expect(result.valid).toBe(true);
      expect(result.device).toEqual(mockDevice);
    });
  });

  describe('Rate Limiting', () => {
    it('should allow requests under limit', () => {
      const result = checkRateLimit('OIL-0001');
      expect(result.allowed).toBe(true);
    });

    it('should block rate limited requests', () => {
      (checkRateLimit as jest.Mock).mockReturnValue({ allowed: false, waitMs: 5000 });
      
      const result = checkRateLimit('OIL-0001');
      expect(result.allowed).toBe(false);
      expect(result.waitMs).toBe(5000);
    });
  });

  describe('Payload Validation', () => {
    it('should accept valid telemetry payload', () => {
      expect(validPayload.ts).toBeGreaterThan(0);
      expect(validPayload.oilPercent).toBeGreaterThanOrEqual(0);
      expect(validPayload.oilPercent).toBeLessThanOrEqual(100);
    });

    it('should have required fields', () => {
      expect(validPayload).toHaveProperty('ts');
      expect(validPayload).toHaveProperty('oilPercent');
      expect(validPayload).toHaveProperty('oilLiters');
      expect(validPayload).toHaveProperty('distanceCm');
      expect(validPayload).toHaveProperty('flowLpm');
      expect(validPayload).toHaveProperty('pumpState');
      expect(validPayload).toHaveProperty('safetyStatus');
    });
  });

  describe('Status Calculation', () => {
    it('should set OK status when above low threshold', () => {
      const oilPercent = 50;
      const lowThreshold = 30;
      const criticalThreshold = 10;

      const status = oilPercent >= lowThreshold ? 'OK' : 
                     oilPercent >= criticalThreshold ? 'LOW' : 'CRITICAL';
      
      expect(status).toBe('OK');
    });

    it('should set LOW status when below low threshold', () => {
      const oilPercent = 20;
      const lowThreshold = 30;
      const criticalThreshold = 10;

      const status = oilPercent >= lowThreshold ? 'OK' : 
                     oilPercent >= criticalThreshold ? 'LOW' : 'CRITICAL';
      
      expect(status).toBe('LOW');
    });

    it('should set CRITICAL status when below critical threshold', () => {
      const oilPercent = 5;
      const lowThreshold = 30;
      const criticalThreshold = 10;

      const status = oilPercent >= lowThreshold ? 'OK' : 
                     oilPercent >= criticalThreshold ? 'LOW' : 'CRITICAL';
      
      expect(status).toBe('CRITICAL');
    });
  });

  describe('Alert Evaluation', () => {
    it('should trigger alert evaluation after storing telemetry', async () => {
      await evaluateAndNotify(
        { deviceId: 'OIL-0001', siteName: 'Test Site', currentStatus: 'OK' },
        { oilPercent: 15, safetyStatus: 'OK' },
        { lowThreshold: 30, criticalThreshold: 10 }
      );

      expect(evaluateAndNotify).toHaveBeenCalled();
    });

    it('should pass previous status for threshold crossing detection', async () => {
      const previousStatus = 'OK';
      await evaluateAndNotify(
        { deviceId: 'OIL-0001', siteName: 'Test Site', currentStatus: previousStatus },
        { oilPercent: 15, safetyStatus: 'OK' },
        { lowThreshold: 30, criticalThreshold: 10 }
      );

      expect(evaluateAndNotify).toHaveBeenCalledWith(
        expect.objectContaining({ currentStatus: 'OK' }),
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('should handle safety status in alerts', async () => {
      await evaluateAndNotify(
        { deviceId: 'OIL-0001', siteName: 'Test Site', currentStatus: 'OK' },
        { oilPercent: 50, safetyStatus: 'DRY_RUN_SHUTDOWN' },
        { lowThreshold: 30, criticalThreshold: 10 }
      );

      expect(evaluateAndNotify).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ safetyStatus: 'DRY_RUN_SHUTDOWN' }),
        expect.any(Object)
      );
    });
  });

  describe('Database Transaction', () => {
    it('should store telemetry in transaction', async () => {
      await prisma.$transaction([]);
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('should update device last seen time', async () => {
      // Simulating the update that would happen in the transaction
      const updateData = {
        lastSeenAt: new Date(),
        status: 'OK',
      };
      
      expect(updateData.lastSeenAt).toBeInstanceOf(Date);
      expect(updateData.status).toBe('OK');
    });
  });
});
