'use client';

import { useEffect, useState } from 'react';
import {
  Check, Zap, Loader2, ArrowUpCircle, Rocket, Flame, X, CheckCircle2, ShieldCheck,
} from 'lucide-react';
import { subscriptionApi } from '@/lib/api-client';
import { dealFor, dealPrice, endsInLabel } from '@/lib/deals';
import type { ActiveDeal, BillingCycle, CreditPack, PlanDef, SubscriptionStatus } from '@/types';

// Where upgrade requests go until a real payment gateway is wired.
const SUPPORT_EMAIL = 'support@alibot.pro';

// Feature lists are marketing copy (what each tier includes). Numbers (price,
// credits, groups) come from the backend catalog — single source of truth.
// Features not yet live in the product are explicitly tagged "בקרוב" so the
// pricing page never promises something a customer can't find.
// This matrix MIRRORS the backend gating map (plans.const.ts FEATURE_MIN_PLAN)
// and the public /pricing page. Every line here is actually enforced — never list
// a feature the backend doesn't unlock at that tier.
const PLAN_FEATURES: Record<string, { includesLabel: string; features: { label: string; soon?: boolean }[] }> = {
  starter: {
    includesLabel: 'כולל',
    features: [
      { label: 'מקור מוצרים: AliExpress' },
      { label: 'פרסום ל-Telegram' },
      { label: 'AI כותב פוסטים, אתם מאשרים' },
      { label: 'לינקים חכמים + מעקב קליקים' },
      { label: 'סנכרון הזמנות ועמלות אוטומטי' },
    ],
  },
  growth: {
    includesLabel: 'כל מה שב-Starter, ובנוסף',
    features: [
      { label: 'פרסום ל-Facebook, Instagram ו-Pinterest' },
      { label: 'חיבור WhatsApp אחד' },
      { label: 'סוכן AI לגילוי מוצרים' },
      { label: 'משפר תמונות AI' },
      { label: 'תור פרסום חכם' },
      { label: 'דוח "מה מכניס כסף" — עמלות עד רמת הפוסט' },
    ],
  },
  autopilot: {
    includesLabel: 'כל מה שב-Growth, ובנוסף',
    features: [
      { label: 'מצב טייס אוטומטי — מגילוי ועד פרסום, אפס קלט' },
      { label: 'סוכני AI לניהול הקמפיינים' },
      { label: 'מקור מוצרים נוסף: Amazon' },
      { label: 'מיחזור מנצחים אוטומטי' },
      { label: 'עונתיות — לוח שנה מסחרי' },
      { label: 'חלון שליחה לפי אזור זמן' },
      { label: '2 חיבורי WhatsApp' },
    ],
  },
  scale: {
    includesLabel: 'כל מה שב-Autopilot, ובנוסף',
    features: [
      { label: 'קמפיינים באנגלית לקהל ארה"ב (USD)' },
      { label: 'פינטרסט SEO לשוק האמריקאי' },
      { label: 'מעקב טוקנים ותקציב AI' },
      { label: 'דוחות רווח והפסד מתקדמים' },
      { label: '3 חיבורי WhatsApp' },
      { label: 'תמיכה בעדיפות' },
    ],
  },
};

