import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting database seed...');

  // Create OWNER user
  const passwordHash = await bcrypt.hash('kupemisa', 12);

  const owner = await prisma.user.upsert({
    where: { email: 'kupemisa@gmail.com' },
    update: { passwordHash },
    create: {
      email: 'kupemisa@gmail.com',
      passwordHash,
      role: UserRole.OWNER,
    },
  });

  console.log(`Created OWNER user: ${owner.email}`);

  // Create a VIEWER user for testing
  const viewerHash = await bcrypt.hash('Viewer123!', 12);

  const viewer = await prisma.user.upsert({
    where: { email: 'viewer@denuel.local' },
    update: {},
    create: {
      email: 'viewer@denuel.local',
      passwordHash: viewerHash,
      role: UserRole.VIEWER,
    },
  });

  console.log(`Created VIEWER user: ${viewer.email}`);

  // Create global AlertRule
  const globalRule = await prisma.alertRule.upsert({
    where: { id: 'global-default-rule' },
    update: {},
    create: {
      id: 'global-default-rule',
      deviceId: null, // null = applies to all devices
      lowThreshold: 15,
      criticalThreshold: 5,
      enabled: true,
    },
  });

  console.log(
    `Created global alert rule (low: ${globalRule.lowThreshold}%, critical: ${globalRule.criticalThreshold}%)`
  );

  console.log('');
  console.log('Seed completed successfully!');
  console.log('');
  console.log('Login credentials:');
  console.log('  OWNER: kupemisa@gmail.com / kupemisa');
  console.log('  VIEWER: viewer@denuel.local / Viewer123!');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('Seed failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
