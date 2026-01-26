import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import bcrypt from "bcryptjs";

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

/**
 * POST /api/device/verify-pin
 * Online PIN verification for devices
 * Used when device doesn't have operator cached or wants real-time verification
 */
export async function POST(request: NextRequest) {
  try {
    // Verify device authentication
    const dev = await requireDevice(request);
    if (!dev) {
      return NextResponse.json(
        { ok: false, error: "UNAUTHORIZED" },
        { status: 401 }
      );
    }

    const authResult = { device: dev, valid: true };

    if (!authResult.device.ownerId) {
      return NextResponse.json(
        { error: "Device is not linked to an owner" },
        { status: 403 }
      );
    }

    const rateLimitResult = checkRateLimit(
      `${authResult.device.deviceId}-verify-pin`,
      parseInt(process.env.DEVICE_PIN_RATE_LIMIT_MS || "1000", 10)
    );

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { ok: false, error: "Rate limited", waitMs: rateLimitResult.waitMs },
        { status: 429 }
      );
    }

    await prisma.device.update({
      where: { deviceId: authResult.device.deviceId },
      data: { lastSeenAt: new Date() },
    });

    // Parse request body
    const body = await request.json();
    const { pin } = body;

    if (!pin || typeof pin !== "string") {
      return NextResponse.json(
        { ok: false, error: "PIN required" },
        { status: 400 }
      );
    }

    const operators = await prisma.operator.findMany({
      where: {
        ownerId: authResult.device.ownerId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        role: true,
        isActive: true,
        pinHash: true,
      },
    });

    let operator: { id: string; name: string; role: string; isActive: boolean } | null = null;
    for (const op of operators) {
      const pinValid = await bcrypt.compare(pin, op.pinHash);
      if (pinValid) {
        operator = {
          id: op.id,
          name: op.name,
          role: op.role,
          isActive: op.isActive,
        };
        break;
      }
    }

    if (!operator) {
      // Log failed attempt
      console.log(`[PIN] Failed verification attempt on device ${authResult.device.deviceId}`);
      
      return NextResponse.json({
        ok: false,
        error: "Invalid PIN",
      });
    }

    // Log successful verification
    console.log(`[PIN] Operator ${operator.name} verified on device ${authResult.device.deviceId}`);

    return NextResponse.json({
      ok: true,
      operator: {
        id: operator.id,
        name: operator.name,
        role: operator.role,
        isActive: operator.isActive,
      },
    });
  } catch (error) {
    console.error("[API] PIN verification error:", error);
    return NextResponse.json(
      { error: "Verification failed" },
      { status: 500 }
    );
  }
}
