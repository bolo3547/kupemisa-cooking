import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { parseDispenseEventMeta } from '@/lib/dispense-utils';

interface RouteParams {
  params: Promise<{ deviceId: string }>;
}

/**
 * GET /api/devices/[deviceId]/transactions
 * 
 * Get recent dispense transactions for a specific device
 * 
 * Query params:
 * - limit: number (default: 20, max: 100)
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { deviceId } = await params;
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);

    // Verify device exists
    const device = await prisma.device.findUnique({
      where: { deviceId },
      select: { deviceId: true, siteName: true },
    });

    if (!device) {
      return NextResponse.json({ error: 'Device not found' }, { status: 404 });
    }

    // Get dispense events
    const events = await prisma.event.findMany({
      where: {
        deviceId,
        type: { in: ['DISPENSE_DONE', 'DISPENSE_ERROR', 'DISPENSE_START', 'DISPENSE_PAUSE', 'DISPENSE_RESUME', 'DISPENSE_RECEIPT'] },
      },
      orderBy: { ts: 'desc' },
      take: limit,
    });

    const transactions = events.map((event) => {
      const meta = parseDispenseEventMeta(event.metaJson);
      
      return {
        id: event.id,
        ts: Number(event.ts),
        time: new Date(Number(event.ts)).toISOString(),
        type: event.type,
        result: event.type === 'DISPENSE_DONE' || event.type === 'DISPENSE_RECEIPT' ? 'SUCCESS' : 
                event.type === 'DISPENSE_ERROR' ? 'ERROR' : 'INFO',
        targetLiters: meta.targetLiters,
        dispensedLiters: meta.dispensedLiters,
        durationSec: meta.durationSec,
        transactionId: meta.transactionId,
        error: meta.error,
        message: event.message,
        severity: event.severity,
        // Pricing fields
        pricePerLiter: meta.pricePerLiter,
        totalCost: meta.totalCost,
        currency: meta.currency || 'ZMW',
      };
    });

    return NextResponse.json({
      ok: true,
      transactions,
      device: {
        deviceId: device.deviceId,
        siteName: device.siteName,
      },
    });
  } catch (error) {
    console.error('[API] Error fetching device transactions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch transactions' },
      { status: 500 }
    );
  }
}
