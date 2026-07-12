import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://nexus.app';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/login', '/register'],
        // Keep the authenticated app out of the index — only the marketing
        // surface should be crawlable.
        disallow: ['/dashboard', '/campaigns', '/posts', '/products', '/ads', '/settings', '/earnings', '/orders', '/groups', '/templates', '/categories', '/quick-post'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
