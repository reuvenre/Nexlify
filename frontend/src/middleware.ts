import { NextRequest, NextResponse } from 'next/server';
import { PIN_VISIT_HEADER, isPinVisit } from '@/lib/pin-visit';

// '/s/' is the customer storefronts — the page a follower lands on from a post, with no
// account and no session. It must never be treated as an app route.
const PUBLIC_PATHS = ['/login', '/register', '/forgot-password', '/reset-password', '/blog', '/compare', '/privacy', '/pricing', '/r/', '/s/', '/bot'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public marketing landing page (SEO entry point) — served to everyone.
  if (pathname === '/') {
    return NextResponse.next();
  }

  // A storefront product opened from a pin: marked for the page's server layout, which
  // sends it to the affiliate link when the pin should never have led to the store.
  if (pathname.startsWith('/s/') && pathname.includes('/p/')) {
    const q = req.nextUrl.searchParams;
    const fromPin = isPinVisit({
      src: q.get('src'), utm_source: q.get('utm_source'),
      referer: req.headers.get('referer'), userAgent: req.headers.get('user-agent'),
    });
    const headers = new Headers(req.headers);
    // Always set or cleared here, so a visitor cannot send the header in themselves.
    if (fromPin) headers.set(PIN_VISIT_HEADER, '1');
    else headers.delete(PIN_VISIT_HEADER);
    return NextResponse.next({ request: { headers } });
  }

  // Allow public auth routes
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // The actual auth check happens in the dashboard layout via useAuth hook.
  // Middleware here handles only static route redirects.
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api).*)'],
};
