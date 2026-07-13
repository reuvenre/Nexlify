import Link from 'next/link';
import { Bot, ArrowLeft, Globe, ShieldCheck } from 'lucide-react';

/** Shared chrome for public marketing pages (landing, compare, blog). */
export function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface-primary text-white" dir="rtl">
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-surface-primary/70 border-b border-edge">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-[10px] bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shadow-lg shadow-blue-600/25">
              <Bot size={16} className="text-white" />
            </div>
            <span className="text-lg font-bold tracking-tight">Nexlify</span>
          </Link>
          <nav className="flex items-center gap-1 sm:gap-3 text-sm">
            <Link href="/blog" className="text-white/60 hover:text-white transition-colors px-2 sm:px-3 py-2">מדריכים</Link>
            <Link href="/compare/albato" className="text-white/60 hover:text-white transition-colors px-2 sm:px-3 py-2 hidden sm:block">השוואות</Link>
            <Link href="/login" className="text-white/60 hover:text-white transition-colors px-2 sm:px-3 py-2">כניסה</Link>
            <Link href="/register" className="font-medium bg-blue-600 hover:bg-blue-500 transition-colors rounded-xl px-4 py-2">התחל בחינם</Link>
          </nav>
        </div>
      </header>

      <main>{children}</main>

      <footer className="border-t border-edge mt-16">
        <div className="max-w-5xl mx-auto px-6 py-10">
          <div className="grid sm:grid-cols-3 gap-6 mb-8 text-sm">
            <div>
              <p className="font-semibold mb-2 text-white/80">Nexlify</p>
              <p className="text-white/40 leading-relaxed">אוטומציית שיווק שותפים מקצה לקצה — גילוי, AI, פרסום רב-ערוצי וקידום.</p>
            </div>
            <div>
              <p className="font-semibold mb-2 text-white/80">מדריכים</p>
              <ul className="space-y-1.5 text-white/40">
                <li><Link href="/blog/automated-telegram-deals-channel" className="hover:text-blue-400">ערוץ דילים אוטומטי בטלגרם</Link></li>
                <li><Link href="/blog/aliexpress-affiliate-guide" className="hover:text-blue-400">מדריך שיווק שותפים AliExpress</Link></li>
                <li><Link href="/blog/what-is-roas-when-to-boost" className="hover:text-blue-400">מה זה ROAS</Link></li>
              </ul>
            </div>
            <div>
              <p className="font-semibold mb-2 text-white/80">השוואות</p>
              <ul className="space-y-1.5 text-white/40">
                <li><Link href="/compare/albato" className="hover:text-blue-400">Nexlify מול Albato</Link></li>
                <li><Link href="/compare/manychat" className="hover:text-blue-400">Nexlify מול ManyChat</Link></li>
              </ul>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-6 border-t border-edge text-xs text-white/30">
            <span className="flex items-center gap-2"><Globe size={13} /> Nexlify — Affiliate Automation</span>
            <span className="flex items-center gap-2"><ShieldCheck size={13} /> סודות מוצפנים · מוכן לפרודקשן</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

/** Reusable bottom call-to-action band. */
export function CtaBand({ text }: { text: string }) {
  return (
    <section className="max-w-5xl mx-auto px-6 my-12">
      <div className="bg-gradient-to-bl from-blue-600/15 to-violet-600/15 border border-blue-500/20 rounded-3xl p-8 sm:p-10 text-center">
        <p className="text-xl sm:text-2xl font-bold mb-5">{text}</p>
        <Link href="/register" className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 transition-all rounded-xl px-6 py-3 font-medium shadow-lg shadow-blue-600/25">
          התחל בחינם <ArrowLeft size={17} />
        </Link>
      </div>
    </section>
  );
}
