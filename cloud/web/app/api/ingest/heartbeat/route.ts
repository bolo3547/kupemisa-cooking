import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { checkRateLimit } from '@/lib/rate-limit';

export const runtime = "nodejs";

/**
 * Device authentication helper
 */
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

/**
 * POST /api/ingest/heartbeat
 * Device heartbeat to update lastSeenAt and confirm online status
 * 
 * Auth: x-device-id / x-api-key headers
 * 
 * Body:
 *   {
 *     "deviceId": "OIL-0001",
 *     "siteName": "PHI",
 *     "status": "idle|dispensing",
 *     "uptime": 12345
 *   }
 */
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

    // Rate limit heartbeats (max 1 per 5 seconds)
    const rateLimitResult = checkRateLimit(
      `${dev.deviceId}-heartbeat`,
      5000 // 5 second minimum between heartbeats
    );

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { ok: true, message: 'Rate limited, but acknowledged' }
      );
    }

    // Parse body (optional - we mainly care about updating lastSeenAt)
    let body: { status?: string; uptime?: number; siteName?: string } = {};
    try {
      body = await request.json();
    } catch {
      // Empty body is fine
    }

    // Update device lastSeenAt and optionally siteName
    const updateData: { lastSeenAt: Date; siteName?: string } = {
      lastSeenAt: new Date(),
    };

    // Update siteName if provided and different
    if (body.siteName && body.siteName !== dev.siteName) {
      updateData.siteName = body.siteName;
    }

    await prisma.device.update({
      where: { deviceId: dev.deviceId },
      data: updateData,
    });

    console.log(`[HEARTBEAT] ${dev.deviceId} - status: ${body.status || 'unknown'}, uptime: ${body.uptime || 0}s`);

    return NextResponse.json({
      ok: true,
      serverTime: Date.now(),
    });

  } catch (error) {
    console.error('[HEARTBEAT] Error:', error);
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
