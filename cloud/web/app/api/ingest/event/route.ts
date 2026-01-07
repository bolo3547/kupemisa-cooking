import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifyDeviceAuth } from '@/lib/device-auth';
import { eventSchema } from '@/lib/validations';
import { sendEmailAlert } from '@/lib/alerts';

export async function POST(request: NextRequest) {
  try {
    // Get device credentials from headers
    const deviceId = request.headers.get('x-device-id');
    const apiKey = request.headers.get('x-api-key');

    // Verify device authentication
    const authResult = await verifyDeviceAuth(deviceId, apiKey);
    if (!authResult.valid || !authResult.device) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const validation = eventSchema.safeParse(body);
    
    if (!validation.success) {
      return NextResponse.json(
        { ok: false, error: 'Invalid payload', details: validation.error.issues },
        { status: 400 }
      );
    }

    const data = validation.data;

    // Insert event
    await prisma.event.create({
      data: {
        deviceId: authResult.device.deviceId,
        ts: BigInt(data.ts),
        type: data.type,
        severity: data.severity,
        message: data.message,
        metaJson: data.metaJson || undefined,
      },
    });

    // Update device lastSeenAt
    await prisma.device.update({
      where: { deviceId: authResult.device.deviceId },
      data: { lastSeenAt: new Date() },
    });

    // Send alerts for critical events
    if (data.severity === 'CRITICAL') {
      sendEmailAlert({
        deviceId: authResult.device.deviceId,
        siteName: authResult.device.siteName,
        type: 'SAFETY_EVENT',
        message: `${data.type}: ${data.message}`,
        timestamp: new Date(),
      }).catch((err) => console.error('Event alert error:', err));
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Event ingest error:', error);
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
