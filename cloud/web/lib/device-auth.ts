import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';

export async function verifyDeviceAuth(
  deviceId: string | null,
  apiKey: string | null
): Promise<{ valid: boolean; device?: { deviceId: string; siteName: string; id: string; ownerId: string | null } }> {
  if (!deviceId || !apiKey) {
    return { valid: false };
  }

  try {
    const device = await prisma.device.findUnique({
      where: { deviceId },
      select: {
        id: true,
        deviceId: true,
        siteName: true,
        apiKeyHash: true,
        ownerId: true,
      },
    });

    if (!device) {
      return { valid: false };
    }

    const isValid = await bcrypt.compare(apiKey, device.apiKeyHash);

    if (!isValid) {
      return { valid: false };
    }

    return {
      valid: true,
      device: {
        id: device.id,
        deviceId: device.deviceId,
        siteName: device.siteName,
        ownerId: device.ownerId ?? null,
      },
    };
  } catch (error) {
    console.error('Device auth error:', error);
    return { valid: false };
  }
}
