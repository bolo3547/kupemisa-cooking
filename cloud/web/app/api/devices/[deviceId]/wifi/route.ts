import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * GET /api/devices/[deviceId]/wifi
 * Get current WiFi settings for a device
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { deviceId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const device = await prisma.device.findFirst({
      where: {
        deviceId: params.deviceId,
        ownerId: session.user.id,
      },
      select: {
        deviceId: true,
        siteName: true,
        wifiSsid: true,
        wifiPassword: true,
        wifiUpdatedAt: true,
      },
    });

    if (!device) {
      return NextResponse.json({ ok: false, error: "Device not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      wifi: {
        ssid: device.wifiSsid || "",
        password: device.wifiPassword || "",
        updatedAt: device.wifiUpdatedAt?.toISOString() || null,
      },
    });
  } catch (error) {
    console.error("[API] Get WiFi error:", error);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PUT /api/devices/[deviceId]/wifi
 * Update WiFi credentials for a device
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { deviceId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { ssid, password } = body;

    if (!ssid || typeof ssid !== "string") {
      return NextResponse.json({ ok: false, error: "WiFi SSID is required" }, { status: 400 });
    }

    if (ssid.length > 32) {
      return NextResponse.json({ ok: false, error: "WiFi SSID must be 32 characters or less" }, { status: 400 });
    }

    if (password && password.length > 64) {
      return NextResponse.json({ ok: false, error: "WiFi password must be 64 characters or less" }, { status: 400 });
    }

    // Verify device ownership
    const device = await prisma.device.findFirst({
      where: {
        deviceId: params.deviceId,
        ownerId: session.user.id,
      },
    });

    if (!device) {
      return NextResponse.json({ ok: false, error: "Device not found" }, { status: 404 });
    }

    // Update WiFi credentials
    await prisma.device.update({
      where: { deviceId: params.deviceId },
      data: {
        wifiSsid: ssid.trim(),
        wifiPassword: password?.trim() || "",
        wifiUpdatedAt: new Date(),
      },
    });

    console.log(`[WIFI] Updated WiFi for ${params.deviceId}: SSID=${ssid}`);

    return NextResponse.json({
      ok: true,
      message: "WiFi credentials updated. Device will use new settings on next config fetch.",
    });
  } catch (error) {
    console.error("[API] Update WiFi error:", error);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
