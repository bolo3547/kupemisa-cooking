import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// Force dynamic route to avoid static optimization issues
export const dynamic = 'force-dynamic';

export async function GET() {
  let db = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch (e) {
    db = false;
  }
  return NextResponse.json({ ok: true, db, time: new Date().toISOString() });
}
