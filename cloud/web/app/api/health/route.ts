import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// Force dynamic route to avoid static optimization issues
export const dynamic = 'force-dynamic';

export async function GET() {
  let db = false;
  let dbError: string | null = null;
  const hasDbUrl = !!process.env.DATABASE_URL;
  const dbUrlPrefix = process.env.DATABASE_URL?.substring(0, 30) || 'NOT_SET';
  
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch (e: any) {
    db = false;
    dbError = e?.message || String(e);
    console.error('[health] DB error:', dbError);
  }
  return NextResponse.json({ 
    ok: true, 
    db, 
    hasDbUrl,
    dbUrlPrefix,
    dbError,
    time: new Date().toISOString() 
  });
}
