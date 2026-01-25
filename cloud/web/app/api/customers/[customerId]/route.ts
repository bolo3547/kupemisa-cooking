import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

// GET /api/customers/[customerId] - Get customer details
export async function GET(
  req: NextRequest,
  { params }: { params: { customerId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const customer = await prisma.customer.findFirst({
    where: { id: params.customerId, ownerId: session.user.id },
    include: {
      transactions: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      topups: {
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
  });

  if (!customer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  return NextResponse.json(customer);
}

// PUT /api/customers/[customerId] - Update customer
export async function PUT(
  req: NextRequest,
  { params }: { params: { customerId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { name, phone, email } = body;

  const customer = await prisma.customer.updateMany({
    where: { id: params.customerId, ownerId: session.user.id },
    data: { name, phone, email },
  });

  if (customer.count === 0) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}

// DELETE /api/customers/[customerId] - Delete customer
export async function DELETE(
  req: NextRequest,
  { params }: { params: { customerId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await prisma.customer.deleteMany({
    where: { id: params.customerId, ownerId: session.user.id },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
