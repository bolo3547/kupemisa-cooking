import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { checkRateLimit } from '@/lib/rate-limit';
import { telemetrySchema } from '@/lib/validations';
import { evaluateAndNotify } from '@/lib/alerts';
import { DeviceStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

export const runtime = "nodejs";

async function requireDevice(req: NextRequest) {
  const deviceId = req.headers.get("x-device-id") || "";
  const apiKey = req.headers.get("x-api-key") || "";
  if (!deviceId || !apiKey) return null;

  const dev = await prisma.device.findUnique({ where: { deviceId } });
  if (!dev) return null;
  
  const isValid = await bcrypt.compare(apiKey, dev.apiKeyHash);
  if (!isValid) return null;
  
  return dev;
}

export async function POST(request: NextRequest) {
  try {
    // Verify device authentication
    const dev = await requireDevice(request);
    if (!dev) {
      return NextResponse.json(
        { ok: false, error: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }

    const authResult = { device: dev, valid: true };

    // Check rate limit
    const rateLimitResult = checkRateLimit(authResult.device.deviceId);
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { ok: false, error: 'Rate limited', waitMs: rateLimitResult.waitMs },
        { status: 429 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const validation = telemetrySchema.safeParse(body);
    
    if (!validation.success) {
      return NextResponse.json(
        { ok: false, error: 'Invalid payload', details: validation.error.issues },
        { status: 400 }
      );
    }

    const data = validation.data;

    // Get current device status BEFORE updating (for threshold crossing detection)
    const currentDevice = await prisma.device.findUnique({
      where: { deviceId: authResult.device.deviceId },
      select: { status: true },
    });
    const previousStatus = currentDevice?.status ?? DeviceStatus.OFFLINE;

    // Get alert rule for this device (device-specific or global)
    const alertRule = await prisma.alertRule.findFirst({
      where: {
        OR: [
          { deviceId: authResult.device.deviceId },
          { deviceId: null }, // Global rule
        ],
        enabled: true,
      },
      orderBy: {
        deviceId: 'desc', // Prefer device-specific rule
      },
    });

    // Determine new device status based on oil percent and thresholds
    let newStatus: DeviceStatus = DeviceStatus.OK;
    if (alertRule) {
      if (data.oilPercent < alertRule.criticalThreshold) {
        newStatus = DeviceStatus.CRITICAL;
      } else if (data.oilPercent < alertRule.lowThreshold) {
        newStatus = DeviceStatus.LOW;
      }
    }

    // Insert telemetry and update device in a transaction
    await prisma.$transaction([
      prisma.telemetry.create({
        data: {
          deviceId: authResult.device.deviceId,
          ts: BigInt(data.ts),
          oilPercent: data.oilPercent,
          oilLiters: data.oilLiters,
          distanceCm: data.distanceCm,
          flowLpm: data.flowLpm,
          litersTotal: data.litersTotal,
          pumpState: data.pumpState,
          safetyStatus: data.safetyStatus,
          wifiRssi: data.wifiRssi,
          uptimeSec: data.uptimeSec,
        },
      }),
      prisma.device.update({
        where: { deviceId: authResult.device.deviceId },
        data: {
          lastSeenAt: new Date(),
          status: newStatus,
        },
      }),
    ]);

    // Evaluate alerts asynchronously (don't block response)
    // This handles threshold crossings, safety events, and deduplication
    if (alertRule) {
      evaluateAndNotify(
        {
          deviceId: authResult.device.deviceId,
          siteName: authResult.device.siteName,
          currentStatus: previousStatus, // Use previous status for crossing detection
        },
        {
          oilPercent: data.oilPercent,
          safetyStatus: data.safetyStatus,
        },
        alertRule
      ).catch((err) => console.error('Alert evaluation error:', err));
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Telemetry ingest error:', error);
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
