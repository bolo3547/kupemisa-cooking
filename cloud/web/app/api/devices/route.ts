import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';

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

    // Transform the data for the frontend
    const result = devices.map((device) => ({
      ...device,
      latestTelemetry: device.telemetry[0]
        ? {
            ...device.telemetry[0],
            ts: Number(device.telemetry[0].ts),
          }
        : null,
      telemetry: undefined,
    }));

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching devices:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
