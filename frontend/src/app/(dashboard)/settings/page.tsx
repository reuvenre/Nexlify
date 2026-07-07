'use client';

import { useEffect, useState } from 'react';
import { User, ShoppingBag, Plug, ShieldCheck, Bell, CreditCard, ListOrdered, Calculator } from 'lucide-react';
import { CredentialsForm }    from '@/components/settings/CredentialsForm';
import { ProfileForm }        from '@/components/settings/ProfileForm';
import { IntegrationsForm }   from '@/components/settings/IntegrationsForm';
import { SecurityForm }       from '@/components/settings/SecurityForm';
import { NotificationsForm }  from '@/components/settings/NotificationsForm';
import { SubscriptionForm }   from '@/components/settings/SubscriptionForm';
import { SchedulingForm }     from '@/components/settings/SchedulingForm';
import { PricingForm }        from '@/components/settings/PricingForm';

type Tab = 'profile' | 'marketplaces' | 'pricing' | 'integrations' | 'scheduling' | 'security' | 'notifications' | 'subscription';

const TABS: { id: Tab; label: string; icon: React.ElementType; desc: string }[] = [
  { id: 'profile',       label: 'פרופיל',        icon: User,          desc: 'פרטי חשבון והעדפות' },
  { id: 'marketplaces',  label: 'שווקים',         icon: ShoppingBag,   desc: 'AliExpress ו-OpenAI' },
  { id: 'pricing',       label: 'תמחור',          icon: Calculator,    desc: 'המרת מטבע, רווח ועיגול' },
  { id: 'integrations',  label: 'אינטגרציות',     icon: Plug,          desc: 'Telegram וערוצים' },
  { id: 'scheduling',    label: 'תזמון אוטומטי',  icon: ListOrdered,   desc: 'הגדרות תור שליחה אוטומטי' },
  { id: 'security',      label: 'אבטחה',          icon: ShieldCheck,   desc: 'שינוי סיסמה' },
  { id: 'notifications', label: 'התראות',         icon: Bell,          desc: 'העדפות עדכונים' },
  { id: 'subscription',  label: 'מנוי',           icon: CreditCard,    desc: 'תוכנית וקרדיטים' },
];

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('marketplaces');
  const active = TABS.find((t) => t.id === tab)!;

  // Deep-link support: /settings?tab=subscription opens the requested tab (read via
  // window.location instead of useSearchParams to avoid a Suspense boundary requirement).
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('tab') as Tab | null;
    if (wanted && TABS.some((t) => t.id === wanted)) setTab(wanted);
  }, []);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">הגדרות</h1>
        <p className="text-sm text-white/40 mt-1">נהל את החשבון, שווקים, אינטגרציות ואבטחה</p>
      </div>

      <div className="flex gap-6 min-h-0">
        {/* Sidebar */}
        <aside className="w-52 shrink-0 space-y-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-right
                ${tab === id
                  ? id === 'scheduling'
                    ? 'bg-gradient-to-l from-amber-500/[0.16] to-amber-500/[0.04] text-amber-400 border border-amber-500/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
                    : 'bg-gradient-to-l from-blue-500/[0.16] to-violet-500/[0.05] text-blue-400 border border-blue-500/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
                  : 'text-white/45 hover:text-white/80 hover:bg-white/5 border border-transparent'
                }`}
            >
              <Icon
                size={15}
                className={tab === id
                  ? id === 'scheduling' ? 'text-amber-400' : 'text-blue-400'
                  : 'text-white/30'
                }
              />
              {label}
            </button>
          ))}
        </aside>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-white">{active.label}</h2>
            <p className="text-xs text-white/35 mt-0.5">{active.desc}</p>
          </div>

          {tab === 'profile'       && <ProfileForm />}
          {tab === 'marketplaces'  && <CredentialsForm />}
          {tab === 'pricing'       && <PricingForm />}
          {tab === 'integrations'  && <IntegrationsForm />}
          {tab === 'scheduling'    && <SchedulingForm />}
          {tab === 'security'      && <SecurityForm />}
          {tab === 'notifications' && <NotificationsForm />}
          {tab === 'subscription'  && <SubscriptionForm />}
        </div>
      </div>
    </div>
  );
}
