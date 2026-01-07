const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkUsers() {
  const users = await prisma.user.findMany();
  console.log('Users in database:');
  users.forEach(u => {
    console.log(`- ${u.email} (role: ${u.role})`);
  });
  await prisma.$disconnect();
}

checkUsers();
