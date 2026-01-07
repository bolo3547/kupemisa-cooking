import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireOwner } from '@/lib/auth';
import { createOperatorSchema } from '@/lib/validations';
import bcrypt from 'bcryptjs';
import { hashOperatorPinForDevice } from '@/lib/operator-pin';

/**
 * GET /api/owner/operators
 * List all operators (OWNER only)
 */
export async function GET() {
  try {
    const session = await requireOwner();

    const operators = await prisma.operator.findMany({
      where: {
        ownerId: session.id,
      },
      select: {
        id: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        _count: {
          select: {
            dispenseTransactions: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json({
      ok: true,
      operators: operators.map((op) => ({
        ...op,
        transactionCount: op._count.dispenseTransactions,
        _count: undefined,
      })),
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (error.message?.includes('Forbidden')) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }
    console.error('Failed to list operators:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/owner/operators
 * Create a new operator (OWNER only)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireOwner();

    const body = await request.json();
    const parsed = createOperatorSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { name, pin, role } = parsed.data;

    // Check if operator name already exists for this owner
    const existingName = await prisma.operator.findFirst({
      where: { 
        ownerId: session.id,
        name: { equals: name } 
      },
    });

    if (existingName) {
      return NextResponse.json(
        { ok: false, error: 'Operator with this name already exists' },
        { status: 409 }
      );
    }

    // Check if PIN is already used by another operator for this owner
    const pinHashDevice = hashOperatorPinForDevice(pin);
    const existingPin = await prisma.operator.findFirst({
      where: {
        ownerId: session.id,
        pinHashDevice,
      },
    });

    if (existingPin) {
      return NextResponse.json(
        { ok: false, error: 'PIN is already used by another operator' },
        { status: 409 }
      );
    }

    // Hash the PIN for dashboard verification
    const pinHash = await bcrypt.hash(pin, 12);

    const operator = await prisma.operator.create({
      data: {
        ownerId: session.id,
        name,
        pinHash,        // Bcrypt hash for dashboard verification
        pinHashDevice,  // SHA256 hash for device-side verification
        role,
      },
      select: {
        id: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ ok: true, operator }, { status: 201 });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (error.message?.includes('Forbidden')) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }
    console.error('Failed to create operator:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
