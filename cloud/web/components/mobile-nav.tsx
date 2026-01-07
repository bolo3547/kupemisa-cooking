'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Menu, X, Droplet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LogoutButton } from './auth/logout-button';
import { ThemeToggle } from './theme-toggle';

interface MobileNavProps {
  isOwner: boolean;
  userEmail: string;
  userRole: string;
}

export function MobileNav({ isOwner, userEmail, userRole }: MobileNavProps) {
  const [isOpen, setIsOpen] = useState(false);

  const toggleMenu = () => setIsOpen(!isOpen);
  const closeMenu = () => setIsOpen(false);

  return (
    <>
      <Button 
        variant="ghost" 
        size="icon" 
        className="md:hidden" 
        onClick={toggleMenu}
        aria-label="Toggle menu"
      >
        {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
      </Button>

      {isOpen && (
        <>
          <div 
            className="fixed inset-0 bg-black/50 z-40 md:hidden" 
            onClick={closeMenu}
          />
          <div className="fixed top-0 right-0 h-full w-72 bg-background border-l shadow-lg z-50 md:hidden overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-8">
                <Link href="/dashboard" className="flex items-center gap-2" onClick={closeMenu}>
                  <Droplet className="h-6 w-6 text-primary" />
                  <span className="font-semibold">Fleet Oil</span>
                </Link>
                <Button variant="ghost" size="icon" onClick={closeMenu}>
                  <X className="h-5 w-5" />
                </Button>
              </div>

              <div className="mb-6 pb-6 border-b">
                <div className="text-sm font-medium">{userEmail}</div>
                <div className="text-xs text-muted-foreground">{userRole}</div>
              </div>

              <nav className="flex flex-col gap-2">
                <Link 
                  href="/dashboard" 
                  className="px-4 py-3 text-sm hover:bg-muted rounded-md transition-colors"
                  onClick={closeMenu}
                >
                  Dashboard
                </Link>
                <Link 
                  href="/dashboard/analytics" 
                  className="px-4 py-3 text-sm hover:bg-muted rounded-md transition-colors"
                  onClick={closeMenu}
                >
                  Analytics
                </Link>
                <Link 
                  href="/dashboard/transactions" 
                  className="px-4 py-3 text-sm hover:bg-muted rounded-md transition-colors"
                  onClick={closeMenu}
                >
                  Transactions
                </Link>
                <Link 
                  href="/dashboard/reports" 
                  className="px-4 py-3 text-sm hover:bg-muted rounded-md transition-colors"
                  onClick={closeMenu}
                >
                  Reports
                </Link>

                {isOwner && (
                  <>
                    <div className="border-t my-2" />
                    <Link 
                      href="/dashboard/operators" 
                      className="px-4 py-3 text-sm hover:bg-muted rounded-md transition-colors"
                      onClick={closeMenu}
                    >
                      Operators
                    </Link>
                    <Link 
                      href="/dashboard/pricing" 
                      className="px-4 py-3 text-sm hover:bg-muted rounded-md transition-colors"
                      onClick={closeMenu}
                    >
                      Pricing
                    </Link>
                    <Link 
                      href="/dashboard/activity" 
                      className="px-4 py-3 text-sm hover:bg-muted rounded-md transition-colors"
                      onClick={closeMenu}
                    >
                      Activity Logs
                    </Link>
                    <Link 
                      href="/dashboard/provision" 
                      className="px-4 py-3 text-sm hover:bg-muted rounded-md transition-colors"
                      onClick={closeMenu}
                    >
                      Add Tank
                    </Link>
                  </>
                )}

                <div className="border-t my-2" />
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm">Theme</span>
                  <ThemeToggle />
                </div>
                <div className="px-4 py-2">
                  <LogoutButton />
                </div>
              </nav>
            </div>
          </div>
        </>
      )}
    </>
  );
}
