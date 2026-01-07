import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { commandSchema } from '@/lib/validations';
import { UserRole, CommandStatus } from '@prisma/client';

export async function POST(
  request: NextRequest,
  { params }: { params: { deviceId: string } }
) {
  try {
    const session = await getSession();
    if (!session || session.user.role !== UserRole.OWNER) {
      return NextResponse.json({ error: 'Forbidden: Owner access required' }, { status: 403 });
    }

    const { deviceId } = params;

    // Check device exists
    const device = await prisma.device.findUnique({ where: { deviceId } });
    if (!device) {
      return NextResponse.json({ error: 'Device not found' }, { status: 404 });
    }

    const body = await request.json();
    const validation = commandSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: 'Invalid payload', details: validation.error.issues }, { status: 400 });
    }

    const { type, payloadJson } = validation.data;

    // Create command with 5 min expiry
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    const command = await prisma.command.create({
      data: {
        deviceId,
        type,
        payloadJson: payloadJson || undefined,
        status: CommandStatus.PENDING,
        expiresAt,
        createdByUserId: session.user.id,
      },
    });

    return NextResponse.json({ ok: true, command });
  } catch (error) {
    console.error('Error creating command:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
