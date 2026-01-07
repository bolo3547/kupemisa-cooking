/**
 * Price utility functions for determining correct price based on timestamp
 */

import prisma from '@/lib/prisma';

export interface ResolvedPrice {
  pricePerLiter: number;
  costPerLiter: number;
  currency: string;
  scheduleId: string | null;
}

/**
 * Get the applicable price for a device at a specific timestamp
 * 
 * Priority:
 * 1. Device-specific schedule where effectiveFrom <= timestamp < effectiveTo (or effectiveTo null)
 * 2. Global schedule (deviceId null) where effectiveFrom <= timestamp < effectiveTo (or effectiveTo null)
 * 3. If none exist, return price=0, cost=0
 */
export async function getApplicablePrice(
  deviceId: string,
  timestamp: Date
): Promise<ResolvedPrice> {
  // First try device-specific schedule
  const deviceSchedule = await prisma.priceSchedule?.findFirst({
    where: {
      deviceId: deviceId,
      effectiveFrom: { lte: timestamp },
      OR: [
        { effectiveTo: null },
        { effectiveTo: { gt: timestamp } },
      ],
    },
    orderBy: { effectiveFrom: 'desc' },
    select: {
      id: true,
      sellingPricePerLiter: true,
      costPricePerLiter: true,
      currency: true,
    },
  });

  if (deviceSchedule) {
    return {
      pricePerLiter: deviceSchedule.sellingPricePerLiter,
      costPerLiter: deviceSchedule.costPricePerLiter,
      currency: deviceSchedule.currency,
      scheduleId: deviceSchedule.id,
    };
  }

  // Fall back to global schedule
  const globalSchedule = await prisma.priceSchedule?.findFirst({
    where: {
      deviceId: null,
      effectiveFrom: { lte: timestamp },
      OR: [
        { effectiveTo: null },
        { effectiveTo: { gt: timestamp } },
      ],
    },
    orderBy: { effectiveFrom: 'desc' },
    select: {
      id: true,
      sellingPricePerLiter: true,
      costPricePerLiter: true,
      currency: true,
    },
  });

  if (globalSchedule) {
    return {
      pricePerLiter: globalSchedule.sellingPricePerLiter,
      costPerLiter: globalSchedule.costPricePerLiter,
      currency: globalSchedule.currency,
      scheduleId: globalSchedule.id,
    };
  }

  // No schedule found - return zeros
  return {
    pricePerLiter: 0,
    costPerLiter: 0,
    currency: 'ZMW',
    scheduleId: null,
  };
}

/**
 * Get current active price for display purposes
 */
export async function getCurrentPrice(deviceId?: string): Promise<ResolvedPrice> {
  return getApplicablePrice(deviceId || '', new Date());
}

/**
 * Format currency amount
 */
export function formatCurrency(amount: number, currency: string = 'ZMW'): string {
  return new Intl.NumberFormat('en-ZM', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Calculate transaction financials
 */
export function calculateTransactionFinancials(
  dispensedLiters: number,
  pricePerLiter: number,
  costPerLiter: number
): { totalCost: number; totalProfit: number } {
  const totalCost = dispensedLiters * pricePerLiter;
  const totalProfit = dispensedLiters * (pricePerLiter - costPerLiter);
  
  return {
    totalCost: Math.round(totalCost * 100) / 100, // Round to 2 decimal places
    totalProfit: Math.round(totalProfit * 100) / 100,
  };
}
