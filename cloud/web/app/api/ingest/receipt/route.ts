import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { receiptIngestSchema } from '@/lib/validations';
import { getApplicablePrice, calculateTransactionFinancials } from '@/lib/price-utils';
import { verifyDeviceAuth } from '@/lib/device-auth';
import bcrypt from 'bcryptjs';

/**
 * POST /api/ingest/receipt
 * Record a dispense transaction from device
 * 
 * Auth: x-device-id / x-api-key headers
 */
export async function POST(request: NextRequest) {
  try {
    // Verify device authentication
    const deviceId = request.headers.get('x-device-id');
    const apiKey = request.headers.get('x-api-key');
    const authResult = await verifyDeviceAuth(deviceId, apiKey);
    if (!authResult.valid || !authResult.device) {
      return NextResponse.json(
        { ok: false, error: 'Invalid device credentials' },
        { status: 401 }
      );
    }

    const authedDeviceId = authResult.device.deviceId;
    const ownerId = authResult.device.ownerId ?? null;

    // Update device lastSeenAt
    await prisma.device.update({
      where: { deviceId: authedDeviceId },
      data: { lastSeenAt: new Date() },
    });

    // Parse and validate body
    const body = await request.json();
    const parsed = receiptIngestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const {
      sessionId,
      operatorPin,
      operatorId: providedOperatorId,
      targetLiters,
      dispensedLiters,
      durationSec,
      status,
      errorMessage,
      startedAtUnix,
      endedAtUnix,
    } = parsed.data;

    // Convert Unix timestamps to Date
    const startedAt = new Date(startedAtUnix * 1000);
    const endedAt = endedAtUnix ? new Date(endedAtUnix * 1000) : new Date();

    // Resolve operator ID
    let operatorId: string | null = null;

    if (providedOperatorId && ownerId) {
      // Device provided operatorId directly
      const operator = await prisma.operator.findFirst({
        where: { id: providedOperatorId, ownerId, isActive: true },
      });
      if (operator && operator.isActive) {
        operatorId = operator.id;
      }
    } else if (operatorPin && ownerId) {
      // Verify operator PIN
      const operators = await prisma.operator.findMany({
        where: { ownerId, isActive: true },
        select: { id: true, pinHash: true },
      });

      for (const op of operators) {
        const pinValid = await bcrypt.compare(operatorPin, op.pinHash);
        if (pinValid) {
          operatorId = op.id;
          break;
        }
      }

      if (!operatorId) {
        // Invalid PIN - could reject or continue without operator
        // For now, continue without operator but log warning
        console.warn(`Invalid operator PIN provided for session ${sessionId}`);
      }
    } else if (operatorPin && !ownerId) {
      console.warn(`Operator PIN provided but device ${authedDeviceId} has no ownerId`);
    }

    // Get applicable price based on transaction timestamp
    const price = await getApplicablePrice(authedDeviceId, startedAt);

    // Calculate financials
    const { totalCost, totalProfit } = calculateTransactionFinancials(
      dispensedLiters,
      price.pricePerLiter,
      price.costPerLiter
    );

    // Map status
    const statusMap: Record<string, 'DONE' | 'ERROR' | 'CANCELED'> = {
      DONE: 'DONE',
      ERROR: 'ERROR',
      CANCELED: 'CANCELED',
    };

    // Check if transaction already exists (idempotency)
    const existing = await prisma.dispenseTransaction.findUnique({
      where: { sessionId },
    });

    if (existing) {
      // Update existing transaction
      const transaction = await prisma.dispenseTransaction.update({
        where: { sessionId },
        data: {
          endedAt,
          status: statusMap[status],
          dispensedLiters,
          durationSec,
          errorMessage: errorMessage || null,
          // Only update financials if not already set
          ...(existing.pricePerLiter === 0
            ? {
                pricePerLiter: price.pricePerLiter,
                costPerLiter: price.costPerLiter,
                totalCost,
                totalProfit,
                currency: price.currency,
              }
            : {}),
        },
      });

      return NextResponse.json({
        ok: true,
        transaction: {
          id: transaction.id,
          sessionId: transaction.sessionId,
          status: transaction.status,
        },
        updated: true,
      });
    }

    // Create new transaction
    const transaction = await prisma.dispenseTransaction.create({
      data: {
        deviceId: authedDeviceId,
        operatorId,
        sessionId,
        startedAt,
        endedAt,
        status: statusMap[status],
        targetLiters,
        dispensedLiters,
        pricePerLiter: price.pricePerLiter,
        costPerLiter: price.costPerLiter,
        totalCost,
        totalProfit,
        currency: price.currency,
        durationSec,
        errorMessage: errorMessage || null,
      },
    });

    // Also create Event for backward compatibility
    await prisma.event.create({
      data: {
        deviceId: authedDeviceId,
        ts: BigInt(endedAtUnix || startedAtUnix) * BigInt(1000),
        type: 'DISPENSE_RECEIPT',
        severity: status === 'ERROR' ? 'WARN' : 'INFO',
        message: `Dispense ${status.toLowerCase()}: ${dispensedLiters.toFixed(2)}L at ${price.currency} ${price.pricePerLiter.toFixed(2)}/L`,
        metaJson: {
          sessionId,
          operatorId,
          targetLiters,
          dispensedLiters,
          durationSec,
          pricePerLiter: price.pricePerLiter,
          costPerLiter: price.costPerLiter,
          totalCost,
          totalProfit,
          currency: price.currency,
          status,
          errorMessage,
        },
      },
    });

    // Update shift summary (async, don't wait)
    updateShiftSummary(authedDeviceId, operatorId, startedAt, {
      liters: dispensedLiters,
      sales: totalCost,
      profit: totalProfit,
      currency: price.currency,
    }).catch((err) => console.error('Failed to update shift summary:', err));

    return NextResponse.json(
      {
        ok: true,
        transaction: {
          id: transaction.id,
          sessionId: transaction.sessionId,
          status: transaction.status,
          pricePerLiter: price.pricePerLiter,
          totalCost,
          totalProfit,
        },
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('Failed to process receipt:', error);
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Update shift summary for reporting
 */
async function updateShiftSummary(
  deviceId: string,
  operatorId: string | null,
  transactionDate: Date,
  data: {
    liters: number;
    sales: number;
    profit: number;
    currency: string;
  }
): Promise<void> {
  // Use a sentinel to keep shift summary unique when operatorId is missing.
  const operatorKey = operatorId ?? 'UNASSIGNED';

  // Normalize to date at 00:00
  const shiftDate = new Date(transactionDate);
  shiftDate.setHours(0, 0, 0, 0);

  await prisma.shiftSummary.upsert({
    where: {
      deviceId_operatorId_shiftDate: {
        deviceId,
        operatorId: operatorKey,
        shiftDate,
      },
    },
    create: {
      deviceId,
      operatorId: operatorKey,
      shiftDate,
      totalTransactions: 1,
      totalLiters: data.liters,
      totalSales: data.sales,
      totalProfit: data.profit,
      currency: data.currency,
    },
    update: {
      totalTransactions: { increment: 1 },
      totalLiters: { increment: data.liters },
      totalSales: { increment: data.sales },
      totalProfit: { increment: data.profit },
    },
  });
}
