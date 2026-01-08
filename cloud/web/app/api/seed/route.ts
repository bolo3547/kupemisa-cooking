import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';

// This endpoint seeds the database with initial data
// DELETE THIS FILE AFTER SEEDING IN PRODUCTION!
export async function GET(request: Request) {
  // Simple security - require a secret key
  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key');
  
  if (key !== 'kupemisa-seed-2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Create OWNER user
    const passwordHash = await bcrypt.hash('kupemisa', 12);

    const owner = await prisma.user.upsert({
      where: { email: 'kupemisa@gmail.com' },
      update: { passwordHash },
      create: {
        email: 'kupemisa@gmail.com',
        passwordHash,
        role: 'OWNER',
      },
    });

    // Create global AlertRule
    const globalRule = await prisma.alertRule.upsert({
      where: { id: 'global-default-rule' },
      update: {},
      create: {
        id: 'global-default-rule',
        deviceId: null,
        lowThreshold: 15,
        criticalThreshold: 5,
        enabled: true,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Database seeded successfully!',
      user: owner.email,
      credentials: {
        email: 'kupemisa@gmail.com',
        password: 'kupemisa'
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
