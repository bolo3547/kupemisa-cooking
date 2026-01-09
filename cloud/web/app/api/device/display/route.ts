import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { z } from "zod";
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
 * POST /api/device/display
 * Set or clear LCD display message for a device
 * Admin-only endpoint (called from dashboard)
 */

const displaySchema = z.object({
  line0: z.string().max(16),
  line1: z.string().max(16),
  ttlSec: z.number().int().min(0).max(3600),
});

export async function POST(request: NextRequest) {
  try {
    const dev = await requireDevice(request);
    if (!dev) {
      return NextResponse.json(
        { ok: false, error: "UNAUTHORIZED" },
        { status: 401 }
      );
    }

    const authResult = { device: dev, valid: true };

    const body = await request.json();
    
    // Validate input
    const result = displaySchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid input", details: result.error.errors },
        { status: 400 }
      );
    }

    const { line0, line1, ttlSec } = result.data;

    if (ttlSec === 0) {
      // Clear message
      await prisma.deviceDisplayMessage.deleteMany({
        where: { deviceId: authResult.device.deviceId },
      });
      return NextResponse.json({
        ok: true,
        message: "Display message cleared",
      });
    }

    // Set/update message
    const expiresAt = new Date(Date.now() + ttlSec * 1000);
    
    await prisma.deviceDisplayMessage.upsert({
      where: { deviceId: authResult.device.deviceId },
      update: {
        line0: line0.substring(0, 16),
        line1: line1.substring(0, 16),
        expiresAt,
      },
      create: {
        deviceId: authResult.device.deviceId,
        line0: line0.substring(0, 16),
        line1: line1.substring(0, 16),
        expiresAt,
      },
    });

    return NextResponse.json({
      ok: true,
      message: "Display message set",
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    console.error("[API] Display message error:", error);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/device/display
 * Clear LCD display message
 */
export async function DELETE(request: NextRequest) {
  try {
    const dev = await requireDevice(request);
    if (!dev) {
      return NextResponse.json(
        { ok: false, error: "UNAUTHORIZED" },
        { status: 401 }
      );
    }

    await prisma.deviceDisplayMessage.deleteMany({
      where: { deviceId: dev.deviceId },
    });

    return NextResponse.json({
      ok: true,
      message: "Display message cleared",
    });
  } catch (error) {
    console.error("[API] Display clear error:", error);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
