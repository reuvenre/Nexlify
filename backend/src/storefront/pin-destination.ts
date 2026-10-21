/**
 * Which pins may land on the storefront, and where the ones that may not are sent instead.
 *
 * Since c2bb97c a pin points at the store's product page rather than the affiliate
 * redirect: our own host, real content, a tracked buy button. Two things that choice never
 * asked, and the owner found both on a live pin:
 *  - **The owner's switch.** «הוסף קישור לחנות בפוסטים» (`link_in_posts`) is how he keeps the
 *    channels from advertising the store. Telegram's store line honoured it; the pin
 *    destination read only `enabled`, so with the switch off every new pin still led there.
 *  - **The audience.** The store is Hebrew. A pin from an English campaign (the US
 *    Pinterest audience) landed an American on a Hebrew page, priced in dollars.
 * A pin goes to the store only when both answers are yes. Otherwise it keeps the affiliate
 * link, and pins already published that point at the store are redirected to it
 * (`pinVisitRedirect`, applied by the product page's server layout).
 *
 * Kept free of Nest so the rule can be unit tested.
 */

/** The store pages are written in Hebrew; a campaign with no language is the account default, Hebrew. */
export function isHebrewAudience(language: string | null | undefined): boolean {
  const l = String(language ?? '').trim().toLowerCase();
  return !l || l === 'he' || l === 'iw' || l.startsWith('he-') || l === 'hebrew' || l === 'עברית';
}

/** May a pin of this post point at the store? */
export function pinMayUseStore(
  store: { enabled?: boolean | null; link_in_posts?: boolean | null } | null,
  postLanguage: string | null | undefined,
): boolean {
  return !!store?.enabled && store.link_in_posts !== false && isHebrewAudience(postLanguage);
}

/** The affiliate short link with the visit marked as Pinterest's (`/r/<code>?s=pin`). */
export function pinBuyUrl(buyUrl: string): string {
  if (!buyUrl) return buyUrl;
  try {
    const u = new URL(buyUrl);
    if (!/\/r\//.test(u.pathname)) return buyUrl; // only our own redirect reads ?s=
    u.searchParams.set('s', 'pin');
    return u.toString();
  } catch {
    return buyUrl;
  }
}

/**
 * Is this request a visit from Pinterest? The pins we create carry `?src=pin`; Pinterest
 * itself adds `utm_source=Pinterest`, and its crawler names itself in the user agent.
 */
export function isPinVisit(q: { src?: string | null; utm_source?: string | null; referer?: string | null; userAgent?: string | null }): boolean {
  return q.src === 'pin'
    || /pinterest/i.test(q.utm_source || '')
    || /(^|\.)pinterest\.[a-z.]+|pin\.it/i.test(q.referer || '')
    || /pinterest/i.test(q.userAgent || '');
}
