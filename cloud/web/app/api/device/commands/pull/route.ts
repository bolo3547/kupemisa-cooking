import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifyDeviceAuth } from '@/lib/device-auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { CommandStatus } from '@prisma/client';

export async function GET(request: NextRequest) {
  try {
    const deviceId = request.headers.get('x-device-id');
    const apiKey = request.headers.get('x-api-key');

    // Verify device authentication
    const authResult = await verifyDeviceAuth(deviceId, apiKey);
    if (!authResult.valid || !authResult.device) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Rate limit command pull (min 2s)
    const rateLimitResult = checkRateLimit(`${authResult.device.deviceId}-pull`);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ ok: false, error: 'Rate limited', waitMs: rateLimitResult.waitMs }, { status: 429 });
    }

    // Find the newest PENDING command not expired
    const now = new Date();
    const command = await prisma.command.findFirst({
      where: {
        deviceId: authResult.device.deviceId,
        status: CommandStatus.PENDING,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!command) {
      return NextResponse.json({ ok: true, command: null });
    }

    // Mark as SENT
    await prisma.command.update({
      where: { id: command.id },
      data: { status: CommandStatus.SENT, sentAt: new Date() },
    });

    return NextResponse.json({
      ok: true,
      command: {
        id: command.id,
        type: command.type,
        payloadJson: command.payloadJson,
        createdAt: command.createdAt,
        expiresAt: command.expiresAt,
      },
    });
  } catch (error) {
    console.error('Command pull error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
