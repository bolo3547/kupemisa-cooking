import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();
    
    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
    });
    
    if (!user) {
      return NextResponse.json({ 
        success: false, 
        error: 'User not found',
        searchedEmail: email 
      });
    }
    
    // Check password
    const isValid = await bcrypt.compare(password, user.passwordHash);
    
    return NextResponse.json({
      success: isValid,
      userFound: true,
      email: user.email,
      role: user.role,
      passwordValid: isValid,
      hashPrefix: user.passwordHash.substring(0, 10),
    });
  } catch (error: any) {
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}
