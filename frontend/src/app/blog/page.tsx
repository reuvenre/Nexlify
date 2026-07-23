import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowLeft, Clock } from 'lucide-react';
import { BLOG_POSTS } from '@/lib/marketing-content';
import { MarketingShell } from '@/components/marketing/MarketingShell';

export const metadata: Metadata = {
  title: 'מדריכים — שיווק שותפים, AliExpress, טלגרם ואוטומציה',
  description:
    'מדריכים ואסטרטגיות לשיווק שותפים: בניית ערוץ דילים בטלגרם, מציאת מוצרים מנצחים ב-AliExpress, פרסום רב-ערוצי ומדידת הכנסות.',
  alternates: { canonical: '/blog' },
};

export default function BlogIndex() {
  return (
    <MarketingShell>
      <section className="max-w-5xl mx-auto px-6 pt-14 pb-6">
        <h1 className="text-3xl sm:text-5xl font-bold tracking-tight mb-4">מדריכים ואסטרטגיות</h1>
        <p className="text-lg text-white/55 max-w-2xl">כל מה שצריך לדעת על שיווק שותפים אוטומטי — מ-AliExpress ועד Meta Ads.</p>
      </section>

      <section className="max-w-5xl mx-auto px-6 pb-8 grid sm:grid-cols-2 gap-5">
        {BLOG_POSTS.map((p) => (
          <Link
            key={p.slug}
            href={`/blog/${p.slug}`}
            className="group bg-surface-secondary border border-edge rounded-2xl p-6 hover:border-blue-500/30 transition-colors flex flex-col"
          >
            <div className="flex items-center gap-3 text-xs text-white/35 mb-3">
              <span className="text-blue-300 bg-blue-500/10 border border-blue-500/20 rounded-full px-2.5 py-0.5">{p.category}</span>
              <span className="flex items-center gap-1"><Clock size={12} /> {p.readMins} דק׳</span>
            </div>
            <h2 className="text-lg font-semibold mb-2 group-hover:text-blue-300 transition-colors leading-snug">{p.title}</h2>
            <p className="text-sm text-white/45 leading-relaxed flex-1">{p.excerpt}</p>
            <span className="mt-4 text-sm text-blue-400 inline-flex items-center gap-1.5">קרא עוד <ArrowLeft size={14} className="group-hover:-translate-x-1 transition-transform" /></span>
          </Link>
        ))}
      </section>
    </MarketingShell>
  );
}
