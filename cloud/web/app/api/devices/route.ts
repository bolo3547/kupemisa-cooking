import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Device is considered offline if not seen in 2 minutes
const OFFLINE_THRESHOLD_MS = 2 * 60 * 1000;

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all devices with their latest telemetry
    const devices = await prisma.device.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        deviceId: true,
        siteName: true,
        location: true,
        status: true,
        lastSeenAt: true,
        createdAt: true,
        telemetry: {
          orderBy: { ts: 'desc' },
          take: 1,
          select: {
            oilPercent: true,
            oilLiters: true,
            flowLpm: true,
            pumpState: true,
            safetyStatus: true,
            wifiRssi: true,
            ts: true,
          },
        },
      },
    });

    const now = Date.now();

    // Transform the data for the frontend
    const result = devices.map((device) => {
      // Determine if device is online based on lastSeenAt
      const lastSeen = device.lastSeenAt ? new Date(device.lastSeenAt).getTime() : 0;
      const isOnline = (now - lastSeen) < OFFLINE_THRESHOLD_MS;
      
      // Override status to OFFLINE if not seen recently
      const effectiveStatus = isOnline ? device.status : 'OFFLINE';
      
      return {
        ...device,
        status: effectiveStatus,
        isOnline,
        latestTelemetry: device.telemetry[0]
          ? {
              ...device.telemetry[0],
              ts: Number(device.telemetry[0].ts),
            }
          : null,
        telemetry: undefined,
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching devices:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
