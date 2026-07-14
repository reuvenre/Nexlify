'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { useTheme } from '@/lib/hooks/useTheme';
import {
  LayoutDashboard, Megaphone, Zap, FileText, Layout,
  Users, BarChart3, Settings, LogOut, Tag,
  ShoppingCart, Sun, Moon, Sparkles, Package,
  Rocket, Shield, Ticket,
} from 'lucide-react';

const NAV_SECTIONS = [
  {
    title: 'פרסום',
    items: [
      { href: '/dashboard',  label: 'דשבורד',    icon: LayoutDashboard },
      { href: '/campaigns',  label: 'קמפיינים',   icon: Megaphone },
      { href: '/quick-post', label: 'פוסט מהיר',  icon: Zap },
      { href: '/posts',      label: 'פוסטים',     icon: FileText },
    ],
  },
  {
    title: 'ניהול',
    items: [
      { href: '/products',   label: 'מוצרים',     icon: Package },
      { href: '/templates',  label: 'תבניות',     icon: Layout },
      { href: '/categories', label: 'קטגוריות',   icon: Tag },
      { href: '/groups',     label: 'ערוצים',     icon: Users },
      { href: '/coupons',    label: 'קופונים',    icon: Ticket },
    ],
  },
  {
    title: 'נתונים',
    items: [
      { href: '/ads',     label: 'מודעות Boost', icon: Rocket },
      { href: '/orders',  label: 'הזמנות', icon: ShoppingCart },
      { href: '/reports', label: 'דוחות',  icon: BarChart3 },
    ],
  },
];

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const isActive = (href: string) =>
    pathname === href ||
    (href !== '/dashboard' && pathname.startsWith(href + '/')) ||
    // The FLYLINK products screen lives under /suppliers but is the same "מוצרים" nav item.
    (href === '/products' && pathname.startsWith('/suppliers'));

  const initials = user?.email?.[0]?.toUpperCase() ?? '?';
  const username = user?.email?.split('@')[0] ?? '';

  return (
    <aside className="sidebar-root fixed right-0 top-0 h-full w-[220px] bg-surface-sidebar border-l border-edge flex flex-col z-40 select-none">

      {/* ── Logo ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 pt-5 pb-4 border-b border-edge">
        <div className="relative shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="Nexlify" className="w-8 h-8 rounded-[10px] shadow-lg shadow-blue-600/25" />
          <span className="absolute -bottom-0.5 -left-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-surface-sidebar" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-body font-semibold text-white tracking-tight leading-none">Nexlify</p>
          <p className="text-2xs text-white/30 mt-0.5 leading-none">מבית Win Solutions</p>
        </div>

        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? 'מצב בהיר' : 'מצב כהה'}
          className="w-6 h-6 rounded-md flex items-center justify-center text-white/25 hover:text-white/70 hover:bg-white/[0.08] transition-all shrink-0"
        >
          {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
        </button>
      </div>

      {/* ── Navigation ───────────────────────────────────────────────────── */}
      <nav className="flex-1 px-3 py-3 overflow-y-auto space-y-5">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title}>
            <p className="section-label px-2.5 mb-1.5">
              {section.title}
            </p>

            <div className="space-y-px">
              {section.items.map(({ href, label, icon: Icon }) => {
                const active = isActive(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={onNavigate}
                    className={`group relative flex items-center gap-2.5 px-2.5 py-[7px] rounded-[9px] text-body font-medium transition-all duration-150
                      ${active
                        ? 'bg-gradient-to-l from-blue-500/[0.18] to-violet-500/[0.07] text-blue-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                        : 'text-white/40 hover:text-white/80 hover:bg-white/[0.05]'
                      }`}
                  >
                    {active && (
                      <span className="absolute inset-y-1.5 right-0 w-[3px] rounded-full bg-gradient-to-b from-blue-400 to-violet-500 shadow-[0_0_8px_rgba(59,130,246,0.55)]" />
                    )}
                    <Icon
                      size={14}
                      className={`shrink-0 transition-colors duration-150
                        ${active ? 'text-blue-300' : 'text-white/30 group-hover:text-white/55'}`}
                    />
                    <span className="truncate">{label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* ── Admin (admins only) ──────────────────────────────────────────── */}
      {user?.role === 'admin' && (
        <div className="px-3 pb-1 border-t border-edge pt-2.5">
          <p className="section-label px-2.5 mb-1.5">ניהול מערכת</p>
          <Link
            href="/admin/users"
            onClick={onNavigate}
            className={`group relative flex items-center gap-2.5 px-2.5 py-[7px] rounded-[9px] text-body font-medium transition-all duration-150
              ${isActive('/admin/users')
                ? 'bg-violet-500/[0.14] text-violet-300'
                : 'text-white/40 hover:text-white/80 hover:bg-white/[0.05]'}`}
          >
            {isActive('/admin/users') && (
              <span className="absolute inset-y-1.5 right-0 w-[3px] rounded-full bg-violet-500" />
            )}
            <Shield size={14} className={`shrink-0 ${isActive('/admin/users') ? 'text-violet-300' : 'text-white/30 group-hover:text-white/55'}`} />
            <span>ניהול משתמשים</span>
          </Link>
        </div>
      )}

      {/* ── Settings ─────────────────────────────────────────────────────── */}
      <div className="px-3 pb-2 border-t border-edge pt-2.5">
        <Link
          href="/settings"
          onClick={onNavigate}
          className={`group relative flex items-center gap-2.5 px-2.5 py-[7px] rounded-[9px] text-body font-medium transition-all duration-150
            ${isActive('/settings')
              ? 'bg-gradient-to-l from-blue-500/[0.18] to-violet-500/[0.07] text-blue-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
              : 'text-white/40 hover:text-white/80 hover:bg-white/[0.05]'
            }`}
        >
          {isActive('/settings') && (
            <span className="absolute inset-y-1.5 right-0 w-[3px] rounded-full bg-gradient-to-b from-blue-400 to-violet-500 shadow-[0_0_8px_rgba(59,130,246,0.55)]" />
          )}
          <Settings
            size={14}
            className={`shrink-0 transition-colors duration-150
              ${isActive('/settings') ? 'text-blue-300' : 'text-white/30 group-hover:text-white/55'}`}
          />
          <span>הגדרות</span>
        </Link>
      </div>

      {/* ── User ─────────────────────────────────────────────────────────── */}
      <div className="px-3 py-3 border-t border-edge">
        <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-[10px] hover:bg-white/[0.04] transition-colors cursor-default group">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center text-xs font-semibold text-white shrink-0">
            {initials}
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-white/65 truncate leading-tight">{username}</p>
            <div className="flex items-center gap-1 mt-0.5">
              <Sparkles size={8} className="text-blue-400 shrink-0" />
              <p className="text-2xs text-blue-400/70 leading-none">Pro</p>
            </div>
          </div>

          <button
            onClick={logout}
            className="p-1 rounded-md text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-all opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
            title="התנתק"
          >
            <LogOut size={13} />
          </button>
        </div>
      </div>
    </aside>
  );
}
