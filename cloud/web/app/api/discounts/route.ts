import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

// GET /api/discounts - List discount codes
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const discounts = await prisma.discountCode.findMany({
    where: { ownerId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(discounts);
}

// POST /api/discounts - Create discount code
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { code, description, discountPercent, discountAmount, minPurchase, maxUses, validFrom, validTo } = body;

  if (!code) {
    return NextResponse.json({ error: "Code is required" }, { status: 400 });
  }

  if (!discountPercent && !discountAmount) {
    return NextResponse.json({ error: "Either discount percent or amount is required" }, { status: 400 });
  }

  // Check if code already exists
  const existing = await prisma.discountCode.findFirst({
    where: { ownerId: session.user.id, code: code.toUpperCase() },
  });

  if (existing) {
    return NextResponse.json({ error: "Code already exists" }, { status: 400 });
  }

  const discount = await prisma.discountCode.create({
    data: {
      ownerId: session.user.id,
      code: code.toUpperCase(),
      description,
      discountPercent,
      discountAmount,
      minPurchase,
      maxUses,
      validFrom: validFrom ? new Date(validFrom) : new Date(),
      validTo: validTo ? new Date(validTo) : null,
    },
  });

  return NextResponse.json(discount);
}

// PUT /api/discounts - Update discount code
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { id, isActive, maxUses, validTo } = body;

  if (!id) {
    return NextResponse.json({ error: "ID is required" }, { status: 400 });
  }

  const result = await prisma.discountCode.updateMany({
    where: { id, ownerId: session.user.id },
    data: {
      ...(isActive !== undefined && { isActive }),
      ...(maxUses !== undefined && { maxUses }),
      ...(validTo && { validTo: new Date(validTo) }),
    },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "Discount not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}

// DELETE /api/discounts - Delete discount code
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

  const result = await prisma.discountCode.deleteMany({
    where: { id, ownerId: session.user.id },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "Discount not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
