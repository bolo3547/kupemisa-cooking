import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifyDeviceAuth } from '@/lib/device-auth';
import { commandAckSchema } from '@/lib/validations';
import { CommandStatus } from '@prisma/client';

export async function POST(request: NextRequest) {
  try {
    const deviceId = request.headers.get('x-device-id');
    const apiKey = request.headers.get('x-api-key');

    // Verify device authentication
    const authResult = await verifyDeviceAuth(deviceId, apiKey);
    if (!authResult.valid || !authResult.device) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Parse and validate request body
    const body = await request.json();
    const validation = commandAckSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ ok: false, error: 'Invalid payload', details: validation.error.issues }, { status: 400 });
    }
    const data = validation.data;

    // Find the command
    const command = await prisma.command.findUnique({
      where: { id: data.commandId },
    });
    if (!command || command.deviceId !== authResult.device.deviceId) {
      return NextResponse.json({ ok: false, error: 'Command not found' }, { status: 404 });
    }

    // Create ack record
    await prisma.commandAck.create({
      data: {
        commandId: data.commandId,
        deviceId: authResult.device.deviceId,
        receivedAt: new Date(),
        executedAt: data.executedAt ? new Date(data.executedAt) : undefined,
        ok: data.ok,
        message: data.message,
        metaJson: data.metaJson,
      },
    });

    // Update command status
    await prisma.command.update({
      where: { id: data.commandId },
      data: {
        status: data.ok ? CommandStatus.ACKED : CommandStatus.FAILED,
        ackedAt: new Date(),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Command ack error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
