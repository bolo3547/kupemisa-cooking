/**
 * Provision a test device for ESP32 communication testing
 * Run with: npx tsx scripts/provision-test-device.ts
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const prisma = new PrismaClient();

function generateApiKey(): string {
  return crypto.randomBytes(32).toString('base64url');
}

async function main() {
  console.log('Provisioning test device...\n');

  // Get the owner user
  const owner = await prisma.user.findUnique({
    where: { email: 'kupemisa@gmail.com' },
  });

  if (!owner) {
    throw new Error('Owner user not found. Run seed first.');
  }

  // Check if test device already exists
  const existing = await prisma.device.findUnique({
    where: { deviceId: 'OIL-0001' },
  });

  if (existing) {
    console.log('Device OIL-0001 already exists. Regenerating API key...\n');
    
    const apiKey = generateApiKey();
    const apiKeyHash = await bcrypt.hash(apiKey, 12);
    
    await prisma.device.update({
      where: { deviceId: 'OIL-0001' },
      data: { apiKeyHash },
    });

    console.log('='.repeat(60));
    console.log('ESP32 CONFIGURATION (paste into your .ino file)');
    console.log('='.repeat(60));
    console.log(`#define DEVICE_ID "OIL-0001"`);
    console.log(`#define API_KEY "${apiKey}"`);
    console.log(`#define API_BASE_URL "https://fleet-oil-system.vercel.app"`);
    console.log(`#define SITE_NAME "${existing.siteName}"`);
    console.log('='.repeat(60));
    return;
  }

  // Create new device
  const apiKey = generateApiKey();
  const apiKeyHash = await bcrypt.hash(apiKey, 12);

  const device = await prisma.device.create({
    data: {
      deviceId: 'OIL-0001',
      siteName: 'Test Station 1',
      location: 'Main Office',
      notes: 'Test device for ESP32 development',
      apiKeyHash,
      ownerId: owner.id,
      status: 'OFFLINE',
    },
  });

  console.log(`Created device: ${device.deviceId}`);
  console.log(`Site: ${device.siteName}`);
  console.log(`Location: ${device.location}`);
  console.log('');
  console.log('='.repeat(60));
  console.log('ESP32 CONFIGURATION (paste into your .ino file)');
  console.log('='.repeat(60));
  console.log(`#define DEVICE_ID "${device.deviceId}"`);
  console.log(`#define API_KEY "${apiKey}"`);
  console.log(`#define API_BASE_URL "https://fleet-oil-system.vercel.app"`);
  console.log(`#define SITE_NAME "${device.siteName}"`);
  console.log('='.repeat(60));
  console.log('');
  console.log('⚠️  IMPORTANT: Save the API_KEY now! It cannot be retrieved later.');

  // Also create a default price schedule
  const priceExists = await prisma.priceSchedule.findFirst({
    where: { deviceId: device.deviceId },
  });

  if (!priceExists) {
    await prisma.priceSchedule.create({
      data: {
        deviceId: device.deviceId,
        sellPricePerLiter: 25.0,
        costPricePerLiter: 20.0,
        currency: 'ZMW',
        effectiveFrom: new Date(),
        createdById: owner.id,
      },
    });
    console.log('\nCreated default price: 25.00 ZMW/L (cost: 20.00 ZMW/L)');
  }

  // Create a test operator
  const operatorExists = await prisma.operator.findFirst({
    where: { ownerId: owner.id },
  });

  if (!operatorExists) {
    const pinHash = await bcrypt.hash('1234', 12);
    await prisma.operator.create({
      data: {
        name: 'Test Operator',
        role: 'OPERATOR',
        pinHash,
        ownerId: owner.id,
        isActive: true,
      },
    });
    console.log('Created test operator: Test Operator (PIN: 1234)');
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
