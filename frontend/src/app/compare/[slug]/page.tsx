import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Check, X, ArrowLeft } from 'lucide-react';
import { COMPARISONS, getComparison } from '@/lib/marketing-content';
import { MarketingShell, CtaBand } from '@/components/marketing/MarketingShell';

export function generateStaticParams() {
  return COMPARISONS.map((c) => ({ slug: c.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const c = getComparison(params.slug);
  if (!c) return {};
  return {
    title: c.title,
    description: c.metaDescription,
    alternates: { canonical: `/compare/${c.slug}` },
    openGraph: { title: c.title, description: c.metaDescription, type: 'article' },
  };
}

export default function ComparePage({ params }: { params: { slug: string } }) {
  const c = getComparison(params.slug);
  if (!c) notFound();

  return (
    <MarketingShell>
      <article className="max-w-5xl mx-auto px-6 pt-14 pb-4">
        <div className="text-xs text-blue-300 bg-blue-500/10 border border-blue-500/20 rounded-full px-3 py-1 inline-flex items-center gap-1.5 mb-5">
          {c.emoji} השוואה
        </div>
        <h1 className="text-3xl sm:text-5xl font-bold tracking-tight leading-[1.15] mb-5">{c.title}</h1>
        <p className="text-lg text-white/55 leading-relaxed max-w-3xl">{c.intro}</p>
      </article>

      {/* Comparison table */}
      <section className="max-w-5xl mx-auto px-6 my-10">
        <div className="bg-surface-secondary border border-edge rounded-2xl overflow-hidden">
          <div className="grid grid-cols-[1.4fr_1fr_1fr] text-sm font-semibold border-b border-edge">
            <div className="px-5 py-3.5 text-white/50">יכולת</div>
            <div className="px-5 py-3.5 text-blue-400 border-r border-edge bg-blue-500/[0.06]">Nexlify</div>
            <div className="px-5 py-3.5 text-white/60 border-r border-edge">{c.competitor}</div>
          </div>
          {c.rows.map((row, i) => (
            <div key={i} className="grid grid-cols-[1.4fr_1fr_1fr] text-sm border-b border-edge last:border-0">
              <div className="px-5 py-3.5 text-white/70 font-medium">{row.feature}</div>
              <div className={`px-5 py-3.5 border-r border-edge flex items-start gap-2 ${row.nexusWins ? 'bg-blue-500/[0.05]' : ''}`}>
                {row.nexusWins && <Check size={14} className="text-emerald-400 mt-0.5 shrink-0" />}
                <span className="text-white/75">{row.nexus}</span>
              </div>
              <div className="px-5 py-3.5 border-r border-edge flex items-start gap-2">
                {!row.nexusWins && <Check size={14} className="text-white/40 mt-0.5 shrink-0" />}
                <span className="text-white/50">{row.them}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* When to choose */}
      <section className="max-w-5xl mx-auto px-6 my-10 grid md:grid-cols-2 gap-5">
        <div className="bg-surface-secondary border border-blue-500/25 rounded-2xl p-6">
          <h2 className="font-semibold mb-4 flex items-center gap-2"><Check size={16} className="text-blue-400" /> מתי לבחור ב-Nexlify</h2>
          <ul className="space-y-2.5">
            {c.whenNexus.map((t) => (
              <li key={t} className="flex items-start gap-2.5 text-sm text-white/65"><Check size={14} className="text-emerald-400 mt-0.5 shrink-0" />{t}</li>
            ))}
          </ul>
        </div>
        <div className="bg-surface-secondary border border-edge rounded-2xl p-6">
          <h2 className="font-semibold mb-4 flex items-center gap-2 text-white/70"><X size={16} className="text-white/40" /> מתי {c.competitor} עדיף</h2>
          <ul className="space-y-2.5">
            {c.whenThem.map((t) => (
              <li key={t} className="flex items-start gap-2.5 text-sm text-white/50"><ArrowLeft size={14} className="text-white/30 mt-0.5 shrink-0" />{t}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* Verdict */}
      <section className="max-w-5xl mx-auto px-6 my-10">
        <div className="bg-surface-secondary border border-edge rounded-2xl p-6">
          <h2 className="font-semibold mb-2">השורה התחתונה</h2>
          <p className="text-white/60 leading-relaxed">{c.verdict}</p>
        </div>
      </section>

      <div className="max-w-5xl mx-auto px-6">
        <Link href="/compare/albato" className="text-sm text-blue-400 hover:text-blue-300 inline-flex items-center gap-1.5 ml-4">
          השוואות נוספות
        </Link>
        <Link href="/blog" className="text-sm text-blue-400 hover:text-blue-300 inline-flex items-center gap-1.5">
          מדריכים <ArrowLeft size={14} />
        </Link>
      </div>

      <CtaBand text={`מוכן לנסות את Nexlify?`} />
    </MarketingShell>
  );
}
