import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { prisma } from "@/lib/prisma";

// POST /api/customers/[customerId]/topup - Add credit to customer
export async function POST(
  req: NextRequest,
  { params }: { params: { customerId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { amount, method, reference } = body;

  if (!amount || amount <= 0) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }

  // Verify customer ownership
  const customer = await prisma.customer.findFirst({
    where: { id: params.customerId, ownerId: session.user.id },
  });

  if (!customer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  // Create topup and update balance
  const [topup, updatedCustomer] = await prisma.$transaction([
    prisma.customerTopup.create({
      data: {
        customerId: params.customerId,
        amount,
        method: method || "CASH",
        reference,
        createdBy: session.user.id,
      },
    }),
    prisma.customer.update({
      where: { id: params.customerId },
      data: { balance: { increment: amount } },
    }),
  ]);

  return NextResponse.json({ topup, newBalance: updatedCustomer.balance });
}
