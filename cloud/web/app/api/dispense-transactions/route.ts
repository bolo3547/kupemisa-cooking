import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { transactionsQuerySchema } from '@/lib/validations';

/**
 * GET /api/dispense-transactions
 * List dispense transactions with pagination and filters
 */
export async function GET(request: NextRequest) {
  try {
    await requireAuth();

    const { searchParams } = new URL(request.url);
    const query = {
      from: searchParams.get('from') || undefined,
      to: searchParams.get('to') || undefined,
      deviceId: searchParams.get('deviceId') || undefined,
      operatorId: searchParams.get('operatorId') || undefined,
      status: searchParams.get('status') || undefined,
      page: searchParams.get('page') || '1',
      limit: searchParams.get('limit') || '20',
    };

    const parsed = transactionsQuerySchema.safeParse(query);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { from, to, deviceId, operatorId, status, page, limit } = parsed.data;

    // Build where clause
    const where: Record<string, any> = {};

    if (from) {
      where.startedAt = { gte: new Date(from) };
    }

    if (to) {
      where.startedAt = {
        ...where.startedAt,
        lte: new Date(to),
      };
    }

    if (deviceId) {
      where.deviceId = deviceId;
    }

    if (operatorId) {
      where.operatorId = operatorId;
    }

    if (status) {
      where.status = status;
    }

    // Get total count
    const total = await prisma.dispenseTransaction.count({ where });

    // Get transactions
    const transactions = await prisma.dispenseTransaction.findMany({
      where,
      select: {
        id: true,
        sessionId: true,
        deviceId: true,
        operatorId: true,
        startedAt: true,
        endedAt: true,
        status: true,
        targetLiters: true,
        dispensedLiters: true,
        pricePerLiter: true,
        costPerLiter: true,
        totalCost: true,
        totalProfit: true,
        currency: true,
        durationSec: true,
        errorMessage: true,
        device: {
          select: {
            siteName: true,
            location: true,
          },
        },
        operator: {
          select: {
            name: true,
            role: true,
          },
        },
      },
      orderBy: { startedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });

    // Format response
    const formattedTransactions = transactions.map((tx) => ({
      ...tx,
      siteName: tx.device.siteName,
      location: tx.device.location,
      operatorName: tx.operator?.name || null,
      operatorRole: tx.operator?.role || null,
      device: undefined,
      operator: undefined,
    }));

    return NextResponse.json({
      ok: true,
      transactions: formattedTransactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Failed to list dispense transactions:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
