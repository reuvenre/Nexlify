'use client';

import { useEffect, useState } from 'react';
import { Check, Zap, Loader2, Mail, ArrowUpCircle } from 'lucide-react';
import { subscriptionApi } from '@/lib/api-client';
import type { BillingCycle, PlanDef, SubscriptionStatus } from '@/types';

// Where upgrade requests go until a real payment gateway is wired.
const SUPPORT_EMAIL = 'support@alibot.pro';

// Feature lists are marketing copy (what each tier includes). Numbers (price,
// credits, groups) come from the backend catalog — single source of truth.
// Features not yet live in the product are explicitly tagged "בקרוב" so the
// pricing page never promises something a customer can't find.
const PLAN_FEATURES: Record<string, { includesLabel: string; features: { label: string; soon?: boolean }[] }> = {
  starter: {
    includesLabel: 'כולל',
    features: [
      { label: 'AliExpress' },
      { label: 'טלגרם' },
      { label: 'כותב תוכן AI' },
      { label: 'פרסום אוטומטי' },
    ],
  },
  growth: {
    includesLabel: 'כל מה שבתוכנית הקודמת, ובנוסף',
    features: [
      { label: 'פייסבוק' },
      { label: 'תור פרסום חכם' },
      { label: 'האצת מודעות אוטומטית (Meta)' },
      { label: 'וואטסאפ', soon: true },
      { label: 'אינסטגרם' },
      { label: 'משפר תמונות AI' },
    ],
  },
  autopilot: {
    includesLabel: 'כל מה שבתוכנית הקודמת, ובנוסף',
    features: [
      { label: 'גילוי מוצרים AI' },
      { label: 'סוכני AI לניהול הטייס האוטומטי' },
      { label: 'אינטגרציית אמזון', soon: true },
    ],
  },
  scale: {
    // The top tier is an explicit superset — it visibly lists every feature from
    // all cheaper plans, not just its own extras, so buyers see they get everything.
    includesLabel: 'הכול — כל הפיצ׳רים מכל התוכניות, כולל',
    features: [
      { label: 'קבוצות ללא הגבלה' },
      { label: 'AliExpress' },
      { label: 'טלגרם' },
      { label: 'פייסבוק' },
      { label: 'כותב תוכן AI' },
      { label: 'פרסום אוטומטי' },
      { label: 'תור פרסום חכם' },
      { label: 'האצת מודעות אוטומטית (Meta)' },
      { label: 'גילוי מוצרים AI' },
      { label: 'סוכני AI לניהול הטייס האוטומטי' },
      { label: 'מעקב טוקנים ותקציב AI' },
      { label: '50,000 קרדיטים בחודש' },
      { label: 'וואטסאפ', soon: true },
      { label: 'אינסטגרם' },
      { label: 'משפר תמונות AI' },
      { label: 'אינטגרציית אמזון', soon: true },
      { label: 'פינטרסט' },
    ],
  },
};

