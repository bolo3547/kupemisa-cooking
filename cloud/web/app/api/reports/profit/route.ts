import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { profitQuerySchema } from '@/lib/validations';

/**
 * GET /api/reports/profit
 * Get profit report with breakdown
 * Query params: range (7d|30d|custom), from?, to?, deviceId?
 */
export async function GET(request: NextRequest) {
  try {
    await requireAuth();

    const { searchParams } = new URL(request.url);
    const query = {
      range: searchParams.get('range') || '30d',
      from: searchParams.get('from') || undefined,
      to: searchParams.get('to') || undefined,
      deviceId: searchParams.get('deviceId') || undefined,
    };

    const parsed = profitQuerySchema.safeParse(query);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { range, from, to, deviceId } = parsed.data;

    // Calculate date range
    let fromDate: Date;
    let toDate: Date = new Date();
    toDate.setHours(23, 59, 59, 999);

    if (range === 'custom' && from && to) {
      fromDate = new Date(from);
      toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
    } else if (range === '7d') {
      fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - 7);
      fromDate.setHours(0, 0, 0, 0);
    } else {
      // Default to 30d
      fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - 30);
      fromDate.setHours(0, 0, 0, 0);
    }

    // Build where clause
    const where: Record<string, any> = {
      startedAt: {
        gte: fromDate,
        lte: toDate,
      },
      status: 'DONE',
    };

    if (deviceId) {
      where.deviceId = deviceId;
    }

    // Get all transactions with device and operator info
    const transactions = await prisma.dispenseTransaction.findMany({
      where,
      select: {
        startedAt: true,
        deviceId: true,
        operatorId: true,
        dispensedLiters: true,
        totalCost: true,
        totalProfit: true,
        currency: true,
        device: {
          select: {
            siteName: true,
          },
        },
        operator: {
          select: {
            name: true,
          },
        },
      },
      orderBy: { startedAt: 'asc' },
    });

    // Calculate grand totals
    const totals = transactions.reduce(
      (acc, tx) => ({
        totalTransactions: acc.totalTransactions + 1,
        totalLiters: acc.totalLiters + tx.dispensedLiters,
        totalSales: acc.totalSales + tx.totalCost,
        totalProfit: acc.totalProfit + tx.totalProfit,
        totalCost: acc.totalCost + (tx.totalCost - tx.totalProfit), // Cost = Sales - Profit
      }),
      { totalTransactions: 0, totalLiters: 0, totalSales: 0, totalProfit: 0, totalCost: 0 }
    );

    // Breakdown by device
    const byDevice = new Map<
      string,
      {
        deviceId: string;
        siteName: string;
        totalTransactions: number;
        totalLiters: number;
        totalSales: number;
        totalProfit: number;
      }
    >();

    for (const tx of transactions) {
      if (!byDevice.has(tx.deviceId)) {
        byDevice.set(tx.deviceId, {
          deviceId: tx.deviceId,
          siteName: tx.device.siteName,
          totalTransactions: 0,
          totalLiters: 0,
          totalSales: 0,
          totalProfit: 0,
        });
      }
      const entry = byDevice.get(tx.deviceId)!;
      entry.totalTransactions += 1;
      entry.totalLiters += tx.dispensedLiters;
      entry.totalSales += tx.totalCost;
      entry.totalProfit += tx.totalProfit;
    }

    // Breakdown by operator
    const byOperator = new Map<
      string,
      {
        operatorId: string | null;
        operatorName: string;
        totalTransactions: number;
        totalLiters: number;
        totalSales: number;
        totalProfit: number;
      }
    >();

    for (const tx of transactions) {
      const opKey = tx.operatorId || 'unassigned';
      if (!byOperator.has(opKey)) {
        byOperator.set(opKey, {
          operatorId: tx.operatorId,
          operatorName: tx.operator?.name || 'Unassigned',
          totalTransactions: 0,
          totalLiters: 0,
          totalSales: 0,
          totalProfit: 0,
        });
      }
      const entry = byOperator.get(opKey)!;
      entry.totalTransactions += 1;
      entry.totalLiters += tx.dispensedLiters;
      entry.totalSales += tx.totalCost;
      entry.totalProfit += tx.totalProfit;
    }

    // Daily trend for charts
    const dailyTrend = new Map<
      string,
      { date: string; sales: number; profit: number; liters: number }
    >();

    for (const tx of transactions) {
      const dateKey = tx.startedAt.toISOString().split('T')[0];
      if (!dailyTrend.has(dateKey)) {
        dailyTrend.set(dateKey, { date: dateKey, sales: 0, profit: 0, liters: 0 });
      }
      const day = dailyTrend.get(dateKey)!;
      day.sales += tx.totalCost;
      day.profit += tx.totalProfit;
      day.liters += tx.dispensedLiters;
    }

    // Round and format
    const roundEntry = (e: any) => ({
      ...e,
      totalLiters: Math.round(e.totalLiters * 100) / 100,
      totalSales: Math.round(e.totalSales * 100) / 100,
      totalProfit: Math.round(e.totalProfit * 100) / 100,
    });

    return NextResponse.json({
      ok: true,
      dateRange: {
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
      },
      totals: {
        ...totals,
        totalLiters: Math.round(totals.totalLiters * 100) / 100,
        totalSales: Math.round(totals.totalSales * 100) / 100,
        totalProfit: Math.round(totals.totalProfit * 100) / 100,
        totalCost: Math.round(totals.totalCost * 100) / 100,
        profitMargin:
          totals.totalSales > 0
            ? Math.round((totals.totalProfit / totals.totalSales) * 10000) / 100
            : 0,
        currency: transactions[0]?.currency || 'ZMW',
      },
      byDevice: Array.from(byDevice.values())
        .map(roundEntry)
        .sort((a, b) => b.totalProfit - a.totalProfit),
      byOperator: Array.from(byOperator.values())
        .map(roundEntry)
        .sort((a, b) => b.totalProfit - a.totalProfit),
      dailyTrend: Array.from(dailyTrend.values()).map((d) => ({
        ...d,
        sales: Math.round(d.sales * 100) / 100,
        profit: Math.round(d.profit * 100) / 100,
        liters: Math.round(d.liters * 100) / 100,
      })),
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Failed to get profit report:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
