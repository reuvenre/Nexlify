import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '');

/**
 * Public short-link redirect on the pretty domain: nexlify…/r/<code> → the post's
 * affiliate URL. The backend resolve call also RECORDS the click (that call is the
 * click). Unknown/expired codes fall back to the homepage instead of erroring at
 * a shopper.
 */
export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  try {
    const res = await fetch(`${API}/r/${encodeURIComponent(params.code)}/resolve`, {
      headers: {
        'x-forwarded-referrer': req.headers.get('referer') || '',
        'user-agent': req.headers.get('user-agent') || '',
      },
      cache: 'no-store',
    });
    const data = (await res.json().catch(() => null)) as { url?: string | null } | null;
    if (data?.url) return NextResponse.redirect(data.url, 302);
  } catch { /* fall through to the homepage */ }
  return NextResponse.redirect(new URL('/', req.url), 302);
}
