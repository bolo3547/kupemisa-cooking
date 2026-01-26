import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { hashOperatorPinForDevice } from '@/lib/operator-pin';
import { logActivity } from '@/lib/activity-log';

export const runtime = "nodejs";

/**
 * Device authentication helper
 */
async function requireDevice(req: NextRequest) {
  const deviceId = req.headers.get("x-device-id") || "";
  const apiKey = req.headers.get("x-api-key") || "";
  if (!deviceId || !apiKey) return null;

  const dev = await prisma.device.findUnique({ where: { deviceId } });
  if (!dev) return null;
  
  // Use bcrypt to securely compare API key
  const isValid = await bcrypt.compare(apiKey, dev.apiKeyHash);
  if (!isValid) return null;
  
  return dev;
}

/**
 * POST /api/ingest/operator
 * Create/update/delete an operator from the device
 * 
 * This enables bidirectional operator sync:
 *   - Dashboard → Device (via /api/device/operators)
 *   - Device → Dashboard (via this endpoint)
 * 
 * Auth: x-device-id / x-api-key headers
 * 
 * Body:
 *   {
 *     "operatorCode": "OP01",      // Name/identifier
 *     "pin": "1234",               // Raw PIN (will be hashed)
 *     "role": "operator|supervisor",
 *     "action": "add|delete",
 *     "siteName": "PHI",           // Optional site name
 *     "timestamp": 12345678        // Optional device millis
 *   }
 */
export async function POST(request: NextRequest) {
  try {
    // Verify device authentication
    const dev = await requireDevice(request);
    if (!dev) {
      console.log('[INGEST/OPERATOR] Unauthorized request');
      return NextResponse.json(
        { ok: false, error: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }

    if (!dev.ownerId) {
      console.log(`[INGEST/OPERATOR] Device ${dev.deviceId} has no owner`);
      return NextResponse.json(
        { ok: false, error: 'Device not linked to owner' },
        { status: 403 }
      );
    }

    // Update device lastSeenAt
    await prisma.device.update({
      where: { deviceId: dev.deviceId },
      data: { lastSeenAt: new Date() },
    });

    // Parse body
    const body = await request.json();
    const { operatorCode, pin, role, action, siteName, timestamp } = body;

    console.log(`[INGEST/OPERATOR] Device: ${dev.deviceId}, Action: ${action}, Code: ${operatorCode}`);

    // Validate required fields
    if (!operatorCode || typeof operatorCode !== 'string' || operatorCode.length < 1) {
      return NextResponse.json(
        { ok: false, error: 'operatorCode is required' },
        { status: 400 }
      );
    }

    if (!action || !['add', 'delete'].includes(action)) {
      return NextResponse.json(
        { ok: false, error: 'action must be "add" or "delete"' },
        { status: 400 }
      );
    }

    // Handle DELETE action
    if (action === 'delete') {
      // Find operator by name for this owner
      const existing = await prisma.operator.findFirst({
        where: {
          ownerId: dev.ownerId,
          name: operatorCode,
        },
      });

      if (!existing) {
        console.log(`[INGEST/OPERATOR] Operator not found: ${operatorCode}`);
        return NextResponse.json({
          ok: true,
          message: 'Operator not found (may already be deleted)',
        });
      }

      // Soft delete by deactivating
      await prisma.operator.update({
        where: { id: existing.id },
        data: { isActive: false },
      });

      // Log activity
      await logActivity({
        userId: dev.ownerId,
        action: 'UPDATE_OPERATOR',
        targetType: 'OPERATOR',
        targetId: existing.id,
        details: {
          operatorName: operatorCode,
          deviceId: dev.deviceId,
          siteName: siteName || dev.siteName,
          source: 'device',
          change: 'deactivated',
        },
      });

      console.log(`[INGEST/OPERATOR] Deactivated operator: ${operatorCode}`);
      return NextResponse.json({
        ok: true,
        message: 'Operator deactivated',
        operatorId: existing.id,
      });
    }

    // Handle ADD action
    if (!pin || typeof pin !== 'string' || pin.length < 4) {
      return NextResponse.json(
        { ok: false, error: 'PIN must be at least 4 characters' },
        { status: 400 }
      );
    }

    // Normalize role
    const normalizedRole = (role === 'supervisor' || role === 'SUPERVISOR') ? 'SUPERVISOR' : 'OPERATOR';

    // Generate hashes
    const pinHash = await bcrypt.hash(pin, 12);           // For dashboard verification
    const pinHashDevice = hashOperatorPinForDevice(pin);  // For device verification (SHA256 with salt)

    // Check if operator with same name exists for this owner
    const existingByName = await prisma.operator.findFirst({
      where: {
        ownerId: dev.ownerId,
        name: operatorCode,
      },
    });

    if (existingByName) {
      // Update existing operator (reactivate if deactivated, update PIN)
      await prisma.operator.update({
        where: { id: existingByName.id },
        data: {
          pinHash,
          pinHashDevice,
          role: normalizedRole,
          isActive: true,
        },
      });

      // Log activity
      await logActivity({
        userId: dev.ownerId,
        action: 'UPDATE_OPERATOR',
        targetType: 'OPERATOR',
        targetId: existingByName.id,
        details: {
          operatorName: operatorCode,
          deviceId: dev.deviceId,
          siteName: siteName || dev.siteName,
          source: 'device',
          change: 'updated/reactivated',
        },
      });

      console.log(`[INGEST/OPERATOR] Updated operator: ${operatorCode} (id: ${existingByName.id})`);
      return NextResponse.json({
        ok: true,
        message: 'Operator updated',
        operatorId: existingByName.id,
      });
    }

    // Check if PIN is already used by another operator
    const existingByPin = await prisma.operator.findFirst({
      where: {
        ownerId: dev.ownerId,
        pinHashDevice,
        isActive: true,
      },
    });

    if (existingByPin) {
      console.log(`[INGEST/OPERATOR] PIN already used by: ${existingByPin.name}`);
      return NextResponse.json(
        { ok: false, error: 'PIN is already used by another operator' },
        { status: 409 }
      );
    }

    // Create new operator
    const newOperator = await prisma.operator.create({
      data: {
        ownerId: dev.ownerId,
        name: operatorCode,
        pinHash,
        pinHashDevice,
        role: normalizedRole,
        isActive: true,
      },
    });

    // Log activity
    await logActivity({
      userId: dev.ownerId,
      action: 'CREATE_OPERATOR',
      targetType: 'OPERATOR',
      targetId: newOperator.id,
      details: {
        operatorName: operatorCode,
        role: normalizedRole,
        deviceId: dev.deviceId,
        siteName: siteName || dev.siteName,
        source: 'device',
      },
    });

    console.log(`[INGEST/OPERATOR] Created operator: ${operatorCode} (id: ${newOperator.id})`);
    return NextResponse.json({
      ok: true,
      message: 'Operator created',
      operatorId: newOperator.id,
    });

  } catch (error) {
    console.error('[INGEST/OPERATOR] Error:', error);
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
