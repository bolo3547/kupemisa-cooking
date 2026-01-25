import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

// GET /api/reports - Get sales reports with filters
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const period = searchParams.get("period") || "daily"; // daily, weekly, monthly
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const deviceId = searchParams.get("deviceId");
  const operatorId = searchParams.get("operatorId");

  // Calculate date range
  let dateFrom: Date;
  let dateTo: Date = new Date();
  
  if (startDate && endDate) {
    dateFrom = new Date(startDate);
    dateTo = new Date(endDate);
  } else {
    switch (period) {
      case "weekly":
        dateFrom = new Date();
        dateFrom.setDate(dateFrom.getDate() - 7);
        break;
      case "monthly":
        dateFrom = new Date();
        dateFrom.setMonth(dateFrom.getMonth() - 1);
        break;
      case "yearly":
        dateFrom = new Date();
        dateFrom.setFullYear(dateFrom.getFullYear() - 1);
        break;
      default: // daily
        dateFrom = new Date();
        dateFrom.setHours(0, 0, 0, 0);
    }
  }

  // Get user's devices
  const userDevices = await prisma.device.findMany({
    where: { ownerId: session.user.id },
    select: { deviceId: true },
  });
  const deviceIds = userDevices.map(d => d.deviceId);

  // Build query filters
  const where: any = {
    deviceId: deviceId ? deviceId : { in: deviceIds },
    startedAt: {
      gte: dateFrom,
      lte: dateTo,
    },
    status: "DONE",
  };

  if (operatorId) {
    where.operatorId = operatorId;
  }

  // Get transactions
  const transactions = await prisma.dispenseTransaction.findMany({
    where,
    include: {
      operator: { select: { name: true } },
      device: { select: { siteName: true } },
    },
    orderBy: { startedAt: "desc" },
  });

  // Calculate summary
  const summary = {
    totalTransactions: transactions.length,
    totalLiters: transactions.reduce((sum, t) => sum + t.dispensedLiters, 0),
    totalRevenue: transactions.reduce((sum, t) => sum + t.totalCost, 0),
    totalProfit: transactions.reduce((sum, t) => sum + t.totalProfit, 0),
    averageTransaction: transactions.length > 0 
      ? transactions.reduce((sum, t) => sum + t.totalCost, 0) / transactions.length 
      : 0,
  };

  // Group by day for chart data
  const dailyData: Record<string, { date: string; sales: number; liters: number; count: number }> = {};
  transactions.forEach(t => {
    const date = t.startedAt.toISOString().split("T")[0];
    if (!dailyData[date]) {
      dailyData[date] = { date, sales: 0, liters: 0, count: 0 };
    }
    dailyData[date].sales += t.totalCost;
    dailyData[date].liters += t.dispensedLiters;
    dailyData[date].count += 1;
  });

  // Group by hour for peak hours
  const hourlyData: Record<number, { hour: number; count: number; sales: number }> = {};
  for (let i = 0; i < 24; i++) {
    hourlyData[i] = { hour: i, count: 0, sales: 0 };
  }
  transactions.forEach(t => {
    const hour = t.startedAt.getHours();
    hourlyData[hour].count += 1;
    hourlyData[hour].sales += t.totalCost;
  });

  // Operator performance
  const operatorStats: Record<string, { id: string; name: string; sales: number; liters: number; count: number }> = {};
  transactions.forEach(t => {
    const opId = t.operatorId || "unknown";
    const opName = t.operator?.name || "Unknown";
    if (!operatorStats[opId]) {
      operatorStats[opId] = { id: opId, name: opName, sales: 0, liters: 0, count: 0 };
    }
    operatorStats[opId].sales += t.totalCost;
    operatorStats[opId].liters += t.dispensedLiters;
    operatorStats[opId].count += 1;
  });

  return NextResponse.json({
    summary,
    transactions: transactions.slice(0, 100), // Limit for performance
    chartData: Object.values(dailyData).sort((a, b) => a.date.localeCompare(b.date)),
    peakHours: Object.values(hourlyData),
    operatorPerformance: Object.values(operatorStats).sort((a, b) => b.sales - a.sales),
    period,
    dateRange: { from: dateFrom.toISOString(), to: dateTo.toISOString() },
  });
}
