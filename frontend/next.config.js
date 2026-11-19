/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.aliexpress.com' },
      { protocol: 'https', hostname: '**.alicdn.com' },
      { protocol: 'https', hostname: 'ae01.alicdn.com' },
    ],
  },
  // Same-origin proxy: /api/* is transparently forwarded to the Render backend.
  // The Google OAuth flow goes through /api so the callback returns to THIS origin
  // (eliminates cross-domain cookie/fragment/FRONTEND_URL issues). Regular API calls
  // keep going direct to the backend (NEXT_PUBLIC_API_URL) to avoid proxy timeouts.
  //
  // /r/<code> — every short link in every post — is proxied the same way, straight to the
  // backend's own redirect (LinksController.redirect), which records the click. It used to
  // be a route handler here: one server function per click and per preview crawler, only
  // to ask the backend where to go. beforeFiles, so it wins over any page. The query
  // string (?s=tg / ?s=pin, the platform tag) and the browser's Referer and User-Agent
  // pass through untouched.
  async rewrites() {
    return {
      beforeFiles: [
        { source: '/r/:code', destination: 'https://nexus-backend-wb5h.onrender.com/r/:code' },
      ],
      afterFiles: [
        { source: '/api/:path*', destination: 'https://nexus-backend-wb5h.onrender.com/:path*' },
      ],
      fallback: [],
    };
  },
};

module.exports = nextConfig;
