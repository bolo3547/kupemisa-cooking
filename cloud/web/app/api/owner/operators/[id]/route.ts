import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireOwner } from '@/lib/auth';
import { updateOperatorSchema } from '@/lib/validations';
import bcrypt from 'bcryptjs';
import { hashOperatorPinForDevice } from '@/lib/operator-pin';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/owner/operators/[id]
 * Get operator details (OWNER only)
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireOwner();
    const { id } = await params;

    const operator = await prisma.operator.findFirst({
      where: { id, ownerId: session.id },
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
    });

    if (!operator) {
      return NextResponse.json({ ok: false, error: 'Operator not found' }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      operator: {
        ...operator,
        transactionCount: operator._count.dispenseTransactions,
        _count: undefined,
      },
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (error.message?.includes('Forbidden')) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }
    console.error('Failed to get operator:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH /api/owner/operators/[id]
 * Update operator (OWNER only)
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireOwner();
    const { id } = await params;

    const body = await request.json();
    const parsed = updateOperatorSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Check if operator exists
    const existing = await prisma.operator.findFirst({ where: { id, ownerId: session.id } });
    if (!existing) {
      return NextResponse.json({ ok: false, error: 'Operator not found' }, { status: 404 });
    }

    const { name, pin, role, isActive } = parsed.data;

    // If name is changing, check for duplicates
    if (name && name !== existing.name) {
      const duplicate = await prisma.operator.findFirst({
        where: { 
          ownerId: session.id,
          name: { equals: name },
          id: { not: id },
        },
      });
      if (duplicate) {
        return NextResponse.json(
          { ok: false, error: 'Operator with this name already exists' },
          { status: 409 }
        );
      }
    }

    // Build update data
    const updateData: Record<string, any> = {};
    if (name !== undefined) updateData.name = name;
    if (role !== undefined) updateData.role = role;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (pin !== undefined) {
      const pinHashDevice = hashOperatorPinForDevice(pin);
      const duplicatePin = await prisma.operator.findFirst({
        where: {
          ownerId: session.id,
          pinHashDevice,
          id: { not: id },
        },
      });
      if (duplicatePin) {
        return NextResponse.json(
          { ok: false, error: 'PIN is already used by another operator' },
          { status: 409 }
        );
      }

      updateData.pinHash = await bcrypt.hash(pin, 12);
      updateData.pinHashDevice = pinHashDevice;
    }

    const operator = await prisma.operator.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ ok: true, operator });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (error.message?.includes('Forbidden')) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }
    console.error('Failed to update operator:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/owner/operators/[id]
 * Soft-delete operator (set isActive = false) (OWNER only)
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireOwner();
    const { id } = await params;

    const existing = await prisma.operator.findFirst({ where: { id, ownerId: session.id } });
    if (!existing) {
      return NextResponse.json({ ok: false, error: 'Operator not found' }, { status: 404 });
    }

    // Soft delete - set isActive to false
    await prisma.operator.update({
      where: { id },
      data: { isActive: false },
    });

    return NextResponse.json({ ok: true, message: 'Operator deactivated' });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (error.message?.includes('Forbidden')) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }
    console.error('Failed to delete operator:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
