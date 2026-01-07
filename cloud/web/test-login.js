const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function testLogin() {
  const email = 'kupemisa@gmail.com';
  const password = 'kupemisa';
  
  console.log('Testing login with:');
  console.log('  Email:', email);
  console.log('  Password:', password);
  console.log('');
  
  const user = await prisma.user.findUnique({
    where: { email: email },
  });
  
  if (!user) {
    console.log('❌ User NOT found in database!');
    console.log('');
    console.log('Listing all users:');
    const allUsers = await prisma.user.findMany();
    allUsers.forEach(u => console.log('  -', u.email));
    await prisma.$disconnect();
    return;
  }
  
  console.log('✅ User found:', user.email);
  console.log('   Role:', user.role);
  console.log('   Password hash:', user.passwordHash.substring(0, 20) + '...');
  
  const isValid = await bcrypt.compare(password, user.passwordHash);
  
  if (isValid) {
    console.log('✅ Password is VALID!');
  } else {
    console.log('❌ Password is INVALID!');
  }
  
  await prisma.$disconnect();
}

testLogin();
