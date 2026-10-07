import { applyWordPolicy } from '../posts/word-policy';
import { stripFenceMarks } from '../common/untrusted';

/**
 * What a Reel says, read from a post that already went out — pure.
 *
 * The text is burned into the video, where no downstream filter can reach it (like the pin
 * frame's title band), so the word policy and the fence marks are applied here, and nothing
 * is taken from anywhere but our own published copy and the post's own numbers.
 */
export interface ReelSpec {
  headline: string;
  reason?: string;
  price: string;
  was?: string;
  discount?: number;
  cta: string;
  brand?: string;
  images: string[];
  /** The opening clip: the seller's own product video, or the backend's AI clip. */
  video?: string;
  /** The clip is AI-generated — labelled on screen and in the caption. */
  ai?: boolean;
}

export interface ReelPostLike {
  generated_text?: string | null;
  product_title?: string | null;
  product_image?: string | null;
  gallery_json?: string | null;
  price_ils?: number | string | null;
  sale_price_usd?: number | string | null;
  original_price_usd?: number | string | null;
  product_video?: string | null;
}

/** Instagram and Facebook captions carry no live link — the video sends viewers to the bio. */
export const REEL_CTA = 'הלינק בביו 🔗';

const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu;

/** One line of our copy as plain text: no HTML, no emoji, no fence marks, word policy applied. */
export function plainLine(line: string): string {
  const text = stripFenceMarks(String(line || ''))
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(EMOJI, '')
    .replace(/\s+/g, ' ')
    .trim();
  return applyWordPolicy(text);
}

function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const at = text.lastIndexOf(' ', max);
  return `${text.slice(0, at > max * 0.6 ? at : max).trim()}…`;
}

/** A line worth putting on screen: real words, no link, no price, no call to buy. */
function isContentLine(line: string): boolean {
  return line.length >= 8
    && !/(https?:\/\/|www\.|t\.me\/|לרכישה|לחצו|קישור|מחיר|₪|\$|%)/i.test(line)
    && /[֐-׿]/.test(line);
}

/** Up to three product photos, JPEG/PNG where the CDN offers a WebP variant. */
export function reelImages(post: ReelPostLike): string[] {
  let gallery: string[] = [];
  try { gallery = post.gallery_json ? JSON.parse(post.gallery_json) : []; } catch { gallery = []; }
  const all = [...(Array.isArray(gallery) ? gallery : []), post.product_image || '']
    .filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u))
    .map((u) => (/\.webp(\?|$)/i.test(u) ? (u.match(/^(.*?\.(?:jpe?g|png))/i)?.[1] || u) : u));
  return [...new Set(all)].slice(0, 3);
}

export function buildReelSpec(post: ReelPostLike, brand?: string | null): ReelSpec | null {
  const images = reelImages(post);
  const priceIls = Number(post.price_ils);
  if (!images.length || !(priceIls > 0)) return null;
  const lines = String(post.generated_text || '').split('\n').map(plainLine).filter(isContentLine);
  const headline = cut(lines[0] || plainLine(post.product_title || ''), 60);
  if (!headline) return null;
  const sale = Number(post.sale_price_usd);
  const orig = Number(post.original_price_usd);
  const discount = sale > 0 && orig > sale ? Math.round((1 - sale / orig) * 100) : 0;
  return {
    headline,
    reason: lines[1] ? cut(lines[1], 70) : undefined,
    price: `₪${Math.round(priceIls)}`,
    was: discount >= 5 ? `₪${Math.round(priceIls * (orig / sale))}` : undefined,
    discount: discount >= 5 ? discount : undefined,
    cta: REEL_CTA,
    brand: brand ? cut(plainLine(brand), 24) : undefined,
    images,
    // The seller's own video comes first: real footage of the real product.
    video: /^https?:\/\//i.test(String(post.product_video || '')) ? String(post.product_video) : undefined,
  };
}
