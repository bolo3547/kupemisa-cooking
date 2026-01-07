import { z } from 'zod';

export const telemetrySchema = z.object({
  deviceId: z.string().min(1).max(50).optional(), // Optional - validated from header
  siteName: z.string().min(1).max(100).optional(), // Optional - can be provided
  ts: z.number().int().positive(),
  oilPercent: z.number().min(0).max(100),
  oilLiters: z.number().min(0),
  distanceCm: z.number().min(0),
  flowLpm: z.number().min(0),
  litersTotal: z.number().min(0),
  pumpState: z.boolean(),
  safetyStatus: z.string().max(50),
  wifiRssi: z.number().int().min(-100).max(0),
  uptimeSec: z.number().int().min(0),
});

export const eventSchema = z.object({
  deviceId: z.string().min(1).max(50).optional(), // Optional - validated from header
  ts: z.number().int().positive(),
  type: z.string().min(1).max(50),
  severity: z.enum(['INFO', 'WARN', 'CRITICAL']),
  message: z.string().min(1).max(500),
  metaJson: z.record(z.any()).optional(),
});

export const provisionDeviceSchema = z.object({
  siteName: z.string().min(1).max(100),
  location: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
});

export const commandSchema = z.object({
  type: z.enum(['PUMP_ON', 'PUMP_OFF', 'DISPENSE_TARGET', 'SET_PRICE_PER_LITER']),
  payloadJson: z
    .object({
      liters: z.number().positive().optional(),
      price: z.number().min(0).max(10000).optional(),
    })
    .optional(),
});

export const commandAckSchema = z.object({
  commandId: z.string().min(1),
  executedAt: z.number().int().positive().optional(),
  ok: z.boolean(),
  message: z.string().max(500).optional(),
  metaJson: z.record(z.any()).optional(),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

// ========================
// OPERATOR SCHEMAS
// ========================

export const createOperatorSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  pin: z.string().min(4, 'PIN must be at least 4 digits').max(8).regex(/^\d+$/, 'PIN must be numeric'),
  role: z.enum(['OPERATOR', 'SUPERVISOR']).default('OPERATOR'),
});

export const updateOperatorSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  pin: z.string().min(4).max(8).regex(/^\d+$/, 'PIN must be numeric').optional(),
  role: z.enum(['OPERATOR', 'SUPERVISOR']).optional(),
  isActive: z.boolean().optional(),
});

// ========================
// PRICE SCHEDULE SCHEMAS
// ========================

export const createPriceScheduleSchema = z.object({
  deviceId: z.string().nullable().optional(), // null = global
  sellingPricePerLiter: z.number().min(0).max(10000),
  costPricePerLiter: z.number().min(0).max(10000).default(0),
  currency: z.string().default('ZMW'),
  effectiveFrom: z.string().datetime().optional(), // ISO string, defaults to now
});

// ========================
// RECEIPT INGEST SCHEMA
// ========================

export const receiptIngestSchema = z.object({
  sessionId: z.string().min(1).max(100),
  operatorPin: z.string().optional(),
  operatorId: z.string().optional(),
  targetLiters: z.number().min(0),
  dispensedLiters: z.number().min(0),
  durationSec: z.number().int().min(0),
  status: z.enum(['DONE', 'ERROR', 'CANCELED']),
  errorMessage: z.string().max(500).optional(),
  startedAtUnix: z.number().int().positive(),
  endedAtUnix: z.number().int().positive().optional(),
});

// ========================
// QUERY SCHEMAS
// ========================

export const transactionsQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  deviceId: z.string().optional(),
  operatorId: z.string().optional(),
  status: z.enum(['STARTED', 'DONE', 'ERROR', 'CANCELED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const shiftsQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  deviceId: z.string().optional(),
  operatorId: z.string().optional(),
});

export const profitQuerySchema = z.object({
  range: z.enum(['7d', '30d', 'custom']).default('30d'),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  deviceId: z.string().optional(),
});

export type TelemetryInput = z.infer<typeof telemetrySchema>;
export type EventInput = z.infer<typeof eventSchema>;
export type ProvisionDeviceInput = z.infer<typeof provisionDeviceSchema>;
export type CommandInput = z.infer<typeof commandSchema>;
export type CommandAckInput = z.infer<typeof commandAckSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateOperatorInput = z.infer<typeof createOperatorSchema>;
export type UpdateOperatorInput = z.infer<typeof updateOperatorSchema>;
export type CreatePriceScheduleInput = z.infer<typeof createPriceScheduleSchema>;
export type ReceiptIngestInput = z.infer<typeof receiptIngestSchema>;
export type TransactionsQueryInput = z.infer<typeof transactionsQuerySchema>;
export type ShiftsQueryInput = z.infer<typeof shiftsQuerySchema>;
export type ProfitQueryInput = z.infer<typeof profitQuerySchema>;
