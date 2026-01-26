import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import bcrypt from "bcryptjs";

export const runtime = "nodejs";

async function requireDevice(req: NextRequest) {
  const deviceId = req.headers.get("x-device-id") || "";
  const apiKey = req.headers.get("x-api-key") || "";
  
  console.log(`[PIN] Auth attempt from device: ${deviceId}`);
  
  if (!deviceId || !apiKey) {
    console.log("[PIN] Missing credentials");
    return null;
  }

  const dev = await prisma.device.findUnique({ where: { deviceId } });
  if (!dev) {
    console.log(`[PIN] Device not found: ${deviceId}`);
    return null;
  }
  
  const isValid = await bcrypt.compare(apiKey, dev.apiKeyHash);
  if (!isValid) {
    console.log(`[PIN] Invalid API key for device: ${deviceId}`);
    return null;
  }
  
  return dev;
}

/**
 * POST /api/device/verify-pin
 * Online PIN verification for devices
 * 
 * Accepts either:
 *   - { pin: "1234" } - raw PIN (bcrypt compared)
 *   - { pinHash: "sha256..." } - SHA256 hash (compared with pinHashDevice)
 * 
 * Returns:
 *   - { ok: true, operatorId, name, role } on success
 *   - { ok: false, error } on failure
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

    if (!dev.ownerId) {
      console.log(`[PIN] Device ${dev.deviceId} has no owner`);
      return NextResponse.json(
        { ok: false, error: "Device is not linked to an owner" },
        { status: 403 }
      );
    }

    const rateLimitResult = checkRateLimit(
      `${dev.deviceId}-verify-pin`,
      parseInt(process.env.DEVICE_PIN_RATE_LIMIT_MS || "500", 10)
    );

    if (!rateLimitResult.allowed) {
      console.log(`[PIN] Rate limited: ${dev.deviceId}`);
      return NextResponse.json(
        { ok: false, error: "Rate limited", waitMs: rateLimitResult.waitMs },
        { status: 429 }
      );
    }

    await prisma.device.update({
      where: { deviceId: dev.deviceId },
      data: { lastSeenAt: new Date() },
    });

    // Parse request body
    const body = await request.json();
    const { pin, pinHash } = body;

    console.log(`[PIN] Verification request - pin: ${pin ? "provided" : "no"}, pinHash: ${pinHash ? pinHash.substring(0, 8) + "..." : "no"}`);

    if (!pin && !pinHash) {
      return NextResponse.json(
        { ok: false, error: "PIN or pinHash required" },
        { status: 400 }
      );
    }

    const operators = await prisma.operator.findMany({
      where: {
        ownerId: dev.ownerId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        role: true,
        isActive: true,
        pinHash: true,
        pinHashDevice: true,
      },
    });

    console.log(`[PIN] Checking ${operators.length} operators for owner ${dev.ownerId}`);

    let matchedOperator: { id: string; name: string; role: string } | null = null;

    for (const op of operators) {
      let isMatch = false;

      if (pinHash && op.pinHashDevice) {
        // SHA256 hash comparison (from ESP32)
        isMatch = (pinHash === op.pinHashDevice);
        if (isMatch) {
          console.log(`[PIN] SHA256 match for operator ${op.name}`);
        }
      } else if (pin) {
        // Bcrypt comparison (from other clients)
        isMatch = await bcrypt.compare(pin, op.pinHash);
        if (isMatch) {
          console.log(`[PIN] Bcrypt match for operator ${op.name}`);
        }
      }

      if (isMatch) {
        matchedOperator = {
          id: op.id,
          name: op.name,
          role: op.role,
        };
        break;
      }
    }

    if (!matchedOperator) {
      console.log(`[PIN] FAILED verification on device ${dev.deviceId}`);
      return NextResponse.json({
        ok: false,
        error: "Invalid PIN",
      });
    }

    console.log(`[PIN] SUCCESS: ${matchedOperator.name} (${matchedOperator.role}) on ${dev.deviceId}`);

    return NextResponse.json({
      ok: true,
      operatorId: matchedOperator.id,
      name: matchedOperator.name,
      role: matchedOperator.role,
    });
  } catch (error) {
    console.error("[PIN] Verification error:", error);
    return NextResponse.json(
      { ok: false, error: "Verification failed" },
      { status: 500 }
    );
  }
}
