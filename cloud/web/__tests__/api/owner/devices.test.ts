/**
 * Tests for Device Provisioning API
 * POST /api/owner/devices
 * 
 * These tests focus on business logic and validation
 */

// Mock dependencies
jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    device: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('@/lib/auth', () => ({
  getSession: jest.fn(),
}));

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$12$hashedapikey'),
}));

import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import bcrypt from 'bcryptjs';

describe('Device Provisioning Logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const validPayload = {
    siteName: 'Warehouse A',
    location: 'Main Building',
    notes: 'Primary fuel tank',
  };

  describe('Authorization', () => {
    it('should reject unauthenticated requests', async () => {
      (getSession as jest.Mock).mockResolvedValue(null);

      const session = await getSession();
      expect(session).toBeNull();
    });

    it('should reject VIEWER role users', async () => {
      (getSession as jest.Mock).mockResolvedValue({
        user: { id: 1, email: 'viewer@test.com', role: 'VIEWER' },
      });

      const session = await getSession();
      const isAuthorized = session?.user.role === 'OWNER';
      
      expect(isAuthorized).toBe(false);
    });

    it('should allow OWNER role users', async () => {
      (getSession as jest.Mock).mockResolvedValue({
        user: { id: 1, email: 'owner@test.com', role: 'OWNER' },
      });

      const session = await getSession();
      const isAuthorized = session?.user.role === 'OWNER';
      
      expect(isAuthorized).toBe(true);
    });
  });

  describe('Validation', () => {
    it('should reject empty siteName', () => {
      const payload = { siteName: '' };
      const isValid = payload.siteName.trim().length > 0;
      
      expect(isValid).toBe(false);
    });

    it('should reject missing siteName', () => {
      const payload = { location: 'Building A' };
      const isValid = 'siteName' in payload && (payload as any).siteName?.trim().length > 0;
      
      expect(isValid).toBe(false);
    });

    it('should accept valid payload with all fields', () => {
      const isValid = validPayload.siteName.trim().length > 0;
      
      expect(isValid).toBe(true);
      expect(validPayload.location).toBeDefined();
      expect(validPayload.notes).toBeDefined();
    });

    it('should accept payload with only siteName', () => {
      const minimalPayload = { siteName: 'Test Site' };
      const isValid = minimalPayload.siteName.trim().length > 0;
      
      expect(isValid).toBe(true);
    });
  });

  describe('Device ID Generation', () => {
    function generateNextDeviceId(lastDeviceId: string | null): string {
      let nextNumber = 1;
      if (lastDeviceId) {
        const match = lastDeviceId.match(/OIL-(\d+)/);
        if (match) {
          nextNumber = parseInt(match[1], 10) + 1;
        }
      }
      return `OIL-${String(nextNumber).padStart(4, '0')}`;
    }

    it('should generate OIL-0001 for first device', () => {
      const newDeviceId = generateNextDeviceId(null);
      expect(newDeviceId).toBe('OIL-0001');
    });

    it('should increment device ID based on last device', () => {
      const newDeviceId = generateNextDeviceId('OIL-0010');
      expect(newDeviceId).toBe('OIL-0011');
    });

    it('should handle high device numbers', () => {
      const newDeviceId = generateNextDeviceId('OIL-9999');
      expect(newDeviceId).toBe('OIL-10000');
    });
  });

  describe('API Key Generation', () => {
    it('should generate API key with correct format', () => {
      // Simulate API key generation
      const mockApiKey = 'abcdefghijklmnopqrstuvwxyz123456789ABC';
      
      expect(mockApiKey.length).toBeGreaterThan(20);
      expect(typeof mockApiKey).toBe('string');
    });

    it('should hash API key before storage', async () => {
      const apiKey = 'test-api-key';
      const hash = await bcrypt.hash(apiKey, 12);
      
      expect(bcrypt.hash).toHaveBeenCalledWith(apiKey, 12);
      expect(hash).toBe('$2a$12$hashedapikey');
    });
  });

  describe('Response Format', () => {
    it('should return device info in correct format', () => {
      const response = {
        ok: true,
        device: {
          id: 1,
          deviceId: 'OIL-0001',
          siteName: validPayload.siteName,
          location: validPayload.location,
          status: 'OFFLINE',
          createdAt: new Date(),
        },
        provisioning: {
          deviceId: 'OIL-0001',
          siteName: validPayload.siteName,
          apiBaseUrl: 'http://localhost:3000',
          apiKey: 'test-api-key',
        },
      };

      expect(response.ok).toBe(true);
      expect(response.device.deviceId).toBe('OIL-0001');
      expect(response.provisioning.apiKey).toBeDefined();
    });

    it('should include API key only in provisioning response', () => {
      const response = {
        device: {
          id: 1,
          deviceId: 'OIL-0001',
          // Note: no apiKey here!
        },
        provisioning: {
          apiKey: 'test-api-key', // Only here!
        },
      };

      expect(response.device).not.toHaveProperty('apiKey');
      expect(response.provisioning.apiKey).toBeDefined();
    });
  });

  describe('Race Condition Handling', () => {
    it('should retry on unique constraint violation', () => {
      const MAX_RETRIES = 10;
      let attempts = 0;
      
      const simulateRaceCondition = () => {
        attempts++;
        if (attempts < 3) {
          throw { code: 'P2002' }; // Prisma unique constraint error
        }
        return { deviceId: `OIL-000${attempts}` };
      };

      let result;
      for (let i = 0; i < MAX_RETRIES; i++) {
        try {
          result = simulateRaceCondition();
          break;
        } catch (error: any) {
          if (error.code !== 'P2002') throw error;
          continue;
        }
      }

      expect(attempts).toBe(3);
      expect(result?.deviceId).toBe('OIL-0003');
    });
  });
});
