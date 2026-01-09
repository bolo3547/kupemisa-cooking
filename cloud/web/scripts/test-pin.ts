/**
 * Test PIN verification
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const testPin = '1234';
  
  const operators = await prisma.operator.findMany({
    where: { isActive: true },
    select: { id: true, name: true, pinHash: true },
  });

  console.log('Testing PIN verification for all operators:\n');

  for (const op of operators) {
    try {
      const valid = await bcrypt.compare(testPin, op.pinHash);
      console.log(`${op.name}: PIN "${testPin}" -> ${valid ? 'VALID ✓' : 'INVALID ✗'}`);
      if (!valid) {
        console.log(`  Hash: ${op.pinHash.substring(0, 20)}...`);
      }
    } catch (e: any) {
      console.log(`${op.name}: ERROR - ${e.message}`);
    }
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
