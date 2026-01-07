import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { shiftsQuerySchema } from '@/lib/validations';

/**
 * GET /api/reports/shifts
 * Get daily shift totals
 * Query params: from, to (YYYY-MM-DD), deviceId?, operatorId?
 */
export async function GET(request: NextRequest) {
  try {
    await requireAuth();

    const { searchParams } = new URL(request.url);
    const query = {
      from: searchParams.get('from'),
      to: searchParams.get('to'),
      deviceId: searchParams.get('deviceId') || undefined,
      operatorId: searchParams.get('operatorId') || undefined,
    };

    const parsed = shiftsQuerySchema.safeParse(query);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { from, to, deviceId, operatorId } = parsed.data;

    // Parse date range
    const fromDate = new Date(from);
    fromDate.setHours(0, 0, 0, 0);
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);

    // Build where clause
    const where: Record<string, any> = {
      startedAt: {
        gte: fromDate,
        lte: toDate,
      },
      status: 'DONE', // Only count completed transactions
    };

    if (deviceId) {
      where.deviceId = deviceId;
    }

    if (operatorId) {
      where.operatorId = operatorId;
    }

    // Aggregate by date
    const transactions = await prisma.dispenseTransaction.findMany({
      where,
      select: {
        startedAt: true,
        dispensedLiters: true,
        totalCost: true,
        totalProfit: true,
        currency: true,
      },
      orderBy: { startedAt: 'asc' },
    });

    // Group by date
    const dailyTotals = new Map<
      string,
      {
        date: string;
        totalTransactions: number;
        totalLiters: number;
        totalSales: number;
        totalProfit: number;
        currency: string;
      }
    >();

    for (const tx of transactions) {
      const dateKey = tx.startedAt.toISOString().split('T')[0];

      if (!dailyTotals.has(dateKey)) {
        dailyTotals.set(dateKey, {
          date: dateKey,
          totalTransactions: 0,
          totalLiters: 0,
          totalSales: 0,
          totalProfit: 0,
          currency: tx.currency,
        });
      }

      const day = dailyTotals.get(dateKey)!;
      day.totalTransactions += 1;
      day.totalLiters += tx.dispensedLiters;
      day.totalSales += tx.totalCost;
      day.totalProfit += tx.totalProfit;
    }

    // Convert to array and round numbers
    const shifts = Array.from(dailyTotals.values()).map((day) => ({
      ...day,
      totalLiters: Math.round(day.totalLiters * 100) / 100,
      totalSales: Math.round(day.totalSales * 100) / 100,
      totalProfit: Math.round(day.totalProfit * 100) / 100,
    }));

    // Calculate grand totals
    const grandTotals = shifts.reduce(
      (acc, day) => ({
        totalTransactions: acc.totalTransactions + day.totalTransactions,
        totalLiters: acc.totalLiters + day.totalLiters,
        totalSales: acc.totalSales + day.totalSales,
        totalProfit: acc.totalProfit + day.totalProfit,
      }),
      { totalTransactions: 0, totalLiters: 0, totalSales: 0, totalProfit: 0 }
    );

    return NextResponse.json({
      ok: true,
      shifts,
      totals: {
        ...grandTotals,
        totalLiters: Math.round(grandTotals.totalLiters * 100) / 100,
        totalSales: Math.round(grandTotals.totalSales * 100) / 100,
        totalProfit: Math.round(grandTotals.totalProfit * 100) / 100,
        currency: transactions[0]?.currency || 'ZMW',
      },
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Failed to get shift report:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
