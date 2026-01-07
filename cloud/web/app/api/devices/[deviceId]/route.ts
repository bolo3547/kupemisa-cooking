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

    // Transform BigInt to Number for JSON serialization
    const result = {
      ...device,
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
