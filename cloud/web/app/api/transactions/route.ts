import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { parseDispenseEventMeta, DISPENSE_EVENT_TYPES } from '@/lib/dispense-utils';

/**
 * GET /api/transactions
 * 
 * Query dispense transactions (events) with filters
 * 
 * Query params:
 * - range: '24h' | '7d' | '30d' | 'all' (default: '7d')
 * - deviceId: string (optional)
 * - status: 'DONE' | 'ERROR' | 'all' (default: 'all')
 * - limit: number (default: 100, max: 500)
 * - offset: number (default: 0)
 */
export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const range = searchParams.get('range') || '7d';
    const deviceId = searchParams.get('deviceId');
    const status = searchParams.get('status') || 'all';
    const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500);
    const offset = parseInt(searchParams.get('offset') || '0');

    // Calculate date range
    let fromDate: Date | undefined;
    const now = new Date();
    
    switch (range) {
      case '24h':
        fromDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        fromDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'all':
        fromDate = undefined;
        break;
      default:
        fromDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    // Build event type filter - include DISPENSE_RECEIPT for pricing data
    let typeFilter: string[] = [];
    if (status === 'DONE') {
      typeFilter = ['DISPENSE_DONE', 'DISPENSE_RECEIPT'];
    } else if (status === 'ERROR') {
      typeFilter = ['DISPENSE_ERROR'];
    } else {
      typeFilter = ['DISPENSE_DONE', 'DISPENSE_ERROR', 'DISPENSE_RECEIPT'];
    }

    // Build where clause
    const where: any = {
      type: { in: typeFilter },
    };

    if (fromDate) {
      where.ts = { gte: BigInt(fromDate.getTime()) };
    }

    if (deviceId) {
      where.deviceId = deviceId;
    }

    // Query events with device info
    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where,
        include: {
          device: {
            select: {
              deviceId: true,
              siteName: true,
              location: true,
            },
          },
        },
        orderBy: { ts: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.event.count({ where }),
    ]);

    // Transform events to transactions with pricing
    const transactions = events.map((event) => {
      const meta = parseDispenseEventMeta(event.metaJson);
      
      return {
        id: event.id,
        deviceId: event.device.deviceId,
        siteName: event.device.siteName,
        location: event.device.location,
        ts: Number(event.ts),
        time: new Date(Number(event.ts)).toISOString(),
        type: event.type,
        result: event.type === 'DISPENSE_ERROR' ? 'ERROR' : 'SUCCESS',
        targetLiters: meta.targetLiters,
        dispensedLiters: meta.dispensedLiters,
        durationSec: meta.durationSec,
        transactionId: meta.transactionId,
        error: meta.error,
        message: event.message,
        // Pricing fields
        pricePerLiter: meta.pricePerLiter,
        totalCost: meta.totalCost,
        currency: meta.currency || 'ZMW',
      };
    });

    return NextResponse.json({
      ok: true,
      transactions,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + transactions.length < total,
      },
    });
  } catch (error) {
    console.error('[API] Error fetching transactions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch transactions' },
      { status: 500 }
    );
  }
}
