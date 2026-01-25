import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

// GET /api/operator-limits - Get operator limits
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get user's operators
  const operators = await prisma.operator.findMany({
    where: { ownerId: session.user.id },
    select: { id: true, name: true },
  });

  // Get limits
  const limits = await prisma.operatorLimit.findMany({
    where: { operatorId: { in: operators.map(o => o.id) } },
  });

  const operatorMap = Object.fromEntries(operators.map(o => [o.id, o.name]));
  const limitsWithNames = limits.map(l => ({
    ...l,
    operatorName: operatorMap[l.operatorId] || "Unknown",
  }));

  return NextResponse.json(limitsWithNames);
}

// POST /api/operator-limits - Set operator limit
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { operatorId, dailySalesLimit, dailyLitersLimit, isActive } = body;

  if (!operatorId) {
    return NextResponse.json({ error: "Operator ID is required" }, { status: 400 });
  }

  // Verify operator ownership
  const operator = await prisma.operator.findFirst({
    where: { id: operatorId, ownerId: session.user.id },
  });

  if (!operator) {
    return NextResponse.json({ error: "Operator not found" }, { status: 404 });
  }

  const limit = await prisma.operatorLimit.upsert({
    where: { operatorId },
    update: {
      dailySalesLimit,
      dailyLitersLimit,
      isActive: isActive ?? true,
    },
    create: {
      operatorId,
      dailySalesLimit,
      dailyLitersLimit,
      isActive: isActive ?? true,
    },
  });

  return NextResponse.json(limit);
}

// DELETE /api/operator-limits - Remove operator limit
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const operatorId = searchParams.get("operatorId");

  if (!operatorId) {
    return NextResponse.json({ error: "Operator ID is required" }, { status: 400 });
  }

  // Verify operator ownership
  const operator = await prisma.operator.findFirst({
    where: { id: operatorId, ownerId: session.user.id },
  });

  if (!operator) {
    return NextResponse.json({ error: "Operator not found" }, { status: 404 });
  }

  await prisma.operatorLimit.deleteMany({
    where: { operatorId },
  });

  return NextResponse.json({ success: true });
}
