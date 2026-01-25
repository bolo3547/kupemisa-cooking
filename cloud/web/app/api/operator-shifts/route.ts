import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

// GET /api/operator-shifts - Get operator shifts
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const operatorId = searchParams.get("operatorId");
  const deviceId = searchParams.get("deviceId");
  const date = searchParams.get("date");

  // Get user's devices
  const userDevices = await prisma.device.findMany({
    where: { ownerId: session.user.id },
    select: { deviceId: true },
  });
  const deviceIds = userDevices.map(d => d.deviceId);

  const where: any = {
    deviceId: deviceId || { in: deviceIds },
  };

  if (operatorId) {
    where.operatorId = operatorId;
  }

  if (date) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    where.clockInAt = { gte: startOfDay, lte: endOfDay };
  }

  const shifts = await prisma.operatorShift.findMany({
    where,
    orderBy: { clockInAt: "desc" },
    take: 50,
  });

  // Get operator names
  const operatorIds = [...new Set(shifts.map(s => s.operatorId))];
  const operators = await prisma.operator.findMany({
    where: { id: { in: operatorIds } },
    select: { id: true, name: true },
  });
  const operatorMap = Object.fromEntries(operators.map(o => [o.id, o.name]));

  const shiftsWithNames = shifts.map(s => ({
    ...s,
    operatorName: operatorMap[s.operatorId] || "Unknown",
  }));

  return NextResponse.json(shiftsWithNames);
}

// POST /api/operator-shifts - Clock in/out
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { operatorId, deviceId, action } = body;

  if (!operatorId || !deviceId || !action) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Verify device ownership
  const device = await prisma.device.findFirst({
    where: { deviceId, ownerId: session.user.id },
  });

  if (!device) {
    return NextResponse.json({ error: "Device not found" }, { status: 404 });
  }

  if (action === "clockIn") {
    // Check if already clocked in
    const activeShift = await prisma.operatorShift.findFirst({
      where: { operatorId, deviceId, clockOutAt: null },
    });

    if (activeShift) {
      return NextResponse.json({ error: "Already clocked in" }, { status: 400 });
    }

    const shift = await prisma.operatorShift.create({
      data: { operatorId, deviceId },
    });

    return NextResponse.json(shift);
  } else if (action === "clockOut") {
    // Find active shift
    const activeShift = await prisma.operatorShift.findFirst({
      where: { operatorId, deviceId, clockOutAt: null },
    });

    if (!activeShift) {
      return NextResponse.json({ error: "No active shift found" }, { status: 400 });
    }

    // Calculate sales during shift
    const sales = await prisma.dispenseTransaction.aggregate({
      where: {
        operatorId,
        deviceId,
        startedAt: { gte: activeShift.clockInAt },
        status: "DONE",
      },
      _sum: { totalCost: true, dispensedLiters: true },
    });

    const shift = await prisma.operatorShift.update({
      where: { id: activeShift.id },
      data: {
        clockOutAt: new Date(),
        totalSales: sales._sum.totalCost || 0,
        totalLiters: sales._sum.dispensedLiters || 0,
      },
    });

    return NextResponse.json(shift);
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
