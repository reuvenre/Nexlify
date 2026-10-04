import type { RankedProduct } from './product.agent';

/**
 * What the search tool actually returned, keyed by `String(product_id)`, together with the
 * keyword that was really sent to the search for it.
 */
export type SearchLedger = Map<string, { product: any; keyword: string }>;

/** Remember every product a search returned. The first keyword that found an id wins. */
export function recordSearch(ledger: SearchLedger, keyword: string, products: unknown): void {
  if (!Array.isArray(products)) return;
  for (const p of products) {
    const id = p && p.product_id != null ? String(p.product_id).trim() : '';
    if (!id || ledger.has(id)) continue;
    ledger.set(id, { product: p, keyword: String(keyword || '').trim() });
  }
}

/** The ranking formula the agent is told to use, computed here so the number is ours. */
export function productScore(
  p: { discount_percent?: number; orders_count?: number; rating?: number; sale_price?: number },
  soldBand?: { low: number; high: number } | null,
): number {
  const discount = Number(p.discount_percent) || 0;
  const orders = Math.min(Number(p.orders_count) || 0, 10000);
  const rating = Number(p.rating) || 0;
  let score = discount * 0.4 + (orders / 10000) * 40 + (rating / 5) * 20;
  const price = Number(p.sale_price);
  if (soldBand && Number.isFinite(price) && price >= soldBand.low && price <= soldBand.high) score += 15;
  return +score.toFixed(2);
}

/**
 * Turn the model's answer into products this server actually saw.
 *
 * The model only gets to CHOOSE and ORDER. Every field that reaches a post — title, prices,
 * image, rating — is read back from the search result, never from the model's JSON. A
 * mis-copied price, a hallucinated id, or a product title that talked the model into
 * "adjusting" its own price would otherwise be published as fact, multiplied by the
 * exchange rate and stamped with our affiliate link. An id the search never returned is
 * dropped, not repaired. The keyword is the one the server sent to the search, not the
 * one the model remembers — it decides whether the copy may take a seasonal angle.
 */
export function groundRankedProducts(
  picks: unknown,
  ledger: SearchLedger,
  count: number,
  soldBand?: { low: number; high: number } | null,
): { products: RankedProduct[]; rejected: string[] } {
  const products: RankedProduct[] = [];
  const rejected: string[] = [];
  const taken = new Set<string>();
  if (!Array.isArray(picks)) return { products, rejected };

  for (const pick of picks) {
    if (products.length >= count) break;
    const raw = pick && typeof pick === 'object' ? (pick as any).product_id : pick;
    const id = raw != null ? String(raw).trim() : '';
    if (!id || taken.has(id)) continue;
    const seen = ledger.get(id);
    if (!seen) {
      rejected.push(id.slice(0, 40));
      continue;
    }
    taken.add(id);
    const p = seen.product;
    products.push({
      product_id: id,
      title: String(p.title ?? ''),
      sale_price: Number(p.sale_price) || 0,
      original_price: Number(p.original_price) || 0,
      discount_percent: Number(p.discount_percent) || 0,
      orders_count: Number(p.orders_count) || 0,
      rating: Number(p.rating) || 0,
      image_url: String(p.image_url ?? ''),
      category: String(p.category ?? ''),
      currency: String(p.currency ?? ''),
      score: productScore(p, soldBand),
      keyword: seen.keyword || undefined,
    });
  }
  return { products, rejected };
}
