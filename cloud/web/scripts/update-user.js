const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const hash = await bcrypt.hash('kupemisa', 12);
  
  // Update existing admin user
  const user = await prisma.user.updateMany({
    where: { role: 'OWNER' },
    data: { 
      email: 'kupemisa@gmail.com',
      passwordHash: hash 
    }
  });
  
  console.log('Updated user credentials:');
  console.log('Email: kupemisa@gmail.com');
  console.log('Password: kupemisa');
  
  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
