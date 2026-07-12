'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { Sidebar } from '@/components/layout/Sidebar';
import { Loader2, Menu, X, Bot } from 'lucide-react';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  // Close the mobile drawer on navigation.
  useEffect(() => { setMobileNavOpen(false); }, [pathname]);

  // Lock background scroll while the mobile drawer is open (the fixed overlay
  // otherwise lets the page scroll underneath the menu).
  useEffect(() => {
    if (!mobileNavOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [mobileNavOpen]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface-primary flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={22} className="animate-spin text-blue-500" />
          <p className="text-xs text-white/25">טוען...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return null;

  return (
    <div className="min-h-screen bg-surface-primary">
      {/* Desktop sidebar (fixed, 220px, right side — RTL) */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* Mobile top bar */}
      <header className="lg:hidden sticky top-0 z-40 flex items-center gap-3 px-4 h-14 bg-surface-sidebar border-b border-edge">
        <button
          onClick={() => setMobileNavOpen(true)}
          className="w-9 h-9 -mr-1.5 rounded-lg flex items-center justify-center text-white/60 hover:text-white hover:bg-white/[0.06] transition-all"
          aria-label="פתח תפריט"
        >
          <Menu size={19} />
        </button>
        <div className="w-7 h-7 rounded-[9px] bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center">
          <Bot size={13} className="text-white" />
        </div>
        <p className="text-sm font-semibold text-white tracking-tight">NEXUS</p>
      </header>

      {/* Mobile drawer */}
      {mobileNavOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
            onClick={() => setMobileNavOpen(false)}
          />
          {/* The Sidebar itself is fixed right-0 w-[220px] — exactly the drawer we need */}
          <Sidebar onNavigate={() => setMobileNavOpen(false)} />
          <button
            onClick={() => setMobileNavOpen(false)}
            className="absolute top-3.5 right-[232px] w-9 h-9 rounded-full bg-black/55 text-white/80 flex items-center justify-center"
            aria-label="סגור תפריט"
          >
            <X size={17} />
          </button>
        </div>
      )}

      {/* Main — sidebar margin only on desktop */}
      <main className="lg:mr-[220px] min-h-screen">
        <div className="max-w-[1100px] mx-auto px-4 py-5 lg:px-7 lg:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
