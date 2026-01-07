import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';

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
    const { searchParams } = new URL(request.url);
    const range = searchParams.get('range') || '24h';

    // Calculate time range
    const now = Date.now();
    let startTime: number;
    switch (range) {
      case '7d':
        startTime = now - 7 * 24 * 60 * 60 * 1000;
        break;
      case '24h':
      default:
        startTime = now - 24 * 60 * 60 * 1000;
        break;
    }

    // Get telemetry data
    const telemetry = await prisma.telemetry.findMany({
      where: {
        deviceId,
        ts: {
          gte: BigInt(startTime),
        },
      },
      orderBy: { ts: 'asc' },
      select: {
        ts: true,
        oilPercent: true,
        oilLiters: true,
        flowLpm: true,
        pumpState: true,
        distanceCm: true,
      },
    });

    // Downsample if more than 2000 points
    let result = telemetry.map((t) => ({
      ...t,
      ts: Number(t.ts),
    }));

    if (result.length > 2000) {
      const step = Math.ceil(result.length / 2000);
      result = result.filter((_, index) => index % step === 0);
    }

    return NextResponse.json({
      deviceId,
      range,
      count: result.length,
      data: result,
    });
  } catch (error) {
    console.error('Error fetching telemetry:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
