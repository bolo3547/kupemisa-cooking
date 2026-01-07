import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireOwner } from '@/lib/auth';
import { createPriceScheduleSchema } from '@/lib/validations';

/**
 * GET /api/owner/prices
 * List price schedules (OWNER only)
 * Query params: deviceId (optional) - filter by device, 'global' for global only
 */
export async function GET(request: NextRequest) {
  try {
    await requireOwner();

    const { searchParams } = new URL(request.url);
    const deviceIdParam = searchParams.get('deviceId');

    const where: Record<string, any> = {};
    if (deviceIdParam === 'global') {
      where.deviceId = null;
    } else if (deviceIdParam) {
      where.deviceId = deviceIdParam;
    }

    const schedules = await prisma.priceSchedule?.findMany({
      where,
      select: {
        id: true,
        deviceId: true,
        currency: true,
        sellingPricePerLiter: true,
        costPricePerLiter: true,
        effectiveFrom: true,
        effectiveTo: true,
        createdAt: true,
        device: {
          select: {
            siteName: true,
          },
        },
        createdBy: {
          select: {
            email: true,
          },
        },
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    // Determine which schedule is currently active
    const now = new Date();
    const schedulesWithStatus = schedules.map((s) => {
      const isActive =
        s.effectiveFrom <= now &&
        (s.effectiveTo === null || s.effectiveTo > now);
      return {
        ...s,
        isActive,
        siteName: s.device?.siteName ?? 'Global',
        createdByEmail: s.createdBy.email,
        device: undefined,
        createdBy: undefined,
      };
    });

    return NextResponse.json({ ok: true, schedules: schedulesWithStatus });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (error.message?.includes('Forbidden')) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }
    console.error('Failed to list price schedules:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/owner/prices
 * Create a new price schedule (OWNER only)
 * - Closes existing schedule for same scope by setting effectiveTo = new.effectiveFrom
 * - Prevents overlaps
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireOwner();

    const body = await request.json();
    const parsed = createPriceScheduleSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { deviceId, sellingPricePerLiter, costPricePerLiter, currency, effectiveFrom } = parsed.data;

    // Normalize deviceId: undefined and null both mean global
    const normalizedDeviceId = deviceId ?? null;

    // If deviceId is provided, verify the device exists
    if (normalizedDeviceId) {
      const device = await prisma.device.findUnique({
        where: { deviceId: normalizedDeviceId },
      });
      if (!device) {
        return NextResponse.json(
          { ok: false, error: 'Device not found' },
          { status: 404 }
        );
      }
    }

    // Parse effectiveFrom or default to now
    const effectiveFromDate = effectiveFrom ? new Date(effectiveFrom) : new Date();

    // Use transaction for atomic operations
    const result = await prisma.$transaction(async (tx) => {
      // Find currently open schedule for same scope (effectiveTo is null)
      const openSchedule = await tx.priceSchedule.findFirst({
        where: {
          deviceId: normalizedDeviceId,
          effectiveTo: null,
        },
      });

      // Close the open schedule if it exists and its effectiveFrom is before new effectiveFrom
      if (openSchedule && openSchedule.effectiveFrom < effectiveFromDate) {
        await tx.priceSchedule.update({
          where: { id: openSchedule.id },
          data: { effectiveTo: effectiveFromDate },
        });
      }

      // Check for overlapping schedules (excluding the one we just closed)
      const overlapping = await tx.priceSchedule.findFirst({
        where: {
          deviceId: normalizedDeviceId,
          effectiveFrom: { lt: effectiveFromDate },
          OR: [
            { effectiveTo: null },
            { effectiveTo: { gt: effectiveFromDate } },
          ],
          id: openSchedule ? { not: openSchedule.id } : undefined,
        },
      });

      if (overlapping) {
        throw new Error('Overlapping price schedule exists');
      }

      // Create new schedule
      const schedule = await tx.priceSchedule.create({
        data: {
          deviceId: normalizedDeviceId,
          currency: currency || 'ZMW',
          sellingPricePerLiter,
          costPricePerLiter: costPricePerLiter || 0,
          effectiveFrom: effectiveFromDate,
          effectiveTo: null, // Open-ended
          createdByUserId: user.id,
        },
        select: {
          id: true,
          deviceId: true,
          currency: true,
          sellingPricePerLiter: true,
          costPricePerLiter: true,
          effectiveFrom: true,
          effectiveTo: true,
          createdAt: true,
        },
      });

      return schedule;
    });

    return NextResponse.json({ ok: true, schedule: result }, { status: 201 });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (error.message?.includes('Forbidden')) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    }
    if (error.message === 'Overlapping price schedule exists') {
      return NextResponse.json(
        { ok: false, error: 'Overlapping price schedule exists for this scope' },
        { status: 409 }
      );
    }
    console.error('Failed to create price schedule:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
