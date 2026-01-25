import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

// GET /api/price-schedule - List scheduled price changes
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const schedules = await prisma.scheduledPriceChange.findMany({
    where: { ownerId: session.user.id },
    orderBy: { effectiveAt: "asc" },
  });

  // Get price history from PriceSchedule
  const priceHistory = await prisma.priceSchedule.findMany({
    where: { createdByUserId: session.user.id },
    orderBy: { effectiveFrom: "desc" },
    take: 20,
    include: {
      device: { select: { siteName: true } },
    },
  });

  return NextResponse.json({ schedules, priceHistory });
}

// POST /api/price-schedule - Create scheduled price change
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { deviceId, newPricePerLiter, effectiveAt } = body;

  if (!newPricePerLiter || newPricePerLiter <= 0) {
    return NextResponse.json({ error: "Valid price is required" }, { status: 400 });
  }

  if (!effectiveAt) {
    return NextResponse.json({ error: "Effective date is required" }, { status: 400 });
  }

  const effectiveDate = new Date(effectiveAt);
  if (effectiveDate <= new Date()) {
    return NextResponse.json({ error: "Date must be in the future" }, { status: 400 });
  }

  // Verify device ownership if specified
  if (deviceId) {
    const device = await prisma.device.findFirst({
      where: { deviceId, ownerId: session.user.id },
    });
    if (!device) {
      return NextResponse.json({ error: "Device not found" }, { status: 404 });
    }
  }

  const schedule = await prisma.scheduledPriceChange.create({
    data: {
      ownerId: session.user.id,
      deviceId,
      newPricePerLiter,
      effectiveAt: effectiveDate,
    },
  });

  return NextResponse.json(schedule);
}

// DELETE /api/price-schedule - Delete scheduled price change
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "ID is required" }, { status: 400 });
  }

  const result = await prisma.scheduledPriceChange.deleteMany({
    where: { id, ownerId: session.user.id, applied: false },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "Schedule not found or already applied" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
