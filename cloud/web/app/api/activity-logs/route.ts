import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getActivityLogs } from '@/lib/activity-log';

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.user.role !== 'OWNER') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action') || undefined;
    const resourceType = searchParams.get('resourceType') || undefined;
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 100;

    const { logs, total } = await getActivityLogs({
      action: action as any,
      resourceType,
      limit,
    });

    return NextResponse.json({ logs, total });
  } catch (error) {
    console.error('Activity logs fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch activity logs' }, { status: 500 });
  }
}
