import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { UserRole } from '@prisma/client';
import { redirect } from 'next/navigation';

// Session user type for convenience
export type SessionUser = {
  id: string;
  email: string;
  role: UserRole;
};

/**
 * Get the current session (null if not authenticated)
 */
export async function getSession() {
  return await getServerSession(authOptions);
}

/**
 * Get the current session user (null if not authenticated)
 * Alias for getCurrentUser - use whichever is clearer in context
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getSession();
  return session?.user ?? null;
}

/**
 * Get the current authenticated user (null if not authenticated)
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await getSession();
  return session?.user ?? null;
}

/**
 * Require authentication - throws if not authenticated
 * Use in API routes where you want to return 401
 */
export async function requireAuth(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }
  return user;
}

/**
 * Require authentication with redirect - redirects to login if not authenticated
 * Use in Server Components/pages where you want to redirect
 */
export async function requireAuthWithRedirect(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }
  return user;
}

/**
 * Require OWNER role - throws if not owner
 * Use in API routes where you want to return 403
 */
export async function requireOwner(): Promise<SessionUser> {
  const user = await requireAuth();
  if (user.role !== UserRole.OWNER) {
    throw new Error('Forbidden: Owner access required');
  }
  return user;
}

/**
 * Require OWNER role with redirect - redirects if not owner
 * Use in Server Components/pages where you want to redirect
 */
export async function requireOwnerWithRedirect(): Promise<SessionUser> {
  const user = await requireAuthWithRedirect();
  if (user.role !== UserRole.OWNER) {
    redirect('/dashboard');
  }
  return user;
}

/**
 * Check if a role is OWNER
 */
export function isOwner(role: UserRole): boolean {
  return role === UserRole.OWNER;
}

/**
 * Check if user has at least VIEWER role (any authenticated user)
 */
export function isViewer(role: UserRole): boolean {
  return role === UserRole.VIEWER || role === UserRole.OWNER;
}
