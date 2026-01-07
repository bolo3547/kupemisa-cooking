/**
 * Utility functions for parsing dispense event metadata
 */

export interface DispenseEventMeta {
  targetLiters?: number;
  dispensedLiters?: number;
  durationSec?: number;
  transactionId?: number;
  sessionId?: string;
  error?: string;
  // Pricing fields
  pricePerLiter?: number;
  totalCost?: number;
  currency?: string;
}

export interface DispenserStateMeta {
  dispenserState?: string;
  transactionCounter?: number;
  targetLiters?: number;
  dispensedLiters?: number;
  // Pricing fields
  pricePerLiter?: number;
  totalCost?: number;
  currency?: string;
}

export type DispenseEventType = 
  | 'DISPENSE_DONE' 
  | 'DISPENSE_ERROR' 
  | 'DISPENSE_START' 
  | 'DISPENSE_PAUSE' 
  | 'DISPENSE_RESUME'
  | 'DISPENSE_RECEIPT';

export const DISPENSE_EVENT_TYPES: DispenseEventType[] = [
  'DISPENSE_DONE',
  'DISPENSE_ERROR',
  'DISPENSE_START',
  'DISPENSE_PAUSE',
  'DISPENSE_RESUME',
  'DISPENSE_RECEIPT',
];

/**
 * Safely parse metaJson from Event record
 */
export function parseDispenseEventMeta(metaJson: unknown): DispenseEventMeta {
  if (!metaJson || typeof metaJson !== 'object') {
    return {};
  }
  
  const meta = metaJson as Record<string, unknown>;
  
  return {
    targetLiters: typeof meta.targetLiters === 'number' ? meta.targetLiters : undefined,
    dispensedLiters: typeof meta.dispensedLiters === 'number' ? meta.dispensedLiters : undefined,
    durationSec: typeof meta.durationSec === 'number' ? meta.durationSec : undefined,
    transactionId: typeof meta.transactionId === 'number' ? meta.transactionId : undefined,
    sessionId: typeof meta.sessionId === 'string' ? meta.sessionId : undefined,
    error: typeof meta.error === 'string' ? meta.error : undefined,
    pricePerLiter: typeof meta.pricePerLiter === 'number' ? meta.pricePerLiter : undefined,
    totalCost: typeof meta.totalCost === 'number' ? meta.totalCost : undefined,
    currency: typeof meta.currency === 'string' ? meta.currency : undefined,
  };
}

/**
 * Safely parse dispenser state from telemetry meta
 */
export function parseDispenserStateMeta(meta: unknown): DispenserStateMeta {
  if (!meta || typeof meta !== 'object') {
    return {};
  }
  
  const m = meta as Record<string, unknown>;
  
  return {
    dispenserState: typeof m.dispenserState === 'string' ? m.dispenserState : undefined,
    transactionCounter: typeof m.transactionCounter === 'number' ? m.transactionCounter : undefined,
    targetLiters: typeof m.targetLiters === 'number' ? m.targetLiters : undefined,
    dispensedLiters: typeof m.dispensedLiters === 'number' ? m.dispensedLiters : undefined,
    pricePerLiter: typeof m.pricePerLiter === 'number' ? m.pricePerLiter : undefined,
    totalCost: typeof m.totalCost === 'number' ? m.totalCost : undefined,
    currency: typeof m.currency === 'string' ? m.currency : undefined,
  };
}

/**
 * Check if an event type is a dispense event
 */
export function isDispenseEvent(type: string): boolean {
  return DISPENSE_EVENT_TYPES.includes(type as DispenseEventType);
}

/**
 * Get human-readable dispense status
 */
export function getDispenseStatusLabel(type: string): string {
  switch (type) {
    case 'DISPENSE_DONE':
      return 'Completed';
    case 'DISPENSE_ERROR':
      return 'Error';
    case 'DISPENSE_START':
      return 'Started';
    case 'DISPENSE_PAUSE':
      return 'Paused';
    case 'DISPENSE_RESUME':
      return 'Resumed';
    default:
      return type;
  }
}

