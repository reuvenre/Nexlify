/**
 * "The same product, posted twice" — when the ids differ.
 *
 * The publish de-dup is keyed by AliExpress product_id. But AliExpress lists one item many
 * times: every store that sells it has its own listing, its own id, and usually the same
 * photos and nearly the same title. To a reader the two posts are the same product with a
 * different link, and the id check lets the second one through. This module recognises such
 * a pair from what the reader actually sees: the photo and the title.
 *
 * A false match only means a different product is picked in its place, so the bar is set
 * to catch near-identical listings, not to tell close models apart perfectly.
 */

export interface ProductLike {
  product_id?: string | number | null;
  title?: string | null;
  image_url?: string | null;
}

/** Words every listing carries, which say nothing about which product it is. */
const NOISE = new Set([
  'for', 'with', 'and', 'the', 'of', 'a', 'an', 'in', 'on', 'to', 'by', 'or', 'new', 'hot', 'sale', 'free',
  'shipping', 'high', 'quality', 'best', 'top', 'original', 'genuine', 'pcs', 'pc', 'set', 'lot', 'piece',
  '2023', '2024', '2025', '2026', 'style', 'fashion', 'women', 'men', 'mens', 'womens',
]);

/** Share of shared title words (Jaccard) at which two listings are the same product. */
export const SAME_TITLE_SHARE = 0.8;
/** Below this many meaningful words a title says too little to match on. */
const MIN_TOKENS = 4;

export function titleTokens(title: string | null | undefined): Set<string> {
  const words = String(title || '').toLowerCase().normalize('NFKC').split(/[^\p{L}\p{N}]+/u);
  return new Set(words.filter((w) => w.length >= 2 && !NOISE.has(w)));
}

/**
 * The photo's identity: the AliExpress CDN file name without its size suffix, so
 * `…/kf/S7a1b2c3.jpg_220x220.jpg` and `…/kf/S7a1b2c3.jpg` are the same picture. Two listings
 * of one item very often share the supplier's own photo file.
 */
export function imageKey(url: string | null | undefined): string | null {
  const raw = String(url || '').trim();
  if (!raw) return null;
  const path = raw.split('?')[0];
  const file = path.substring(path.lastIndexOf('/') + 1).toLowerCase();
  const base = file.replace(/\.(jpe?g|png|webp|avif)(_.*)?$/, '');
  // A short or generic name (placeholder.png, 1.jpg) identifies nothing.
  return base.length >= 12 ? base : null;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

interface Fingerprint { id: string; tokens: Set<string>; image: string | null }

function fingerprint(p: ProductLike): Fingerprint {
  return { id: String(p.product_id ?? ''), tokens: titleTokens(p.title), image: imageKey(p.image_url) };
}

function sameFingerprint(a: Fingerprint, b: Fingerprint): boolean {
  if (a.id && a.id === b.id) return true;
  if (a.image && a.image === b.image) return true;
  if (a.tokens.size < MIN_TOKENS || b.tokens.size < MIN_TOKENS) return false;
  return jaccard(a.tokens, b.tokens) >= SAME_TITLE_SHARE;
}

/** Are these two listings the same product to a reader? */
export function sameProduct(a: ProductLike, b: ProductLike): boolean {
  return sameFingerprint(fingerprint(a), fingerprint(b));
}

/**
 * Products already published (or already picked this run) — asked "is this one of them?"
 * by id, photo or title. Sized for a few hundred recent posts; the scan is linear.
 */
export class PublishedProducts {
  private readonly items: Fingerprint[] = [];
  private readonly images = new Set<string>();
  private readonly ids = new Set<string>();

  constructor(products: ProductLike[] = []) {
    for (const p of products) this.add(p);
  }

  add(p: ProductLike): void {
    const f = fingerprint(p);
    this.items.push(f);
    if (f.image) this.images.add(f.image);
    if (f.id) this.ids.add(f.id);
  }

  /** The listing it duplicates, or null. */
  match(p: ProductLike): string | null {
    const f = fingerprint(p);
    if (f.id && this.ids.has(f.id)) return f.id;
    if (f.image && this.images.has(f.image)) return this.items.find((x) => x.image === f.image)?.id || 'image';
    if (f.tokens.size < MIN_TOKENS) return null;
    for (const x of this.items) if (sameFingerprint(f, x)) return x.id || 'title';
    return null;
  }

  has(p: ProductLike): boolean {
    return this.match(p) !== null;
  }

  get size(): number {
    return this.items.length;
  }
}
