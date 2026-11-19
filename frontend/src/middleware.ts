import { NextRequest, NextResponse } from 'next/server';
import { PIN_VISIT_HEADER, isPinVisit } from '@/lib/pin-visit';

/**
 * Runs ONLY on a storefront product page (the matcher below). Every other route used to
 * pass through here too — every page, every prefetch and every short-link click — and it
 * did nothing for any of them but cost a function call. On 13.11.2026 the Hobby plan's
 * CPU allowance ran out and Vercel paused the site, every post link with it. Auth is
 * checked in the dashboard layout (useAuth), never here.
 *
 * A product opened from a pin is marked for the page's server layout, which sends it to
 * the affiliate link when the pin should never have led to the store.
 */
export function middleware(req: NextRequest) {
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

export const config = {
  matcher: ['/s/:slug/p/:path*'],
};
