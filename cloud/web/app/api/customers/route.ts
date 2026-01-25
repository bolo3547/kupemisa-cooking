import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

// GET /api/customers - List customers
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const customers = await prisma.customer.findMany({
    where: { ownerId: session.user.id },
    orderBy: { totalSpent: "desc" },
    include: {
      _count: { select: { transactions: true } },
    },
  });

  return NextResponse.json(customers);
}

// POST /api/customers - Create customer
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { name, phone, email } = body;

  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  // Check if phone already exists
  if (phone) {
    const existing = await prisma.customer.findFirst({
      where: { ownerId: session.user.id, phone },
    });
    if (existing) {
      return NextResponse.json({ error: "Phone number already registered" }, { status: 400 });
    }
  }

  const customer = await prisma.customer.create({
    data: {
      ownerId: session.user.id,
      name,
      phone,
      email,
    },
  });

  return NextResponse.json(customer);
}
