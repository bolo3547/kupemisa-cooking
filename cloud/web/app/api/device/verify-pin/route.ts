import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyDeviceAuth } from "@/lib/device-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import bcrypt from "bcryptjs";

/**
 * POST /api/device/verify-pin
 * Online PIN verification for devices
 * Used when device doesn't have operator cached or wants real-time verification
 */
export async function POST(request: NextRequest) {
  // Verify device authentication
  const deviceId = request.headers.get("x-device-id");
  const apiKey = request.headers.get("x-api-key");

  if (!deviceId || !apiKey) {
    return NextResponse.json(
      { error: "Missing device credentials" },
      { status: 401 }
    );
  }

  try {
    const authResult = await verifyDeviceAuth(deviceId, apiKey);
    if (!authResult.valid || !authResult.device) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

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
      console.log(`[PIN] Failed verification attempt on device ${deviceId}`);
      
      return NextResponse.json({
        ok: false,
        error: "Invalid PIN",
      });
    }

    // Log successful verification
    console.log(`[PIN] Operator ${operator.name} verified on device ${deviceId}`);

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
