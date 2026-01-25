import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

// GET /api/tank/[deviceId] - Get tank info
export async function GET(
  req: NextRequest,
  { params }: { params: { deviceId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { deviceId } = params;

  // Verify ownership
  const device = await prisma.device.findFirst({
    where: { deviceId, ownerId: session.user.id },
  });

  if (!device) {
    return NextResponse.json({ error: "Device not found" }, { status: 404 });
  }

  // Get or create tank
  let tank = await prisma.tank.findUnique({
    where: { deviceId },
    include: {
      refills: {
        orderBy: { refilledAt: "desc" },
        take: 10,
      },
    },
  });

  if (!tank) {
    tank = await prisma.tank.create({
      data: {
        deviceId,
        capacityLiters: 1000,
        currentLiters: 500,
        lowThreshold: 100,
      },
      include: {
        refills: true,
      },
    });
  }

  // Calculate percentage
  const percentage = (tank.currentLiters / tank.capacityLiters) * 100;
  const isLow = tank.currentLiters <= tank.lowThreshold;

  return NextResponse.json({
    ...tank,
    percentage: Math.round(percentage * 10) / 10,
    isLow,
  });
}

// PUT /api/tank/[deviceId] - Update tank settings
export async function PUT(
  req: NextRequest,
  { params }: { params: { deviceId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { deviceId } = params;
  const body = await req.json();

  // Verify ownership
  const device = await prisma.device.findFirst({
    where: { deviceId, ownerId: session.user.id },
  });

  if (!device) {
    return NextResponse.json({ error: "Device not found" }, { status: 404 });
  }

  const { capacityLiters, currentLiters, lowThreshold } = body;

  const tank = await prisma.tank.upsert({
    where: { deviceId },
    update: {
      ...(capacityLiters && { capacityLiters }),
      ...(currentLiters !== undefined && { currentLiters }),
      ...(lowThreshold && { lowThreshold }),
    },
    create: {
      deviceId,
      capacityLiters: capacityLiters || 1000,
      currentLiters: currentLiters || 0,
      lowThreshold: lowThreshold || 100,
    },
  });

  return NextResponse.json(tank);
}

// POST /api/tank/[deviceId] - Add refill
export async function POST(
  req: NextRequest,
  { params }: { params: { deviceId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { deviceId } = params;
  const body = await req.json();

  // Verify ownership
  const device = await prisma.device.findFirst({
    where: { deviceId, ownerId: session.user.id },
  });

  if (!device) {
    return NextResponse.json({ error: "Device not found" }, { status: 404 });
  }

  const { litersAdded, costPerLiter, supplier, invoiceNo, notes } = body;

  if (!litersAdded || litersAdded <= 0) {
    return NextResponse.json({ error: "Invalid liters amount" }, { status: 400 });
  }

  // Get or create tank
  let tank = await prisma.tank.findUnique({ where: { deviceId } });
  if (!tank) {
    tank = await prisma.tank.create({
      data: {
        deviceId,
        capacityLiters: 1000,
        currentLiters: 0,
        lowThreshold: 100,
      },
    });
  }

  // Create refill record and update tank level
  const [refill, updatedTank] = await prisma.$transaction([
    prisma.tankRefill.create({
      data: {
        tankId: tank.id,
        litersAdded,
        costPerLiter,
        totalCost: costPerLiter ? litersAdded * costPerLiter : null,
        supplier,
        invoiceNo,
        notes,
        createdBy: session.user.id,
      },
    }),
    prisma.tank.update({
      where: { id: tank.id },
      data: {
        currentLiters: Math.min(tank.currentLiters + litersAdded, tank.capacityLiters),
        lastRefillAt: new Date(),
      },
    }),
  ]);

  return NextResponse.json({ refill, tank: updatedTank });
}
