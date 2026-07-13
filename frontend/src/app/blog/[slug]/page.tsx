import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Clock, Check, ArrowLeft } from 'lucide-react';
import { BLOG_POSTS, getBlogPost } from '@/lib/marketing-content';
import { MarketingShell, CtaBand } from '@/components/marketing/MarketingShell';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://nexlify.app';

export function generateStaticParams() {
  return BLOG_POSTS.map((p) => ({ slug: p.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const p = getBlogPost(params.slug);
  if (!p) return {};
  return {
    title: p.title,
    description: p.metaDescription,
    alternates: { canonical: `/blog/${p.slug}` },
    openGraph: { title: p.title, description: p.metaDescription, type: 'article', publishedTime: p.date },
  };
}

export default function BlogPostPage({ params }: { params: { slug: string } }) {
  const post = getBlogPost(params.slug);
  if (!post) notFound();

  // Article structured data for rich results.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.metaDescription,
    datePublished: post.date,
    inLanguage: 'he-IL',
    author: { '@type': 'Organization', name: 'Nexlify' },
    publisher: { '@type': 'Organization', name: 'Nexlify' },
    mainEntityOfPage: `${SITE_URL}/blog/${post.slug}`,
  };

  const related = BLOG_POSTS.filter((p) => p.slug !== post.slug).slice(0, 2);

  return (
    <MarketingShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <article className="max-w-3xl mx-auto px-6 pt-14">
        <div className="flex items-center gap-3 text-xs text-white/35 mb-4">
          <span className="text-blue-300 bg-blue-500/10 border border-blue-500/20 rounded-full px-2.5 py-0.5">{post.category}</span>
          <span className="flex items-center gap-1"><Clock size={12} /> {post.readMins} דק׳ קריאה</span>
        </div>
        <h1 className="text-3xl sm:text-5xl font-bold tracking-tight leading-[1.15] mb-5">{post.title}</h1>
        <p className="text-lg text-white/55 leading-relaxed mb-10">{post.excerpt}</p>

        <div className="space-y-10">
          {post.sections.map((s, i) => (
            <section key={i}>
              <h2 className="text-xl sm:text-2xl font-bold mb-4">{s.h2}</h2>
              {s.paragraphs.map((p, j) => (
                <p key={j} className="text-white/65 leading-[1.9] mb-4">{p}</p>
              ))}
              {s.bullets && (
                <ul className="space-y-2 mt-3">
                  {s.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2.5 text-white/70">
                      <Check size={15} className="text-emerald-400 mt-1 shrink-0" />{b}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </article>

      <CtaBand text={post.cta} />

      {/* Related */}
      <section className="max-w-3xl mx-auto px-6 mb-8">
        <h2 className="text-sm font-semibold text-white/50 mb-4">מדריכים נוספים</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          {related.map((p) => (
            <Link key={p.slug} href={`/blog/${p.slug}`} className="group bg-surface-secondary border border-edge rounded-xl p-4 hover:border-blue-500/30 transition-colors">
              <p className="text-sm font-medium group-hover:text-blue-300 transition-colors leading-snug">{p.title}</p>
              <span className="mt-2 text-xs text-blue-400 inline-flex items-center gap-1">קרא <ArrowLeft size={12} /></span>
            </Link>
          ))}
        </div>
      </section>
    </MarketingShell>
  );
}
