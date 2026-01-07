import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { getSession } from '@/lib/auth';
import { provisionDeviceSchema } from '@/lib/validations';
import { UserRole, Prisma } from '@prisma/client';

function generateApiKey(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Buffer.from(array).toString('base64url');
}

async function generateDeviceIdWithTransaction(
  siteName: string,
  location: string | undefined,
  notes: string | undefined,
  apiKeyHash: string,
  ownerId: string
): Promise<{ deviceId: string; device: any }> {
  // Race-safe device creation with retry on unique constraint violation
  const MAX_RETRIES = 10;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // Use a transaction to ensure atomicity
      const result = await prisma.$transaction(async (tx) => {
        // Get the highest existing device ID
        const lastDevice = await tx.device.findFirst({
          orderBy: { deviceId: 'desc' },
          select: { deviceId: true },
        });

        let nextNumber = 1;
        if (lastDevice?.deviceId) {
          const match = lastDevice.deviceId.match(/OIL-(\d+)/);
          if (match) {
            nextNumber = parseInt(match[1], 10) + 1;
          }
        }

        const newDeviceId = `OIL-${String(nextNumber).padStart(4, '0')}`;

        // Create the device - will fail if deviceId already exists (unique constraint)
        const device = await tx.device.create({
          data: {
            deviceId: newDeviceId,
            siteName,
            location,
            notes,
            apiKeyHash,
            ownerId,
            status: 'OFFLINE',
          },
        });

        return { deviceId: newDeviceId, device };
      });

      return result;
    } catch (error) {
      // Check if it's a unique constraint violation (P2002)
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        console.log(`Device ID collision on attempt ${attempt + 1}, retrying...`);
        continue; // Retry with next number
      }
      throw error; // Re-throw other errors
    }
  }

  throw new Error(`Failed to generate unique device ID after ${MAX_RETRIES} attempts`);
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.user.role !== UserRole.OWNER) {
      return NextResponse.json(
        { error: 'Unauthorized: Owner access required' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const validation = provisionDeviceSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid payload', details: validation.error.issues },
        { status: 400 }
      );
    }

    const { siteName, location, notes } = validation.data;

    // Generate API key and hash it
    const apiKey = generateApiKey();
    const apiKeyHash = await bcrypt.hash(apiKey, 12);

    // Create device with race-safe transaction
    const { deviceId, device } = await generateDeviceIdWithTransaction(
      siteName,
      location,
      notes,
      apiKeyHash,
      session.user.id
    );

    // Return the device info with the plain API key (only time it's shown)
    const appBaseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';

    return NextResponse.json({
      ok: true,
      device: {
        id: device.id,
        deviceId: device.deviceId,
        siteName: device.siteName,
        location: device.location,
        status: device.status,
        createdAt: device.createdAt,
      },
      provisioning: {
        deviceId: device.deviceId,
        siteName: device.siteName,
        apiBaseUrl: appBaseUrl,
        apiKey, // Only shown once! Store securely!
      },
    });
  } catch (error) {
    console.error('Error provisioning device:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
