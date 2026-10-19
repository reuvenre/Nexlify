/**
 * The round trip between the high-commission screen (/commissions) and quick post.
 *
 * «צור פוסט» there opens `/quick-post?from_catalog=1&back=commissions`; quick post's «חזרה»
 * (and the redirect after a successful send) goes back to the list, which restores itself
 * from sessionStorage. A product posted on the way is marked «פורסם» there at once, since the
 * scan's own `posted_recently` only learns of it on the next scan.
 */

/** `back=` values quick post accepts, and where each returns to. Nothing else is followed. */
export const BACK_TARGETS: Record<string, { href: string; label: string; short: string }> = {
  commissions: { href: '/commissions', label: 'חזרה לרשימת העמלות', short: 'לרשימה' },
};

export const COMMISSIONS_POSTED_KEY = 'commissions_posted';

/** Remember a product posted from quick post (this tab only). Never throws. */
export function markCommissionPosted(productId: string): void {
  try {
    const ids: string[] = JSON.parse(sessionStorage.getItem(COMMISSIONS_POSTED_KEY) || '[]');
    if (!ids.includes(productId)) ids.push(productId);
    sessionStorage.setItem(COMMISSIONS_POSTED_KEY, JSON.stringify(ids.slice(-200)));
  } catch { /* storage blocked: the next scan marks it */ }
}

export function readCommissionPosted(): Set<string> {
  try {
    return new Set<string>(JSON.parse(sessionStorage.getItem(COMMISSIONS_POSTED_KEY) || '[]'));
  } catch {
    return new Set();
  }
}
