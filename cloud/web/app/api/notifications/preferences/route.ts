import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

// GET /api/notifications/preferences - Get notification preferences
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let prefs = await prisma.notificationPreference.findUnique({
    where: { userId: session.user.id },
  });

  // Create default preferences if none exist
  if (!prefs) {
    prefs = await prisma.notificationPreference.create({
      data: { userId: session.user.id },
    });
  }

  return NextResponse.json(prefs);
}

// PUT /api/notifications/preferences - Update notification preferences
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const {
    emailDailySummary,
    emailLowStock,
    emailTamper,
    pushSales,
    pushLowStock,
    pushTamper,
    whatsappReceipts,
    whatsappPhone,
  } = body;

  const prefs = await prisma.notificationPreference.upsert({
    where: { userId: session.user.id },
    update: {
      ...(emailDailySummary !== undefined && { emailDailySummary }),
      ...(emailLowStock !== undefined && { emailLowStock }),
      ...(emailTamper !== undefined && { emailTamper }),
      ...(pushSales !== undefined && { pushSales }),
      ...(pushLowStock !== undefined && { pushLowStock }),
      ...(pushTamper !== undefined && { pushTamper }),
      ...(whatsappReceipts !== undefined && { whatsappReceipts }),
      ...(whatsappPhone !== undefined && { whatsappPhone }),
    },
    create: {
      userId: session.user.id,
      emailDailySummary,
      emailLowStock,
      emailTamper,
      pushSales,
      pushLowStock,
      pushTamper,
      whatsappReceipts,
      whatsappPhone,
    },
  });

  return NextResponse.json(prefs);
}
