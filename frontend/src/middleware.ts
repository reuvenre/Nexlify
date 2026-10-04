import { NextRequest, NextResponse } from 'next/server';

// '/s/' is the customer storefronts — the page a follower lands on from a post, with no
// account and no session. It must never be treated as an app route.
const PUBLIC_PATHS = ['/login', '/register', '/forgot-password', '/reset-password', '/blog', '/compare', '/privacy', '/pricing', '/r/', '/s/', '/bot'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public marketing landing page (SEO entry point) — served to everyone.
  if (pathname === '/') {
    return NextResponse.next();
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
