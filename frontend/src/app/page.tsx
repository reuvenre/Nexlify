import Link from 'next/link';
import type { Metadata } from 'next';
import {
  Radar, Sparkles, Send, Rocket, ArrowLeft, Check,
  Bot, Globe, Zap,
} from 'lucide-react';

export const metadata: Metadata = {
  title: 'Nexlify — אוטומציית שיווק שותפים מקצה לקצה',
  description:
    'Nexlify מגלה מוצרים חמים מ-AliExpress, כותבת קופי מוכר עם AI, מפרסמת לטלגרם ופייסבוק, ומקדמת אוטומטית את המנצחים כמודעות Meta Ads לפי ROAS — הכל במערכת אחת.',
  keywords: [
    'אוטומציית שיווק שותפים', 'בוט אפיליאצייט עלי אקספרס', 'ערוץ דילים אוטומטי טלגרם',
    'aliexpress affiliate telegram bot', 'affiliate marketing automation', 'multi-channel affiliate',
  ],
  alternates: { canonical: 'https://nexlify.app/' },
  openGraph: {
    title: 'Nexlify — אוטומציית שיווק שותפים מקצה לקצה',
    description:
      'גילוי מוצרים, כתיבת קופי עם AI, פרסום רב-ערוצי (טלגרם + פייסבוק), וקידום אוטומטי לפי ROAS — מערכת אחת.',
    type: 'website',
    locale: 'he_IL',
  },
};

const FEATURES = [
  { icon: Radar, title: 'גילוי מוצרים אוטומטי', desc: 'סורק AliExpress דרך Apify ומסנן רק מוצרים חמים — דירוג ≥ 4.5 ו-500+ מכירות — היישר לקטלוג שלך.' },
  { icon: Sparkles, title: 'קופי שיווקי עם AI', desc: 'מנוע רב-ספק (Claude · OpenAI · Gemini) שכותב פוסטים מוכרים בעברית, עם זוויות מתחלפות וקול אמין.' },
  { icon: Send, title: 'פרסום רב-ערוצי', desc: 'פוסט אחד מתפרסם בו-זמנית לטלגרם ולעמוד פייסבוק, עם תור חכם וחלונות זמן שמגנים על ההגעה.' },
  { icon: Rocket, title: 'Auto-Boost לפי ROAS', desc: 'מזהה את הפוסטים שמצליחים אורגנית ומקים להם מודעות Meta Ads אוטומטית — עם תקרת תקציב, מושהות עד אישורך.' },
];

const STEPS = [
  { n: '01', title: 'מגלה', desc: 'מילות מפתח → מוצרים חמים מסוננים בקטלוג.' },
  { n: '02', title: 'כותב', desc: 'ה-AI כותב קופי לכל ערוץ, מותאם לקהל שלך.' },
  { n: '03', title: 'מפרסם', desc: 'שליחה אוטומטית מתוזמנת לטלגרם ופייסבוק.' },
  { n: '04', title: 'מקדם', desc: 'המנצחים הופכים למודעות Meta Ads לפי ROAS.' },
];

