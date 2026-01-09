/**
 * Debug device and operator setup
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Checking database state...\n');

  // Check users
  const users = await prisma.user.findMany({
    select: { id: true, email: true, role: true },
  });
  console.log('Users:', users);

  // Check devices
  const devices = await prisma.device.findMany({
    select: { deviceId: true, siteName: true, ownerId: true, status: true },
  });
  console.log('\nDevices:', devices);

  // Check operators
  const operators = await prisma.operator.findMany({
    select: { id: true, name: true, role: true, ownerId: true, isActive: true },
  });
  console.log('\nOperators:', operators);

  // Verify device-owner linkage
  if (devices.length > 0 && operators.length > 0) {
    console.log('\n--- Verification ---');
    const device = devices[0];
    const opsForDevice = operators.filter(op => op.ownerId === device.ownerId);
    console.log(`Device ${device.deviceId} owner: ${device.ownerId}`);
    console.log(`Operators for this owner: ${opsForDevice.length}`);
    opsForDevice.forEach(op => {
      console.log(`  - ${op.name} (${op.role})`);
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('Error:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
