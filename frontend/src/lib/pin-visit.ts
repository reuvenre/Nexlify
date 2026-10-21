/**
 * Is a storefront request a visit from Pinterest? Read in the middleware, which may not call
 * the API: only the URL, the referrer and the user agent. Pins we create carry `?src=pin`,
 * Pinterest adds `utm_source=Pinterest` itself, and its crawler names itself.
 *
 * The middleware marks such a request (PIN_VISIT_HEADER) and the product page's server
 * layout sends it on when the backend says a pin should not have led to the store
 * (`pin_redirect`, backend storefront/pin-destination.ts).
 */
export const PIN_VISIT_HEADER = 'x-nx-pin-visit';

export function isPinVisit(q: { src?: string | null; utm_source?: string | null; referer?: string | null; userAgent?: string | null }): boolean {
  return q.src === 'pin'
    || /pinterest/i.test(q.utm_source || '')
    || /(^|\.)pinterest\.[a-z.]+|pin\.it/i.test(q.referer || '')
    || /pinterest/i.test(q.userAgent || '');
}
