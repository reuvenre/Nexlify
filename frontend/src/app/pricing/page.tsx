import Link from 'next/link';
import type { Metadata } from 'next';
import { Check, Sparkles, ArrowLeft } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Nexlify — תמחור פשוט ושקוף',
  description:
    'תוכניות Nexlify: מ-Starter ועד Scale — אוטומציית שיווק שותפים עם AI, פרסום ל-5 פלטפורמות ומדידת עמלות. התחילו בחינם.',
  alternates: { canonical: 'https://nexlify.win-solutions.co.il/pricing' },
};

/**
 * The pricing matrix — MIRRORS the backend gating map (plans.const.ts
 * FEATURE_MIN_PLAN). This page is static marketing (SSG); the numbers are the
 * same ones GET /subscription/plans serves. If the gating map changes, update
 * here too — never promise a feature the backend doesn't unlock at that tier.
 */
const PLANS = [
  {
    id: 'starter', name: 'Starter', tagline: 'התחילו עכשיו',
    monthly: 69, annual: 55, credits: '1,500', groups: 'קבוצה אחת',
    popular: false,
    includes: 'התחילו בחינם עם:',
    features: [
      'מקור מוצרים: AliExpress',
      'פרסום ל-Telegram',
      'AI כותב פוסטים, אתם מאשרים',
      'לינקים חכמים + מעקב קליקים',
      'סנכרון הזמנות ועמלות אוטומטי',
    ],
  },
  {
    id: 'growth', name: 'Growth', tagline: 'הסוכן הראשון שלכם',
    monthly: 150, annual: 120, credits: '5,000', groups: '5 קבוצות',
    popular: true,
    includes: 'כל מה שב-Starter, וגם:',
    features: [
      'פרסום ל-Facebook, Instagram ו-Pinterest',
      'חיבור WhatsApp אחד',
      'סוכן AI לגילוי מוצרים',
      'משפר תמונות AI',
      'תור פרסום חכם',
      'דוח "מה מכניס כסף" — עמלות עד רמת הפוסט',
    ],
  },
  {
    id: 'autopilot', name: 'Autopilot', tagline: 'טייס אוטומטי מלא',
    monthly: 220, annual: 176, credits: '7,000', groups: '10 קבוצות',
    popular: false,
    includes: 'כל מה שב-Growth, וגם:',
    features: [
      'מצב טייס אוטומטי. מגילוי ועד פרסום, אפס קלט',
      'סוכני AI לניהול הקמפיינים',
      'מקור מוצרים נוסף: Amazon',
      'מיחזור מנצחים אוטומטי',
      'עונתיות — לוח שנה מסחרי',
      'חלון שליחה לפי אזור זמן',
      '2 חיבורי WhatsApp',
    ],
  },
  {
    id: 'scale', name: 'Scale', tagline: 'צי סוכנים',
    monthly: 449, annual: 359, credits: '50,000', groups: 'קבוצות ללא הגבלה',
    popular: false,
    includes: 'כל מה שב-Autopilot, וגם:',
    features: [
      'קמפיינים באנגלית לקהל ארה"ב (USD)',
      'פינטרסט SEO לשוק האמריקאי',
      'מעקב טוקנים ותקציב AI',
      'דוחות רווח והפסד מתקדמים',
      '3 חיבורי WhatsApp',
      'תמיכה בעדיפות',
    ],
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-surface-primary text-white" dir="rtl">
      {/* Nav — same as landing */}
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-surface-primary/70 border-b border-edge">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-[10px] bg-white p-1 flex items-center justify-center shadow-lg shadow-black/20">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-mark.png" alt="Nexlify" className="w-full h-full object-contain" />
            </div>
            <span className="text-lg font-bold tracking-tight">Nexlify</span>
          </Link>
          <nav className="flex items-center gap-1 sm:gap-3">
            <Link href="/blog" className="text-sm text-white/60 hover:text-white transition-colors px-2 sm:px-3 py-2">מדריכים</Link>
            <Link href="/login" className="text-sm text-white/60 hover:text-white transition-colors px-2 sm:px-3 py-2">כניסה</Link>
            <Link href="/register" className="text-sm font-medium bg-blue-600 hover:bg-blue-500 transition-colors rounded-xl px-4 py-2">
              התחל בחינם
            </Link>
          </nav>
        </div>
      </header>

      {/* Heading */}
      <section className="relative">
        <div className="absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute top-[-20%] left-[30%] w-[36rem] h-[36rem] bg-blue-600/15 rounded-full blur-[120px]" />
        </div>
        <div className="max-w-6xl mx-auto px-6 pt-16 pb-10 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">תמחור פשוט ושקוף</h1>
          <p className="text-white/50 text-lg">
            בחרו מסלול שמתאים לכם — אפשר לשדרג בכל רגע.
          </p>
        </div>
      </section>

      {/* Cards */}
      <section className="max-w-7xl mx-auto px-6 pb-20">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 items-stretch">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className={`relative flex flex-col rounded-2xl border p-6 transition-all
                ${plan.popular
                  ? 'bg-gradient-to-b from-blue-600/15 to-violet-600/10 border-blue-500/50 ring-1 ring-blue-500/30 shadow-[0_24px_60px_-20px_rgba(59,130,246,0.35)]'
                  : 'bg-surface-secondary border-edge hover:border-white/20'}`}
            >
              {plan.popular && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                  <span className="flex items-center gap-1 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-bold rounded-full px-3.5 py-1 whitespace-nowrap shadow-lg">
                    <Sparkles size={11} /> הבחירה הפופולרית
                  </span>
                </div>
              )}

              <div className="text-center mb-5">
                <p className="text-lg font-bold">{plan.name}</p>
                <div className="flex items-baseline justify-center gap-1.5 mt-3">
                  <span className="text-5xl font-extrabold tracking-tight">{plan.monthly}</span>
                  <span className="text-sm text-white/40">₪ / חודש</span>
                </div>
                <p className="text-xs text-emerald-400/90 mt-1.5">₪{plan.annual} לחודש בחיוב שנתי (חסכו 20%)</p>
                <p className="text-sm text-white/55 mt-3 font-medium">{plan.tagline}</p>
              </div>

              <Link
                href="/register"
                className={`w-full text-center py-2.5 rounded-xl text-sm font-semibold transition-all mb-5
                  ${plan.popular
                    ? 'bg-gradient-to-r from-blue-600 to-violet-600 hover:brightness-110 text-white shadow-lg shadow-blue-600/30'
                    : 'bg-blue-600/90 hover:bg-blue-600 text-white'}`}
              >
                התחילו עכשיו
              </Link>

              <div className="border-t border-edge pt-4">
                <p className="text-xs font-semibold text-white/40 mb-3">{plan.includes}</p>
                <ul className="space-y-2.5">
                  <li className="flex items-start gap-2 text-sm text-white/70">
                    <Check size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                    {plan.credits} קרדיטים AI בחודש
                  </li>
                  <li className="flex items-start gap-2 text-sm text-white/70">
                    <Check size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                    {plan.groups}
                  </li>
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-white/70">
                      <Check size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>

        {/* FAQ-ish footnote */}
        <div className="mt-12 text-center space-y-2">
          <p className="text-sm text-white/45">
            קרדיטים = פעולות AI ופרסום (כתיבת פוסט: 5 · פרסום: 10). מתחדשים אוטומטית כל חודש.
          </p>
          <p className="text-sm text-white/45">
            נגמרו הקרדיטים באמצע החודש? חבילות טעינה חד-פעמיות מתוך המערכת:
            {' '}5,000 / ₪59 · 15,000 / ₪149 · 50,000 / ₪399.
          </p>
          <p className="text-sm text-white/45">
            שאלות? <Link href="/register" className="text-blue-400 hover:text-blue-300">הירשמו</Link> או כתבו לנו — נשמח לעזור להתאים מסלול.
          </p>
        </div>

        {/* CTA */}
        <div className="mt-14 bg-gradient-to-bl from-blue-600/10 to-violet-600/10 border border-edge rounded-3xl p-10 text-center">
          <h2 className="text-2xl font-bold mb-3">מוכנים להפעיל את הטייס האוטומטי?</h2>
          <p className="text-white/50 mb-6">הצטרפו עכשיו והתחילו לפרסם תוך דקות.</p>
          <Link
            href="/register"
            className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-600 to-violet-600 hover:brightness-110 transition-all rounded-xl px-7 py-3.5 font-semibold shadow-lg shadow-blue-600/30"
          >
            התחל בחינם <ArrowLeft size={17} />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-edge">
        <div className="max-w-6xl mx-auto px-6 py-10 text-center text-white/30 text-xs">
          Nexlify — מבית{' '}
          <a href="https://win-solutions.co.il" target="_blank" rel="noopener noreferrer"
            className="text-white/50 hover:text-white/80 underline-offset-2 hover:underline">Win Solutions</a>
        </div>
      </footer>
    </div>
  );
}
