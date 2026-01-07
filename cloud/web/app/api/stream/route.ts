import { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// Keep track of active connections
const clients = new Set<ReadableStreamDefaultController>();

export const dynamic = 'force-dynamic';

async function getDevicesData() {
  const devices = await prisma.device.findMany({
    include: {
      telemetry: {
        orderBy: { ts: 'desc' },
        take: 1,
      },
    },
  });

  return devices.map(device => ({
    id: device.id,
    deviceId: device.deviceId,
    siteName: device.siteName,
    location: device.location,
    status: device.status,
    lastSeenAt: device.lastSeenAt?.toISOString(),
    latestTelemetry: device.telemetry[0] ? {
      oilPercent: device.telemetry[0].oilPercent,
      oilLiters: device.telemetry[0].oilLiters,
      flowLpm: device.telemetry[0].flowLpm,
      pumpState: device.telemetry[0].pumpState,
      ts: Number(device.telemetry[0].ts),
    } : null,
  }));
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      clients.add(controller);

      // Send initial data
      try {
        const devices = await getDevicesData();
        const data = `data: ${JSON.stringify(devices)}\n\n`;
        controller.enqueue(new TextEncoder().encode(data));
      } catch (error) {
        console.error('SSE initial data error:', error);
      }

      // Set up interval to send updates
      const interval = setInterval(async () => {
        try {
          const devices = await getDevicesData();
          const data = `data: ${JSON.stringify(devices)}\n\n`;
          controller.enqueue(new TextEncoder().encode(data));
        } catch (error) {
          console.error('SSE update error:', error);
          clearInterval(interval);
          clients.delete(controller);
          controller.close();
        }
      }, 3000); // Update every 3 seconds

      // Clean up on close
      req.signal.addEventListener('abort', () => {
        clearInterval(interval);
        clients.delete(controller);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
