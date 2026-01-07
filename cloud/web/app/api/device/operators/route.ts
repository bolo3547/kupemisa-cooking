import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyDeviceAuth } from "@/lib/device-auth";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * GET /api/device/operators
 * Returns list of active operators for device to cache locally
 * This endpoint sends hashed PINs for offline verification on device
 */
export async function GET(request: NextRequest) {
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
      `${authResult.device.deviceId}-operators`,
      parseInt(process.env.DEVICE_OPERATORS_RATE_LIMIT_MS || "2000", 10)
    );

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: "Rate limited", waitMs: rateLimitResult.waitMs },
        { status: 429 }
      );
    }

    await prisma.device.update({
      where: { deviceId: authResult.device.deviceId },
      data: { lastSeenAt: new Date() },
    });

    // Get all active operators for this owner
    const operators = await prisma.operator.findMany({
      where: {
        ownerId: authResult.device.ownerId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        pinHashDevice: true,
        isActive: true,
        role: true,
      },
      orderBy: {
        name: "asc",
      },
    });

    return NextResponse.json({
      ok: true,
      operators: operators.map((op) => ({
        id: op.id,
        name: op.name,
        pinHash: op.pinHashDevice,
        isActive: op.isActive,
        role: op.role,
      })),
      count: operators.length,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[API] Device operators sync error:", error);
    return NextResponse.json(
      { error: "Failed to fetch operators" },
      { status: 500 }
    );
  }
}
