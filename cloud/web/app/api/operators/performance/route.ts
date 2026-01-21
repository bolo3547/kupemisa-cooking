import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/operators/performance
 * 
 * Get operator performance metrics
 * 
 * Query params:
 * - range: '24h' | '7d' | '30d' | 'all' (default: '30d')
 */
export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const range = searchParams.get('range') || '30d';

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
        fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Get all operators for the owner
    const operators = await prisma.operator.findMany({
      where: {
        ownerId: session.user.id,
      },
      select: {
        id: true,
        name: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { name: 'asc' },
    });

    // Build where clause for transactions
    const txWhere: any = {
      status: 'DONE',
      operatorId: { not: null },
    };
    
    if (fromDate) {
      txWhere.startedAt = { gte: fromDate };
    }

    // Get aggregated stats per operator
    const operatorStats = await prisma.dispenseTransaction.groupBy({
      by: ['operatorId'],
      where: txWhere,
      _sum: {
        dispensedLiters: true,
        totalCost: true,
        totalProfit: true,
      },
      _count: {
        id: true,
      },
      _avg: {
        dispensedLiters: true,
        totalCost: true,
      },
    });

    // Create a map of operator stats
    const statsMap = new Map(
      operatorStats.map((s) => [
        s.operatorId,
        {
          totalTransactions: s._count.id,
          totalLiters: s._sum.dispensedLiters || 0,
          totalRevenue: s._sum.totalCost || 0,
          totalProfit: s._sum.totalProfit || 0,
          avgLitersPerTransaction: s._avg.dispensedLiters || 0,
          avgRevenuePerTransaction: s._avg.totalCost || 0,
        },
      ])
    );

    // Get daily breakdown for each operator (last 7 days for chart)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const dailyTransactions = await prisma.dispenseTransaction.findMany({
      where: {
        status: 'DONE',
        operatorId: { not: null },
        startedAt: { gte: sevenDaysAgo },
      },
      select: {
        operatorId: true,
        startedAt: true,
        dispensedLiters: true,
        totalCost: true,
      },
    });

    // Group by operator and day
    const dailyMap = new Map<string, Map<string, { liters: number; revenue: number; count: number }>>();
    
    dailyTransactions.forEach((tx) => {
      if (!tx.operatorId) return;
      
      const day = tx.startedAt.toISOString().split('T')[0];
      
      if (!dailyMap.has(tx.operatorId)) {
        dailyMap.set(tx.operatorId, new Map());
      }
      
      const opMap = dailyMap.get(tx.operatorId)!;
      if (!opMap.has(day)) {
        opMap.set(day, { liters: 0, revenue: 0, count: 0 });
      }
      
      const dayStats = opMap.get(day)!;
      dayStats.liters += tx.dispensedLiters;
      dayStats.revenue += tx.totalCost;
      dayStats.count += 1;
    });

    // Commission rate (configurable - default 2% of revenue)
    const COMMISSION_RATE = 0.02;

    // Combine operator info with stats
    const performance = operators.map((op) => {
      const stats = statsMap.get(op.id) || {
        totalTransactions: 0,
        totalLiters: 0,
        totalRevenue: 0,
        totalProfit: 0,
        avgLitersPerTransaction: 0,
        avgRevenuePerTransaction: 0,
      };

      // Get daily data for this operator
      const opDailyMap = dailyMap.get(op.id);
      const dailyData: { date: string; liters: number; revenue: number; count: number }[] = [];
      
      // Generate last 7 days
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        const dayData = opDailyMap?.get(dateStr);
        
        dailyData.push({
          date: dateStr,
          liters: dayData?.liters || 0,
          revenue: dayData?.revenue || 0,
          count: dayData?.count || 0,
        });
      }

      return {
        id: op.id,
        name: op.name,
        isActive: op.isActive,
        createdAt: op.createdAt.toISOString(),
        ...stats,
        commission: stats.totalRevenue * COMMISSION_RATE,
        dailyData,
      };
    });

    // Sort by total revenue descending
    performance.sort((a, b) => b.totalRevenue - a.totalRevenue);

    // Calculate totals
    const totals = {
      totalOperators: operators.length,
      activeOperators: operators.filter((o) => o.isActive).length,
      totalTransactions: performance.reduce((sum, p) => sum + p.totalTransactions, 0),
      totalLiters: performance.reduce((sum, p) => sum + p.totalLiters, 0),
      totalRevenue: performance.reduce((sum, p) => sum + p.totalRevenue, 0),
      totalProfit: performance.reduce((sum, p) => sum + p.totalProfit, 0),
      totalCommission: performance.reduce((sum, p) => sum + p.commission, 0),
    };

    return NextResponse.json({
      ok: true,
      range,
      operators: performance,
      totals,
      commissionRate: COMMISSION_RATE,
    });
  } catch (error) {
    console.error('[API] Error fetching operator performance:', error);
    return NextResponse.json(
      { error: 'Failed to fetch operator performance' },
      { status: 500 }
    );
  }
}
