import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const range = searchParams.get('range') || '7d';

    // Calculate date range
    const now = new Date();
    const daysAgo = range === '24h' ? 1 : range === '7d' ? 7 : range === '30d' ? 30 : 90;
    const startDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);

    // Get all devices with their latest telemetry
    const devices = await prisma.device.findMany({
      include: {
        telemetry: {
          orderBy: { ts: 'desc' },
          take: 1,
        },
      },
    });

    const totalDevices = devices.length;
    const activeDevices = devices.filter(d => d.status !== 'OFFLINE').length;
    const criticalDevices = devices.filter(d => d.status === 'CRITICAL').length;

    // Calculate average oil level
    const oilLevels = devices
      .map(d => d.telemetry[0]?.oilPercent)
      .filter(Boolean) as number[];
    const avgOilLevel = oilLevels.length > 0 
      ? oilLevels.reduce((sum, level) => sum + level, 0) / oilLevels.length 
      : 0;

    // Calculate total capacity and current (estimate capacity as 1000L per device if not set)
    const totalCapacity = devices.length * 1000; // Default 1000L capacity per device
    const totalCurrent = devices.reduce((sum, d) => {
      const latest = d.telemetry[0];
      return sum + (latest?.oilLiters || 0);
    }, 0);

    // Get consumption trend (mock data - in production, query telemetry history)
    const consumptionTrend = Array.from({ length: daysAgo }, (_, i) => {
      const date = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
      return {
        date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        liters: Math.floor(Math.random() * 500 + 200), // Mock data
      };
    });

    // Device status distribution
    const statusCounts = devices.reduce((acc, d) => {
      acc[d.status] = (acc[d.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const deviceStatusDistribution = Object.entries(statusCounts).map(([status, count]) => ({
      status,
      count,
    }));

    // Top consumers (mock data - in production, aggregate from dispense transactions)
    const topConsumers = devices
      .slice(0, 5)
      .map(d => ({
        deviceId: d.deviceId,
        siteName: d.siteName,
        consumption: Math.floor(Math.random() * 1000 + 500), // Mock data
      }))
      .sort((a, b) => b.consumption - a.consumption);

    // Forecast (simple linear regression - in production, use ML model)
    const avgConsumption = consumptionTrend.reduce((sum, d) => sum + d.liters, 0) / consumptionTrend.length;
    const forecast = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(now.getTime() + (i + 1) * 24 * 60 * 60 * 1000);
      return {
        date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        predicted: Math.floor(avgConsumption + (Math.random() - 0.5) * 100),
        confidence: 85 - i * 3, // Decreasing confidence
      };
    });

    return NextResponse.json({
      totalDevices,
      activeDevices,
      avgOilLevel,
      totalCapacity,
      totalCurrent,
      criticalDevices,
      consumptionTrend,
      deviceStatusDistribution,
      topConsumers,
      forecast,
    });
  } catch (error) {
    console.error('Analytics fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch analytics' }, { status: 500 });
  }
}
