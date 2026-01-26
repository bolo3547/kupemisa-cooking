import { getSession } from '@/lib/auth';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Droplet } from 'lucide-react';
import { LogoutButton } from '@/components/auth/logout-button';
import { ThemeToggle } from '@/components/theme-toggle';
import { MobileNav } from '@/components/mobile-nav';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  
  if (!session) {
    redirect('/login');
  }

  const isOwner = session.user.role === 'OWNER';

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      <header className="glass-effect sticky top-0 z-30 smooth-shadow">
        <div className="container mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          {/* Logo - hidden on mobile, shown on desktop */}
          <Link href="/dashboard" className="hidden md:flex items-center gap-2 group">
            <Droplet className="h-7 w-7 text-primary transition-transform group-hover:scale-110 group-hover:rotate-12" />
            <span className="text-lg font-semibold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">Pimisha</span>
          </Link>
          {/* Mobile: just show Pimisha text, no nav bar */}
          <span className="md:hidden text-lg font-semibold">Pimisha</span>
          <nav className="hidden md:flex items-center gap-6">
            <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground transition-all duration-200 hover:scale-105">
              Dashboard
            </Link>
            <Link href="/dashboard/analytics" className="text-sm text-muted-foreground hover:text-foreground transition-all duration-200 hover:scale-105">
              Analytics
            </Link>
            <Link href="/dashboard/transactions" className="text-sm text-muted-foreground hover:text-foreground transition-all duration-200 hover:scale-105">
              Transactions
            </Link>
            <Link href="/dashboard/reports" className="text-sm text-muted-foreground hover:text-foreground transition-all duration-200 hover:scale-105">
              Reports
            </Link>
            {isOwner && (
              <>
                <Link href="/dashboard/tank" className="text-sm text-muted-foreground hover:text-foreground transition-all duration-200 hover:scale-105">
                  Tank
                </Link>
                <Link href="/dashboard/customers" className="text-sm text-muted-foreground hover:text-foreground transition-all duration-200 hover:scale-105">
                  Customers
                </Link>
                <Link href="/dashboard/operators" className="text-sm text-muted-foreground hover:text-foreground transition-all duration-200 hover:scale-105">
                  Operators
                </Link>
                <Link href="/dashboard/discounts" className="text-sm text-muted-foreground hover:text-foreground transition-all duration-200 hover:scale-105">
                  Discounts
                </Link>
                <Link href="/dashboard/settings" className="text-sm text-muted-foreground hover:text-foreground transition-all duration-200 hover:scale-105">
                  Settings
                </Link>
              </>
            )}
          </nav>
          <div className="hidden md:flex items-center gap-2">
            <div className="text-right hidden sm:block">
              <div className="text-sm font-medium">{session.user.email}</div>
              <div className="text-xs text-muted-foreground">{session.user.role}</div>
            </div>
            <ThemeToggle />
            <LogoutButton />
          </div>
          <MobileNav 
            isOwner={isOwner} 
            userEmail={session.user.email} 
            userRole={session.user.role} 
          />
        </div>
      </header>
      <main className="container mx-auto px-4 sm:px-6 py-8">{children}</main>
    </div>
  );
}

