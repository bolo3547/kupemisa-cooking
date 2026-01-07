const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function updateUser() {
  const hash = await bcrypt.hash('kupemisa', 10);
  
  await prisma.user.update({
    where: { email: 'admin@denuel.local' },
    data: { 
      email: 'kupemisa@gmail.com', 
      passwordHash: hash 
    }
  });
  
  console.log('✅ Updated successfully!');
  console.log('');
  console.log('New login credentials:');
  console.log('  Email: kupemisa@gmail.com');
  console.log('  Password: kupemisa');
  
  await prisma.$disconnect();
}

updateUser();