/**
 * Format duration in seconds to human readable
 */
export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || seconds === null) return '--';
  
  if (seconds < 60) {
    return `${seconds}s`;
  }
  
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  
  if (mins < 60) {
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }
  
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h ${remainMins}m`;
}

/**
 * Get dispenser state badge color
 */
export function getDispenserStateColor(state: string | undefined): string {
  switch (state) {
    case 'IDLE_READY':
      return 'bg-green-100 text-green-800 border-green-200';
    case 'ENTER_TARGET':
    case 'AUTH_PIN':
    case 'PRECHECK':
      return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'DISPENSING':
      return 'bg-cyan-100 text-cyan-800 border-cyan-200';
    case 'PAUSED':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'DONE':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    case 'ERROR':
      return 'bg-red-100 text-red-800 border-red-200';
    case 'CALIBRATION':
      return 'bg-purple-100 text-purple-800 border-purple-200';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-200';
  }
}

/**
 * Get human-readable state label
 */
export function getDispenserStateLabel(state: string | undefined): string {
  switch (state) {
    case 'IDLE_READY':
      return 'Ready';
    case 'ENTER_TARGET':
      return 'Entering Amount';
    case 'AUTH_PIN':
      return 'Authenticating';
    case 'PRECHECK':
      return 'Pre-check';
    case 'DISPENSING':
      return 'Dispensing';
    case 'PAUSED':
      return 'Paused';
    case 'DONE':
      return 'Complete';
    case 'ERROR':
      return 'Error';
    case 'CALIBRATION':
      return 'Calibrating';
    case 'ADMIN_PRICE':
      return 'Setting Price';
    default:
      return state || 'Unknown';
  }
}

/**
 * Format currency amount
 */
export function formatCurrency(amount: number | undefined, currency: string = 'ZMW'): string {
  if (amount === undefined || amount === null) return '--';
  return `${currency} ${amount.toFixed(2)}`;
}

/**
 * Generate receipt text for download/copy
 */
export function generateReceiptText(
  transaction: {
    siteName: string;
    deviceId: string;
    targetLiters?: number;
    dispensedLiters?: number;
    pricePerLiter?: number;
    totalCost?: number;
    currency?: string;
    durationSec?: number;
    transactionId?: number;
    timestamp: Date | string;
    result: 'SUCCESS' | 'ERROR';
    error?: string;
  }
): string {
  const curr = transaction.currency || 'ZMW';
  const date = new Date(transaction.timestamp);
  const lines = [
    '================================',
    '    OIL DISPENSE RECEIPT',
    '================================',
    '',
    `Site:     ${transaction.siteName}`,
    `Device:   ${transaction.deviceId}`,
    `Date:     ${date.toLocaleDateString()}`,
    `Time:     ${date.toLocaleTimeString()}`,
    '',
    '--------------------------------',
    '',
    `Price/L:   ${curr} ${(transaction.pricePerLiter ?? 0).toFixed(2)}`,
    `Target:    ${(transaction.targetLiters ?? 0).toFixed(2)} L`,
    `Dispensed: ${(transaction.dispensedLiters ?? 0).toFixed(2)} L`,
    '',
    '--------------------------------',
    '',
    `TOTAL:     ${curr} ${(transaction.totalCost ?? 0).toFixed(2)}`,
    '',
    '--------------------------------',
    '',
    `Status:    ${transaction.result === 'SUCCESS' ? 'COMPLETED' : 'ERROR'}`,
    transaction.result === 'ERROR' && transaction.error ? `Error:     ${transaction.error}` : '',
    `Duration:  ${transaction.durationSec ?? 0} sec`,
    `TX #:      ${transaction.transactionId ?? 'N/A'}`,
    '',
    '================================',
    '       Thank you!',
    '================================',
  ].filter(line => line !== undefined && line !== '');
  
  return lines.join('\n');
}
