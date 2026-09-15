/**
 * Making any product photo publishable on Instagram.
 *
 * The feed API accepts aspect ratios between 4:5 portrait (0.8) and 1.91:1 landscape —
 * anything outside is rejected with #36003 before the container is even processed. Supplier
 * photos live outside that range all the time: fashion shots are routinely 3:4 or taller,
 * and a banner crop can be wider than 1.91. The first night mama's Instagram actually
 * worked, its FLYLINK post failed on exactly this.
 *
 * The fix is not to crop (cutting product off a product photo is worse than not posting)
 * but to LETTERBOX: place the whole image on the nearest legal canvas, white background.
 * The maths of that decision live here, pure and testable; the pixel work happens in the
 * controller that serves the padded variant.
 */

/** Instagram's feed limits. 1080x1350 is the canonical 4:5 canvas; 1080x566 ≈ 1.908 sits
 *  just inside the 1.91 landscape cap (1080/565 = 1.9115 would be OVER it). */
export const IG_MIN_RATIO = 0.8;
export const IG_MAX_RATIO = 1.91;
const PORTRAIT_BOX = { width: 1080, height: 1350 };
const LANDSCAPE_BOX = { width: 1080, height: 566 };

/**
 * The canvas an image must be letterboxed onto to satisfy Instagram — or null when its
 * ratio is already legal and the original should be published untouched.
 */
export function igFitBox(
  width?: number | null, height?: number | null,
): { width: number; height: number } | null {
  const w = Number(width);
  const h = Number(height);
  // Unknown dimensions → no claim. Publishing the original and letting Instagram judge
  // beats padding an image that may have been fine.
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  const ratio = w / h;
  if (ratio < IG_MIN_RATIO) return PORTRAIT_BOX;
  if (ratio > IG_MAX_RATIO) return LANDSCAPE_BOX;
  return null;
}

/**
 * A URL already wrapped in our own Yupoo proxy, unwrapped back to the upstream image.
 * The fit pipeline fetches upstream directly (with the hotlink Referer) instead of
 * looping through our public host to reach ourselves.
 */
export function unwrapOwnProxy(url: string): string {
  try {
    const u = new URL(url);
    if (u.pathname.endsWith('/suppliers/image')) {
      const inner = u.searchParams.get('url');
      if (inner) return inner;
    }
  } catch { /* not a URL we understand → leave as-is */ }
  return url;
}

/** Hosts the fit endpoint may fetch from — the product-image CDNs the system publishes,
 *  nothing else. This is a PUBLIC endpoint; an open fetcher would be an SSRF service. */
/**
 * Is this URL one of OUR uploaded-image URLs? Owner uploads live behind our own public
 * endpoint, so the CDN allowlist can never contain them — but they are exactly as safe to
 * fetch (we minted the id, we serve the bytes), and every pipeline that letterboxes or
 * frames an allowlisted image must treat an uploaded one the same.
 */
export function isOwnUploadedUrl(url: string): boolean {
  const base = (process.env.BACKEND_URL || '').replace(/\/$/, '');
  return !!base && String(url || '').startsWith(`${base}/posts/uploaded/`);
}

export function isIgFittableHost(host: string): boolean {
  return /(^|\.)yupoo\.com$/i.test(host)
    || /(^|\.)alicdn\.com$/i.test(host)
    || /(^|\.)aliexpress-media\.com$/i.test(host);
}

/** Fetch headers for an upstream image host — Yupoo hotlink-protects and needs a Referer. */
export function igFetchHeaders(host: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  };
  if (/(^|\.)yupoo\.com$/i.test(host)) headers.Referer = 'https://x.yupoo.com/';
  return headers;
}

/**
 * What the owner reads when Instagram rejects the media itself (#9004).
 *
 * "Only photo or video can be accepted as media type" means Meta fetched the url and what
 * came back was not an image. It reached the owner exactly like that — Graph's English, in a
 * Hebrew UI, with no url and classified as needing no action.
 *
 * Both halves of that were wrong. The url is the only thing that says WHICH image path
 * failed (the designed frame, the letterboxed variant, or the supplier's own photo), which
 * is the lesson #36003 already learned one branch away. And there IS an action: swapping the
 * product photo in the editor, which nobody would guess from Graph's wording.
 */
export function igMediaRejectedMessage(rejected: string, alsoTried?: string): string {
  return '(#9004) אינסטגרם לא הצליחה לקרוא את התמונה — הכתובת לא החזירה קובץ תמונה תקין. '
    + `החלף את תמונת המוצר בעורך הפוסט ונסה שוב. התמונה שנדחתה: ${rejected}`
    + (alsoTried ? ` (נוסתה גם: ${alsoTried})` : '');
}
