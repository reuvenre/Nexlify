'use client';

import { useState } from 'react';
import { Check, Zap, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';

type Billing = 'monthly' | 'annual';

const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    priceMonthly: 69,
    priceAnnual: 55,
    credits: 500,
    groups: '1',
    groupsLabel: '1 קבוצות',
    popular: false,
    features: ['AliExpress', 'טלגרם', 'כותב תוכן AI', 'פרסום אוטומטי'],
    includesLabel: 'כולל',
  },
  {
    id: 'growth',
    name: 'Growth',
    priceMonthly: 149,
    priceAnnual: 119,
    credits: 1500,
    groups: '5',
    groupsLabel: '5 קבוצות',
    popular: true,
    features: ['פרסום חוזר אוטומטי', 'אינטגרציית אמזון', 'מעקב פוסטים', 'וואטסאפ', 'פייסבוק', 'אינסטגרם', 'משפר תמונות AI'],
    includesLabel: 'כל מה שבתוכנית הקודמת, ובנוסף',
  },
  {
    id: 'autopilot',
    name: 'Autopilot',
    priceMonthly: 259,
    priceAnnual: 207,
    credits: 3000,
    groups: '10',
    groupsLabel: '10 קבוצות',
    popular: false,
    features: ['מצב טייס אוטומטי', 'גילוי מוצרים AI'],
    includesLabel: 'כל מה שבתוכנית הקודמת, ובנוסף',
  },
  {
    id: 'scale',
    name: 'Scale',
    priceMonthly: 449,
    priceAnnual: 359,
    credits: 6000,
    groups: '∞',
    groupsLabel: 'ללא הגבלה',
    popular: false,
    features: ['פינטרסט'],
    includesLabel: 'כל מה שבתוכנית הקודמת, ובנוסף',
  },
];

export function SubscriptionForm() {
  const [billing, setBilling] = useState<Billing>('monthly');
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header banner */}
      {isAdmin ? (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3 flex items-center gap-3">
          <ShieldCheck size={16} className="text-emerald-400 shrink-0" />
          <p className="text-xs text-emerald-300">
            אתה מנהל המערכת — יש לך גישה מלאה לכל הפיצ׳רים בכל התוכניות, ללא הגבלה.
          </p>
        </div>
      ) : (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3 flex items-center gap-3">
          <span className="text-xs bg-blue-600 text-white rounded-full px-2.5 py-0.5 font-semibold">התוכנית הנוכחית</span>
          <span className="text-xs text-white/60">{PLANS.find((p) => p.id === user?.plan)?.name ?? 'חינמי'}</span>
        </div>
      )}

      {/* Billing toggle */}
      <div className="flex items-center justify-center gap-3">
        <span className={`text-sm font-medium transition-colors ${billing === 'monthly' ? 'text-white' : 'text-white/40'}`}>חודשי</span>
        <div className="relative">
          <button
            onClick={() => setBilling(billing === 'monthly' ? 'annual' : 'monthly')}
            className={`relative w-11 h-6 rounded-full transition-colors ${billing === 'annual' ? 'bg-blue-600' : 'bg-white/15'}`}
          >
            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${billing === 'annual' ? 'right-0.5' : 'right-5'}`} />
          </button>
        </div>
        <span className={`text-sm font-medium transition-colors ${billing === 'annual' ? 'text-white' : 'text-white/40'}`}>שנתי</span>
        {billing === 'annual' && (
          <span className="text-2xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full px-2 py-0.5 font-medium">
            חסון ₪298
          </span>
        )}
      </div>

      {/* Plans grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {PLANS.map((plan) => {
          const price = billing === 'annual' ? plan.priceAnnual : plan.priceMonthly;
          const isCurrent = !isAdmin && user?.plan === plan.id;
          return (
            <div
              key={plan.id}
              className={`relative flex flex-col rounded-2xl border p-5 transition-all
                ${isCurrent
                  ? 'bg-blue-600/10 border-blue-500/50 ring-1 ring-blue-500/30'
                  : 'bg-surface-secondary border-edge hover:border-white/20'}`}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-blue-600 text-white text-2xs font-bold rounded-full px-3 py-1 whitespace-nowrap">
                    הבחירה הפופולרית
                  </span>
                </div>
              )}

              {/* Plan header */}
              <div className="mb-4 text-center">
                <p className="text-base font-bold text-white mb-1">{plan.name}</p>
                <div className="flex items-baseline justify-center gap-1">
                  <span className="text-3xl font-extrabold text-white">₪{price}</span>
                  <span className="text-xs text-white/40">חודש</span>
                </div>
                <p className="text-2xs text-white/30 mt-0.5">מתחדש מדי חודש</p>
              </div>

              {/* Credits + groups */}
              <div className="flex justify-center gap-4 mb-4 text-xs">
                <div className="flex items-center gap-1 text-white/60">
                  <Zap size={11} className="text-amber-400" />
                  {plan.credits.toLocaleString()} קרדיטים
                </div>
                <div className="flex items-center gap-1 text-white/60">
                  <span>📡</span>
                  {plan.groupsLabel}
                </div>
              </div>

              {/* CTA button */}
              <button
                disabled={isCurrent}
                className={`w-full py-2.5 rounded-xl text-sm font-semibold mb-4 transition-all
                  ${isCurrent
                    ? 'bg-blue-600 text-white cursor-default'
                    : 'bg-blue-600 hover:bg-blue-500 text-white'}`}
              >
                {isCurrent ? 'התוכנית הנוכחית' : 'לרכישה'}
              </button>
              {!isCurrent && (
                <p className="text-[9px] text-white/25 text-center -mt-3 mb-3">ניתן לבטל בכל עת, ללא התחייבות</p>
              )}

              {/* Features */}
              <div className="border-t border-edge pt-3 mt-auto">
                <p className="text-2xs font-semibold text-white/40 mb-2">{plan.includesLabel}</p>
                <ul className="space-y-1.5">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-xs text-white/60">
                      <Check size={11} className="text-emerald-400 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-white/25 text-center">
        לשאלות בנוגע לחיוב פנה אלינו ל-support@alibot.pro
      </p>
    </div>
  );
}
