import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';

// Device is considered offline if not seen in 2 minutes
const OFFLINE_THRESHOLD_MS = 2 * 60 * 1000;

export async function GET(
  request: NextRequest,
  { params }: { params: { deviceId: string } }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { deviceId } = params;

    // Get device with latest telemetry, events, and commands
    const device = await prisma.device.findUnique({
      where: { deviceId },
      include: {
        telemetry: {
          orderBy: { ts: 'desc' },
          take: 1,
        },
        events: {
          orderBy: { ts: 'desc' },
          take: 20,
        },
        commands: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: {
            createdBy: {
              select: { email: true },
            },
            acks: true,
          },
        },
        alertRules: true,
      },
    });

    if (!device) {
      return NextResponse.json({ error: 'Device not found' }, { status: 404 });
    }

    // Determine if device is online based on lastSeenAt
    const now = Date.now();
    const lastSeen = device.lastSeenAt ? new Date(device.lastSeenAt).getTime() : 0;
    const isOnline = (now - lastSeen) < OFFLINE_THRESHOLD_MS;
    
    // Override status to OFFLINE if not seen recently
    const effectiveStatus = isOnline ? device.status : 'OFFLINE';

    // Transform BigInt to Number for JSON serialization
    const result = {
      ...device,
      status: effectiveStatus,
      isOnline,
      telemetry: device.telemetry.map((t) => ({
        ...t,
        ts: Number(t.ts),
      })),
      events: device.events.map((e) => ({
        ...e,
        ts: Number(e.ts),
      })),
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching device:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