export function SubscriptionForm() {
  const [billing, setBilling] = useState<BillingCycle>('monthly');
  const [plans, setPlans] = useState<PlanDef[]>([]);
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([subscriptionApi.plans(), subscriptionApi.status()])
      .then(([p, s]) => {
        setPlans(p);
        setStatus(s);
        setBilling(s.billing || 'monthly');
      })
      .catch(() => setError('טעינת פרטי המנוי נכשלה'))
      .finally(() => setLoading(false));
  }, []);

  // A plan is a paid product and there's no payment gateway yet, so the UI never
  // activates a plan itself — an upgrade opens a pre-filled email to the team, who
  // set the plan via the admin panel. No client path can grant a paid tier for free.
  const upgradeMailto = (plan: PlanDef) => {
    const cycle = billing === 'annual' ? 'שנתי' : 'חודשי';
    const subject = `בקשת שדרוג לתוכנית ${plan.name}`;
    const body = `היי, אני רוצה לשדרג לתוכנית ${plan.name} (חיוב ${cycle}).`;
    return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-white/40">
        <Loader2 size={20} className="animate-spin ml-2" /> טוען פרטי מנוי...
      </div>
    );
  }

  const creditsPct = status && status.monthly_credits > 0
    ? Math.min(100, Math.round((status.credits_remaining / status.monthly_credits) * 100))
    : 0;
  const renewsLabel = status?.renews_at
    ? new Date(status.renews_at).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })
    : '—';
  const annualSaving = (() => {
    const p = plans.find((x) => x.id === status?.plan);
    return p ? (p.price_monthly - p.price_annual) * 12 : 0;
  })();

  return (
    <div className="space-y-6" dir="rtl">
      {/* Current plan + credits banner (live data) */}
      {status && (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3 flex flex-wrap items-center gap-3">
          <span className="text-xs bg-blue-600 text-white rounded-full px-2.5 py-0.5 font-semibold">
            {status.plan_name}
          </span>
          <span className="text-xs text-white/60">הקרדיטים מתחדשים ב-{renewsLabel}</span>
          <div className="mr-auto flex items-center gap-3 text-xs text-white/50">
            <span className="flex items-center gap-1.5">
              <Zap size={11} className="text-amber-400" />
              {status.credits_remaining.toLocaleString()} / {status.monthly_credits.toLocaleString()} קרדיטים
            </span>
            <div className="w-24 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-500 to-blue-500 rounded-full transition-all"
                style={{ width: `${creditsPct}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/25 text-red-300 text-sm rounded-xl px-4 py-3">{error}</div>
      )}

      {/* Billing toggle */}
      <div className="flex items-center justify-center gap-3">
        <span className={`text-sm font-medium transition-colors ${billing === 'monthly' ? 'text-white' : 'text-white/40'}`}>חודשי</span>
        <button
          onClick={() => setBilling(billing === 'monthly' ? 'annual' : 'monthly')}
          className={`relative w-11 h-6 rounded-full transition-colors ${billing === 'annual' ? 'bg-blue-600' : 'bg-white/15'}`}
        >
          {/* RTL: חודשי is on the right, שנתי on the left — so monthly puts the knob
              on the right, annual on the left (was inverted, pointing at the wrong label). */}
          <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${billing === 'annual' ? 'left-0.5' : 'right-0.5'}`} />
        </button>
        <span className={`text-sm font-medium transition-colors ${billing === 'annual' ? 'text-white' : 'text-white/40'}`}>שנתי</span>
        {billing === 'annual' && annualSaving > 0 && (
          <span className="text-2xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full px-2 py-0.5 font-medium">
            חיסכון ₪{annualSaving.toLocaleString()} בשנה
          </span>
        )}
      </div>

      {/* Upgrades are handled by the team (no self-checkout), so the UI is honest about
          how to move up rather than showing a button that silently grants a paid tier. */}
      <div className="flex items-start gap-2.5 bg-blue-500/[0.07] border border-blue-500/20 rounded-xl px-4 py-3">
        <ArrowUpCircle size={14} className="text-blue-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-xs text-blue-300 font-medium">שדרוג תוכנית</p>
          <p className="text-2xs text-white/40 mt-0.5 leading-relaxed">
            כדי לשדרג, לחץ על "פנה לשדרוג" בתוכנית הרצויה — נחזור אליך ונפעיל אותה. שער
            תשלום אוטומטי בקרוב.
          </p>
        </div>
      </div>

      {/* Plans grid (catalog from backend) */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {plans.map((plan) => {
          const price = billing === 'annual' ? plan.price_annual : plan.price_monthly;
          const isCurrent = status?.plan === plan.id;
          const meta = PLAN_FEATURES[plan.id] || { includesLabel: 'כולל', features: [] };
          const groupsLabel = plan.max_groups === null ? 'ללא הגבלה' : `${plan.max_groups} קבוצות`;

          return (
            <div
              key={plan.id}
              className={`relative flex flex-col rounded-2xl border p-5 transition-all
                ${isCurrent
                  ? 'bg-blue-600/10 border-blue-500/50 ring-1 ring-blue-500/30'
                  : 'bg-surface-secondary border-edge hover:border-white/20'}`}
            >
              {plan.popular && !isCurrent && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-blue-600 text-white text-2xs font-bold rounded-full px-3 py-1 whitespace-nowrap">
                    הבחירה הפופולרית
                  </span>
                </div>
              )}

              <div className="mb-4 text-center">
                <p className="text-base font-bold text-white mb-1">{plan.name}</p>
                <div className="flex items-baseline justify-center gap-1">
                  <span className="text-3xl font-extrabold text-white">₪{price}</span>
                  <span className="text-xs text-white/40">לחודש</span>
                </div>
                <p className="text-2xs text-white/30 mt-0.5">
                  {billing === 'annual' ? 'מחיר בחיוב שנתי' : 'מחיר לחודש'}
                </p>
              </div>

              <div className="flex justify-center gap-4 mb-4 text-xs">
                <div className="flex items-center gap-1 text-white/60">
                  <Zap size={11} className="text-amber-400" />
                  {plan.monthly_credits.toLocaleString()} קרדיטים
                </div>
                <div className="flex items-center gap-1 text-white/60">
                  <span>📡</span>
                  {groupsLabel}
                </div>
              </div>

              {isCurrent ? (
                <button
                  disabled
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold mb-4 bg-blue-600 text-white cursor-default"
                >
                  התוכנית הנוכחית
                </button>
              ) : (
                <a
                  href={upgradeMailto(plan)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold mb-4 bg-blue-600 hover:bg-blue-500 text-white transition-all"
                >
                  <Mail size={14} />
                  פנה לשדרוג
                </a>
              )}

              <div className="border-t border-edge pt-3 mt-auto">
                <p className="text-2xs font-semibold text-white/40 mb-2">{meta.includesLabel}</p>
                <ul className="space-y-1.5">
                  {meta.features.map((f) => (
                    <li key={f.label} className="flex items-center gap-2 text-xs text-white/60">
                      <Check size={11} className={`shrink-0 ${f.soon ? 'text-white/25' : 'text-emerald-400'}`} />
                      <span className={f.soon ? 'text-white/35' : ''}>{f.label}</span>
                      {f.soon && (
                        <span className="text-[9px] bg-white/5 border border-white/10 text-white/35 rounded-full px-1.5 py-px">
                          בקרוב
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-white/25 text-center">
        לשאלות בנוגע לחיוב פנה אלינו ל-{SUPPORT_EMAIL}
      </p>
    </div>
  );
}
