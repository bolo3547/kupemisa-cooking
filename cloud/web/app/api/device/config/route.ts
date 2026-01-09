import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { getCurrentPrice } from "@/lib/price-utils";
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
 * GET /api/device/config
 * Returns device configuration including current pricing
 * Device calls this after operator login to get current price per liter
 */
export async function GET(request: NextRequest) {
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

    const rateLimitResult = checkRateLimit(
      `${authResult.device.deviceId}-config`,
      parseInt(process.env.DEVICE_CONFIG_RATE_LIMIT_MS || "2000", 10)
    );

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: "Rate limited", waitMs: rateLimitResult.waitMs },
        { status: 429 }
      );
    }

    // Update last seen
    await prisma.device.update({
      where: { deviceId: authResult.device.deviceId },
      data: { lastSeenAt: new Date() },
    });

    // Get current pricing
    const price = await getCurrentPrice(authResult.device.deviceId);

    // Check for active LCD display message
    const displayMessage = await prisma.deviceDisplayMessage.findUnique({
      where: { deviceId: authResult.device.deviceId },
    });

    let display = undefined;
    if (displayMessage && displayMessage.expiresAt > new Date()) {
      const ttlSec = Math.floor(
        (displayMessage.expiresAt.getTime() - Date.now()) / 1000
      );
      if (ttlSec > 0) {
        display = {
          line0: displayMessage.line0.substring(0, 16),
          line1: displayMessage.line1.substring(0, 16),
          ttlSec,
        };
      }
    }

    return NextResponse.json({
      ok: true,
      deviceId: authResult.device.deviceId,
      siteName: authResult.device.siteName,
      price: {
        pricePerLiter: price.pricePerLiter,
        costPerLiter: price.costPerLiter,
        currency: price.currency,
      },
      ...(display && { display }),
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("[API] Device config error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
