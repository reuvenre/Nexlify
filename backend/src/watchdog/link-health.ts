/**
 * Do the links in the published posts actually work?
 *
 * Every post carries a short link on the frontend's domain (FRONTEND_URL/r/<code>), and the
 * frontend is hosted apart from the backend. On 13.11.2026 the Vercel project was paused:
 * every link in every post, the store and the dashboard answered 402 with Vercel's
 * "This deployment is temporarily paused", while the backend, the database and the bot
 * were all healthy, so no check that looks from the inside could see it. Only a request
 * from the outside, the way a shopper makes it, can. This reads that answer.
 */

export interface LinkProbe {
  /** HTTP status, or 0 when the request itself failed (DNS, TLS, timeout). */
  status: number;
  /** Where a redirect points (Location), if any. */
  location?: string;
  /** The start of the body, enough to recognise a host's error page. */
  body?: string;
  /** The network error, when status is 0. */
  error?: string;
}

export interface LinkVerdict {
  /** Stable per problem kind, so the throttle holds one alert per cause. */
  kind: 'paused' | 'down' | 'not_redirecting';
  title: string;
  detail: string;
  /** Set when only the owner can fix it. */
  action?: string;
}

/** Vercel's own markers for a paused project (status 402, code DEPLOYMENT_PAUSED). */
const PAUSED_RE = /DEPLOYMENT_PAUSED|temporarily paused/i;

/**
 * The verdict on one probe of a real post's short link, made with a bot user agent so the
 * click is never counted. Healthy is a redirect that leaves the frontend's home page: the
 * route resolved the code through the backend and sent the shopper on.
 */
export function linkVerdict(probe: LinkProbe, probedUrl: string, frontendBase: string): LinkVerdict | null {
  const host = (() => { try { return new URL(probedUrl).host; } catch { return probedUrl; } })();
  if (probe.status === 402 || PAUSED_RE.test(probe.body || '')) {
    return {
      kind: 'paused',
      title: 'כל הקישורים בפוסטים לא עובדים — האתר ב-Vercel מושהה',
      detail: `${host} עונה ${probe.status || '—'} עם דף "This deployment is temporarily paused" של Vercel. `
        + 'כל קישור קצר בפוסטים (אלי אקספרס ו-FLYLINK), החנות והדשבורד לא נפתחים. השרת ב-Render תקין.',
      action: 'היכנס ל-vercel.com → reuvenre\'s projects → nexlify ולחץ Resume. אם כתוב שנגמרה מכסת השימוש של התוכנית '
        + 'החינמית (Hobby) — צריך לשדרג ל-Pro או לחכות לאיפוס החודשי; בלשונית Usage רואים מה צרך אותה.',
    };
  }
  if (!probe.status || probe.status >= 500) {
    return {
      kind: 'down',
      title: 'הקישורים בפוסטים לא נפתחים — האתר לא עונה',
      detail: probe.status
        ? `${host} עונה ${probe.status} על קישור קצר אמיתי מפוסט.`
        : `הבקשה ל-${host} נכשלה: ${String(probe.error || 'ללא תשובה').slice(0, 200)}.`,
    };
  }
  const home = frontendBase.replace(/\/$/, '');
  const loc = String(probe.location || '');
  const toHome = loc === '/' || loc === `${home}/` || loc === home;
  if (probe.status < 300 || probe.status >= 400 || !loc || toHome) {
    return {
      kind: 'not_redirecting',
      title: 'קישור קצר מפוסט לא מוביל למוצר',
      detail: `${host} עונה ${probe.status}${loc ? ` → ${loc.slice(0, 120)}` : ''} במקום הפניה לקישור המוצר. `
        + 'ייתכן שה-frontend לא מגיע לשרת (NEXT_PUBLIC_API_URL) או שהקוד לא נמצא.',
    };
  }
  return null;
}
