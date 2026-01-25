import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

// GET /api/reports/export - Export reports as CSV
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const format = searchParams.get("format") || "csv";
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const deviceId = searchParams.get("deviceId");

  // Calculate date range
  let dateFrom = new Date();
  dateFrom.setMonth(dateFrom.getMonth() - 1);
  let dateTo = new Date();
  
  if (startDate) dateFrom = new Date(startDate);
  if (endDate) dateTo = new Date(endDate);

  // Get user's devices
  const userDevices = await prisma.device.findMany({
    where: { ownerId: session.user.id },
    select: { deviceId: true },
  });
  const deviceIds = userDevices.map(d => d.deviceId);

  // Build query
  const where: any = {
    deviceId: deviceId ? deviceId : { in: deviceIds },
    startedAt: { gte: dateFrom, lte: dateTo },
    status: "DONE",
  };

  const transactions = await prisma.dispenseTransaction.findMany({
    where,
    include: {
      operator: { select: { name: true } },
      device: { select: { siteName: true } },
    },
    orderBy: { startedAt: "desc" },
  });

  if (format === "csv") {
    // Generate CSV
    const headers = [
      "Date",
      "Time",
      "Site",
      "Operator",
      "Liters",
      "Price/L",
      "Total (ZMW)",
      "Duration (sec)",
      "Status",
    ];

    const rows = transactions.map(t => [
      t.startedAt.toISOString().split("T")[0],
      t.startedAt.toTimeString().split(" ")[0],
      t.device?.siteName || "",
      t.operator?.name || "Unknown",
      t.dispensedLiters.toFixed(3),
      t.pricePerLiter.toFixed(2),
      t.totalCost.toFixed(2),
      t.durationSec.toString(),
      t.status,
    ]);

    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="sales-report-${dateFrom.toISOString().split("T")[0]}-to-${dateTo.toISOString().split("T")[0]}.csv"`,
      },
    });
  }

  // JSON format (for potential PDF generation on client)
  return NextResponse.json({
    transactions,
    summary: {
      totalTransactions: transactions.length,
      totalLiters: transactions.reduce((sum, t) => sum + t.dispensedLiters, 0),
      totalRevenue: transactions.reduce((sum, t) => sum + t.totalCost, 0),
    },
    dateRange: { from: dateFrom.toISOString(), to: dateTo.toISOString() },
  });
}