const POINTS = [
  'מערכת אחת מקצה לקצה — לא חמישה כלים מודבקים',
  'תמיכה מלאה בעברית ו-RTL',
  'סודות מוצפנים AES-256 לכל משתמש',
  'ריבוי-משתמשים מוכן ל-SaaS',
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-surface-primary text-white overflow-x-hidden" dir="rtl">
      {/* Nav */}
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-surface-primary/70 border-b border-edge">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-[10px] bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shadow-lg shadow-blue-600/25">
              <Bot size={16} className="text-white" />
            </div>
            <span className="text-lg font-bold tracking-tight">Nexlify</span>
          </div>
          <nav className="flex items-center gap-1 sm:gap-3">
            <Link href="/blog" className="text-sm text-white/60 hover:text-white transition-colors px-2 sm:px-3 py-2">מדריכים</Link>
            <Link href="/compare/albato" className="text-sm text-white/60 hover:text-white transition-colors px-2 sm:px-3 py-2 hidden sm:block">השוואות</Link>
            <Link href="/login" className="text-sm text-white/60 hover:text-white transition-colors px-2 sm:px-3 py-2">כניסה</Link>
            <Link href="/register" className="text-sm font-medium bg-blue-600 hover:bg-blue-500 transition-colors rounded-xl px-4 py-2">
              התחל בחינם
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative">
        <div className="absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute top-[-10%] right-[20%] w-[40rem] h-[40rem] bg-blue-600/15 rounded-full blur-[120px]" />
          <div className="absolute top-[10%] left-[10%] w-[30rem] h-[30rem] bg-violet-600/15 rounded-full blur-[120px]" />
        </div>
        <div className="max-w-6xl mx-auto px-6 pt-20 pb-16 text-center">
          <div className="inline-flex items-center gap-2 text-xs font-medium text-blue-200 bg-gradient-to-r from-blue-500/15 to-violet-500/15 border border-blue-400/25 rounded-full px-3.5 py-1.5 mb-6 shadow-[0_4px_20px_-6px_rgba(59,130,246,0.5)]">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            אוטומציית שיווק שותפים מבוססת AI
          </div>
          <h1 className="text-4xl sm:text-6xl font-bold tracking-tight leading-[1.1] mb-6">
            מגלים, כותבים, מפרסמים ומקדמים<br />
            <span className="bg-gradient-to-l from-blue-400 to-violet-400 bg-clip-text text-transparent">— אוטומטית, במערכת אחת</span>
          </h1>
          <p className="text-lg text-white/55 max-w-2xl mx-auto mb-9 leading-relaxed">
            Nexlify מנהלת את כל מסע שיווק השותפים: מגלה מוצרים חמים מ-AliExpress, כותבת קופי מוכר עם AI,
            מפרסמת לטלגרם ופייסבוק, ומקדמת את המנצחים כמודעות Meta Ads לפי ROAS.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link href="/register" className="group flex items-center gap-2 bg-gradient-to-r from-blue-600 to-violet-600 hover:brightness-110 transition-all rounded-xl px-7 py-3.5 font-semibold shadow-lg shadow-blue-600/30 ring-1 ring-inset ring-white/15">
              התחל עכשיו <ArrowLeft size={17} className="group-hover:-translate-x-1 transition-transform" />
            </Link>
            <Link href="/login" className="bg-white/[0.06] hover:bg-white/[0.1] border border-edge-hover transition-colors rounded-xl px-7 py-3.5 font-medium text-white/75">
              יש לי חשבון
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-6 py-16">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {FEATURES.map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="group bg-surface-secondary border border-edge rounded-2xl p-6 transition-all duration-300 hover:border-blue-500/40 hover:-translate-y-1 hover:shadow-[0_24px_48px_-18px_rgba(59,130,246,0.3)]"
            >
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500/25 to-violet-500/25 border border-blue-500/25 flex items-center justify-center mb-4 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3">
                <Icon size={19} className="text-blue-300" />
              </div>
              <h3 className="font-semibold mb-2 group-hover:text-white transition-colors">{title}</h3>
              <p className="text-sm text-white/45 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-6xl mx-auto px-6 py-16">
        <h2 className="text-3xl font-bold text-center mb-3">איך זה עובד</h2>
        <p className="text-center text-white/45 mb-12">ארבעה שלבים — והמערכת רצה לבד</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {STEPS.map(({ n, title, desc }) => (
            <div key={n} className="relative bg-surface-secondary border border-edge rounded-2xl p-6">
              <span className="text-4xl font-bold bg-gradient-to-l from-blue-500/40 to-violet-500/40 bg-clip-text text-transparent">{n}</span>
              <h3 className="font-semibold mt-2 mb-1.5">{title}</h3>
              <p className="text-sm text-white/45 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Why Nexlify */}
      <section className="max-w-6xl mx-auto px-6 py-16">
        <div className="bg-gradient-to-bl from-blue-600/10 to-violet-600/10 border border-edge rounded-3xl p-10 grid md:grid-cols-2 gap-8 items-center">
          <div>
            <h2 className="text-3xl font-bold mb-4">למה Nexlify</h2>
            <p className="text-white/55 leading-relaxed mb-6">
              במקום להדביק חמישה כלים שונים — גילוי, כתיבה, פרסום, מודעות וניתוח — Nexlify עושה את הכל
              בפלטפורמה אחת, מאובטחת ומוכנה ל-SaaS.
            </p>
            <Link href="/register" className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 transition-all rounded-xl px-6 py-3 font-medium">
              התחל בחינם <ArrowLeft size={17} />
            </Link>
          </div>
          <ul className="space-y-3">
            {POINTS.map((p) => (
              <li key={p} className="flex items-center gap-3 text-white/70">
                <span className="w-6 h-6 rounded-full bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center shrink-0">
                  <Check size={13} className="text-emerald-400" />
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-edge mt-8">
        <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-white/40 text-sm">
            <Globe size={14} /> Nexlify — Affiliate Automation
          </div>
          <div className="flex items-center gap-2 text-white/30 text-xs">
            מבית{' '}
            <a href="https://win-solutions.co.il" target="_blank" rel="noopener noreferrer"
              className="text-white/50 hover:text-white/80 underline-offset-2 hover:underline">Win Solutions</a>
            {' '}— בניית אתרים ואוטומציות 2026
          </div>
        </div>
      </footer>
    </div>
  );
}
