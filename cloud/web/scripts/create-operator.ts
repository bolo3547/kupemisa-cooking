/**
 * Create a test operator
 * Run with: npx tsx scripts/create-operator.ts
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const prisma = new PrismaClient();

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

async function main() {
  console.log('Creating test operator...\n');

  const owner = await prisma.user.findUnique({
    where: { email: 'kupemisa@gmail.com' },
  });

  if (!owner) {
    throw new Error('Owner not found');
  }

  // Check if operator exists
  const existing = await prisma.operator.findFirst({
    where: { ownerId: owner.id, name: 'Test Operator' },
  });

  if (existing) {
    console.log('Operator already exists:');
    console.log(`  Name: ${existing.name}`);
    console.log(`  Role: ${existing.role}`);
    console.log(`  PIN: 1234`);
    return;
  }

  const pin = '1234';
  const pinHash = await bcrypt.hash(pin, 12);
  const pinHashDevice = sha256(pin);

  const operator = await prisma.operator.create({
    data: {
      name: 'Test Operator',
      role: 'OPERATOR',
      pinHash,
      pinHashDevice,
      ownerId: owner.id,
      isActive: true,
    },
  });

  console.log('Created operator:');
  console.log(`  ID: ${operator.id}`);
  console.log(`  Name: ${operator.name}`);
  console.log(`  Role: ${operator.role}`);
  console.log(`  PIN: 1234`);
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
