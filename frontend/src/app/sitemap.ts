import type { MetadataRoute } from 'next';
import { COMPARISONS, BLOG_POSTS } from '@/lib/marketing-content';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://nexlify.app';

export default function sitemap(): MetadataRoute.Sitemap {
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/blog`, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${SITE_URL}/register`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITE_URL}/login`, changeFrequency: 'monthly', priority: 0.5 },
  ];

  const comparePages: MetadataRoute.Sitemap = COMPARISONS.map((c) => ({
    url: `${SITE_URL}/compare/${c.slug}`,
    changeFrequency: 'monthly',
    priority: 0.8,
  }));

  const blogPages: MetadataRoute.Sitemap = BLOG_POSTS.map((p) => ({
    url: `${SITE_URL}/blog/${p.slug}`,
    lastModified: p.date,
    changeFrequency: 'monthly',
    priority: 0.7,
  }));

  return [...staticPages, ...comparePages, ...blogPages];
}