export function SubscriptionForm() {
  const [billing, setBilling] = useState<BillingCycle>('monthly');
  const [plans, setPlans] = useState<PlanDef[]>([]);
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [deals, setDeals] = useState<ActiveDeal[]>([]);
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      subscriptionApi.plans(), subscriptionApi.status(),
      subscriptionApi.packs().catch(() => []),
      subscriptionApi.activeDeals().catch(() => []),
    ])
      .then(([p, s, pk, dl]) => {
        setPlans(p);
        setStatus(s);
        setPacks(pk);
        setDeals(dl);
        setBilling(s.billing || 'monthly');
      })
      .catch(() => setError('טעינת פרטי המנוי נכשלה'))
      .finally(() => setLoading(false));
  }, []);

  // A plan is a paid product and there's no payment gateway yet, so the UI never
  // activates a plan itself — an upgrade opens a pre-filled email to the team, who
  // set the plan via the admin panel. No client path can grant a paid tier for free.
  // Self-service upgrade: the card button opens a confirm dialog with the new
  // plan's full quote; confirming hits POST /subscription/upgrade. With a payment
  // gateway configured the server answers with a checkout redirect (plan flips the
  // second the webhook lands); until then the request is recorded for activation.
  const [upgrading, setUpgrading] = useState<PlanDef | null>(null);

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
            {status.unlimited ? (
              <span className="flex items-center gap-1.5 text-amber-300 font-semibold">
                <Zap size={11} className="text-amber-400" />
                קרדיטים ללא הגבלה (חשבון מנהל) ∞
              </span>
            ) : (
              <>
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
              </>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/25 text-red-300 text-sm rounded-xl px-4 py-3">{error}</div>
      )}

      {/* Active promotion banner */}
      {deals.length > 0 && (
        <div className="flex items-center justify-center gap-2.5 bg-gradient-to-r from-amber-500/15 to-orange-500/15 border border-amber-500/35 rounded-xl px-4 py-3">
          <Flame size={15} className="text-amber-400 shrink-0" />
          <span className="text-sm font-semibold text-amber-200">{deals[0].title}</span>
          {endsInLabel(deals[0].ends_at) && (
            <span className="text-xs text-amber-300/70">⏳ {endsInLabel(deals[0].ends_at)}</span>
          )}
        </div>
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
            לחץ על "שדרג לתוכנית זו", אשר את הפרטים בחלון — והבקשה יוצאת מיד. עם חיבור שער
            התשלום ההפעלה תהיה אוטומטית באותה שנייה.
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
          const deal = dealFor(deals, 'plan', plan.id);
          const promoPrice = deal ? dealPrice(price, deal) : null;
          const onSale = promoPrice != null && promoPrice < price;

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
                <div className="flex items-center justify-center gap-1.5 mb-1">
                  <p className="text-base font-bold text-white">{plan.name}</p>
                  {onSale && (
                    <span className="text-2xs font-bold bg-amber-500 text-black rounded-full px-1.5 py-px">מבצע</span>
                  )}
                </div>
                <div className="flex items-baseline justify-center gap-1.5">
                  {onSale && <span className="text-sm font-semibold text-white/35 line-through">₪{price}</span>}
                  <span className={`text-3xl font-extrabold ${onSale ? 'text-amber-300' : 'text-white'}`}>
                    ₪{onSale ? promoPrice : price}
                  </span>
                  <span className="text-xs text-white/40">לחודש</span>
                </div>
                <p className="text-2xs text-white/30 mt-0.5">
                  {onSale && endsInLabel(deal!.ends_at)
                    ? `⏳ ${endsInLabel(deal!.ends_at)}`
                    : billing === 'annual' ? 'מחיר בחיוב שנתי' : 'מחיר לחודש'}
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
                <button
                  onClick={() => setUpgrading(plan)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold mb-4 bg-blue-600 hover:bg-blue-500 text-white transition-all"
                >
                  <ArrowUpCircle size={14} />
                  שדרג לתוכנית זו
                </button>
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

      {/* One-time credit packs — bridge the current month when the quota runs out.
          Purchase goes through the team (mailto), same policy as plan upgrades. */}
      {packs.length > 0 && !status?.unlimited && (
        <div className="pt-2">
          <div className="flex items-center gap-2 mb-1">
            <Rocket size={15} className="text-amber-400" />
            <h3 className="text-sm font-bold text-white">נגמרים הקרדיטים? חבילות טעינה חד-פעמיות</h3>
          </div>
          <p className="text-xs text-white/40 mb-4">
            הקרדיטים מתווספים מיד ליתרה הנוכחית ונשמרים עד סוף החודש. המנוי החודשי תמיד משתלם יותר לאורך זמן.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {packs.map((pack) => {
              const deal = dealFor(deals, 'pack', pack.id);
              const promo = deal ? dealPrice(pack.price, deal) : null;
              const packSale = promo != null && promo < pack.price;
              const payPrice = packSale ? promo : pack.price;
              const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`רכישת ${pack.label} — ${pack.credits.toLocaleString()} קרדיטים`)}&body=${encodeURIComponent(`היי, אני רוצה לרכוש את ${pack.label} (${pack.credits.toLocaleString()} קרדיטים ב-₪${payPrice}${packSale ? ' — מחיר מבצע' : ''}).`)}`;
              return (
                <div key={pack.id} className="bg-surface-secondary border border-edge rounded-2xl p-4 text-center hover:border-amber-500/40 transition-all">
                  <p className="text-xs font-semibold text-amber-300 mb-1">
                    {pack.label}{packSale && <span className="mr-1.5 text-2xs font-bold bg-amber-500 text-black rounded-full px-1.5 py-px">מבצע</span>}
                  </p>
                  <p className="text-2xl font-extrabold text-white">
                    {pack.credits.toLocaleString()}
                    <span className="text-xs font-normal text-white/40 mr-1">קרדיטים</span>
                  </p>
                  <p className="text-sm text-white/60 mt-1 mb-3">
                    {packSale && <span className="text-white/35 line-through ml-1.5">₪{pack.price}</span>}
                    <span className={packSale ? 'text-amber-300 font-semibold' : ''}>₪{payPrice}</span> · חד-פעמי
                  </p>
                  <a href={mailto}
                    className="block w-full py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-400 text-black transition-all">
                    פנה לרכישה
                  </a>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-xs text-white/25 text-center">
        לשאלות בנוגע לחיוב פנה אלינו ל-{SUPPORT_EMAIL}
      </p>

      {upgrading && (
        <UpgradeConfirmModal
          plan={upgrading}
          billing={billing}
          deals={deals}
          features={PLAN_FEATURES[upgrading.id]?.features.map((f) => f.label) || []}
          onClose={() => setUpgrading(null)}
        />
      )}
    </div>
  );
}

/**
 * Upgrade confirmation dialog — the full quote (price with any promo, credits,
 * groups, headline features) and one confirm button. Confirm calls the upgrade
 * endpoint: a configured payment gateway answers with a checkout redirect
 * (instant activation via webhook); until then the request is recorded and the
 * user sees a clear "pending payment" state.
 */
function UpgradeConfirmModal({ plan, billing, deals, features, onClose }: {
  plan: PlanDef; billing: BillingCycle; deals: ActiveDeal[]; features: string[]; onClose: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<null | { price: number }>(null);
  const [error, setError] = useState('');

  const base = billing === 'annual' ? plan.price_annual : plan.price_monthly;
  const deal = dealFor(deals, 'plan', plan.id);
  const promo = deal ? dealPrice(base, deal) : null;
  const onSale = promo != null && promo < base;
  const finalPrice = onSale ? promo : base;
  const groupsLabel = plan.max_groups === null ? 'קבוצות ללא הגבלה' : `${plan.max_groups} קבוצות`;

  const confirm = async () => {
    setSubmitting(true); setError('');
    try {
      const r = await subscriptionApi.upgrade(plan.id, billing);
      if (r.status === 'checkout' && r.checkout_url) {
        window.location.href = r.checkout_url; // gateway flow — activation lands via webhook
        return;
      }
      setDone({ price: r.price });
    } catch (e: any) {
      setError(e?.response?.data?.message || 'שליחת הבקשה נכשלה — נסה שוב');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-surface-secondary border border-edge rounded-2xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge">
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            <ArrowUpCircle size={17} className="text-blue-400" /> אישור שדרוג
          </h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all">
            <X size={16} />
          </button>
        </div>

        <div className="p-5">
          {done ? (
            <div className="text-center py-4">
              <CheckCircle2 size={40} className="text-emerald-400 mx-auto mb-3" />
              <p className="text-white font-semibold mb-1.5">הבקשה נקלטה! 🎉</p>
              <p className="text-sm text-white/55 leading-relaxed">
                נחזור אליך להסדרת התשלום (₪{done.price} {billing === 'annual' ? 'לחודש בחיוב שנתי' : 'לחודש'}),
                והתוכנית תופעל מיד לאחריו.
              </p>
              <button onClick={onClose}
                className="mt-4 px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-all">
                סגור
              </button>
            </div>
          ) : (
            <>
              <div className="bg-blue-500/[0.07] border border-blue-500/20 rounded-xl p-4 mb-4 text-center">
                <p className="text-lg font-bold text-white mb-1">{plan.name}</p>
                <div className="flex items-baseline justify-center gap-1.5">
                  {onSale && <span className="text-sm text-white/35 line-through">₪{base}</span>}
                  <span className={`text-3xl font-extrabold ${onSale ? 'text-amber-300' : 'text-white'}`}>₪{finalPrice}</span>
                  <span className="text-xs text-white/40">/ {billing === 'annual' ? 'חודש בחיוב שנתי' : 'חודש'}</span>
                </div>
                {onSale && deal && (
                  <p className="text-2xs text-amber-300/80 mt-1">🔥 {deal.title}</p>
                )}
              </div>

              <ul className="space-y-1.5 mb-4">
                <li className="flex items-center gap-2 text-xs text-white/65">
                  <Zap size={11} className="text-amber-400 shrink-0" />
                  {plan.monthly_credits.toLocaleString()} קרדיטים בחודש · {groupsLabel}
                </li>
                {features.slice(0, 4).map((f) => (
                  <li key={f} className="flex items-center gap-2 text-xs text-white/65">
                    <Check size={11} className="text-emerald-400 shrink-0" /> {f}
                  </li>
                ))}
              </ul>

              {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

              <button onClick={confirm} disabled={submitting}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm font-bold transition-all">
                {submitting ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
                {submitting ? 'שולח...' : `אשר שדרוג — ₪${finalPrice}`}
              </button>
              <p className="text-2xs text-white/30 text-center mt-2.5">
                התוכנית תופעל לאחר הסדרת התשלום. אין חיוב אוטומטי בשלב זה.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
