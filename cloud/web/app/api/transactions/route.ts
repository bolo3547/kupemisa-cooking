import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/transactions
 * 
 * Query dispense transactions with filters
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

    // Build where clause for DispenseTransaction table
    const where: any = {};

    if (fromDate) {
      where.startedAt = { gte: fromDate };
    }

    if (deviceId) {
      where.deviceId = deviceId;
    }

    if (status === 'DONE') {
      where.status = 'DONE';
    } else if (status === 'ERROR') {
      where.status = { in: ['ERROR', 'CANCELED'] };
    }
    // 'all' - no status filter

    // Query DispenseTransaction with device and operator info
    const [transactions, total] = await Promise.all([
      prisma.dispenseTransaction.findMany({
        where,
        include: {
          device: {
            select: {
              deviceId: true,
              siteName: true,
              location: true,
            },
          },
          operator: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { startedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.dispenseTransaction.count({ where }),
    ]);

    // Transform transactions for frontend
    const result = transactions.map((tx) => {
      return {
        id: tx.id,
        sessionId: tx.sessionId,
        deviceId: tx.device.deviceId,
        siteName: tx.device.siteName,
        location: tx.device.location,
        // Operator info
        operatorId: tx.operator?.id || null,
        operatorName: tx.operator?.name || 'Unknown',
        // Time - use startedAt timestamp
        ts: tx.startedAt.getTime(),
        time: tx.startedAt.toISOString(),
        endTime: tx.endedAt?.toISOString(),
        // Status
        result: tx.status === 'DONE' ? 'SUCCESS' : 'ERROR',
        status: tx.status,
        // Dispense data
        targetLiters: tx.targetLiters,
        dispensedLiters: tx.dispensedLiters,
        durationSec: tx.durationSec,
        // Pricing
        pricePerLiter: tx.pricePerLiter,
        costPerLiter: tx.costPerLiter,
        totalCost: tx.totalCost,
        totalProfit: tx.totalProfit,
        currency: tx.currency || 'ZMW',
        // Error
        error: tx.errorMessage,
        message: tx.status === 'DONE' 
          ? `Dispensed ${tx.dispensedLiters.toFixed(2)}L` 
          : tx.errorMessage || 'Transaction failed',
      };
    });

    return NextResponse.json({
      ok: true,
      transactions: result,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + result.length < total,
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
