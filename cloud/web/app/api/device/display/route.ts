import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyDeviceAuth } from "@/lib/device-auth";
import { z } from "zod";

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
  const deviceId = request.headers.get("x-device-id");
  const apiKey = request.headers.get("x-api-key");

  if (!deviceId || !apiKey) {
    return NextResponse.json(
      { ok: false, error: "Missing device credentials" },
      { status: 401 }
    );
  }

  try {
    const authResult = await verifyDeviceAuth(deviceId, apiKey);
    if (!authResult.valid || !authResult.device) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

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
  const deviceId = request.headers.get("x-device-id");
  const apiKey = request.headers.get("x-api-key");

  if (!deviceId || !apiKey) {
    return NextResponse.json(
      { ok: false, error: "Missing device credentials" },
      { status: 401 }
    );
  }

  try {
    const authResult = await verifyDeviceAuth(deviceId, apiKey);
    if (!authResult.valid || !authResult.device) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    await prisma.deviceDisplayMessage.deleteMany({
      where: { deviceId: authResult.device.deviceId },
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
