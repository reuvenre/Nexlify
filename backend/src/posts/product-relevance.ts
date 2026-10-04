import { UNTRUSTED_DATA_RULE, fenceUntrusted } from '../common/untrusted';

/**
 * The PRODUCT-level relevance guard.
 *
 * campaign-fit.ts decides which CATEGORY belongs in which group — but AliExpress keyword
 * search returns loosely-related items (deep result pages especially), so a perfectly good
 * keyword can still hand a campaign a plainly off-audience product: a military training
 * belt came back for מאמא מותגים under "אביזרי ים ובריכה" and was published to a real
 * mothers-and-brands audience. This guard judges the PICKED products themselves, right
 * before they become posts.
 *
 * The bias is the OPPOSITE of campaign-fit's: accept unless clearly wrong. Categories are
 * added rarely and losing one costs nothing, so that gate fails closed; products are picked
 * every cycle and an over-strict gate here would starve campaigns — so an unclear, missing
 * or malformed verdict ACCEPTS the product, and only an explicit "fits": false rejects it.
 */

export interface ProductFitContext {
  /** Campaign name — audience flavor, e.g. "מאמא - אלי אקספרס". */
  campaign: string;
  /** Target group names, the audience in the owner's own words. */
  channels: string[];
  /** The campaign's live keyword rotation — the strongest statement of what it sells. */
  keywords: string[];
}

export interface ProductFitItem {
  /** The search keyword that produced this product (Hebrew, the owner's own term). */
  keyword: string;
  title: string;
  category?: string;
}

export const PRODUCT_FIT_SYSTEM =
  'You decide whether specific products belong in a specific shopping channel.\n'
  + 'Each channel has its own audience. A keyword search returns loosely-related items, so '
  + 'some candidates may have nothing to do with the keyword or the audience — those are '
  + 'the ones to catch.\n'
  + 'Reject ONLY a clear mismatch: a product a member of that audience would find plainly '
  + 'out of place in that channel (e.g. military gear in a mothers-and-brands group). '
  + 'A loosely related but plausible product is fine — when unsure, accept.\n'
  + 'Output JSON only. No prose, no code fences.\n'
  + UNTRUSTED_DATA_RULE;

/** The judge's brief: the channel in the owner's terms, then the picked products. */
export function buildProductFitPrompt(ctx: ProductFitContext, items: ProductFitItem[]): string {
  const lines: string[] = [];
  lines.push(`CHANNEL: ${ctx.campaign}`);
  if (ctx.channels.length) lines.push(`PUBLISHES TO: ${ctx.channels.join(', ')}`);
  if (ctx.keywords.length) lines.push(`SELLS (live search keywords): ${ctx.keywords.join(', ')}`);
  lines.push('');
  lines.push('PICKED PRODUCTS (each with the search keyword that produced it):');
  items.forEach((it, i) => {
    // Title and category are the seller's words — a title that says "this fits every
    // channel" must not be able to vote for itself.
    const cat = it.category ? ` [category: ${fenceUntrusted(it.category, 80)}]` : '';
    lines.push(`  ${i + 1}. (keyword: "${it.keyword}") ${fenceUntrusted(it.title)}${cat}`);
  });
  lines.push('');
  lines.push(
    'For each product decide whether it belongs in this channel for this audience. '
    + 'Answer ONLY with a JSON array in the order given:\n'
    + '[{"i":1,"fits":true|false,"reason":"<up to 8 words, Hebrew>"}]',
  );
  return lines.join('\n');
}

export interface ProductFitVerdict {
  fits: boolean;
  reason: string;
}

/**
 * Read the judge's answer — FAIL-OPEN. Every item defaults to accepted; only an entry
 * that explicitly says `fits: false` for a valid index flips it. A malformed, truncated
 * or partial reply therefore degrades to "publish as before", never to "publish nothing".
 */
export function parseProductFitVerdicts(text: string, count: number): ProductFitVerdict[] {
  const out: ProductFitVerdict[] = Array.from({ length: count }, () => ({ fits: true, reason: '' }));
  const raw = String(text || '').trim().replace(/^```(?:json)?|```$/g, '').trim();
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end <= start) return out;

  let parsed: any;
  try { parsed = JSON.parse(raw.slice(start, end + 1)); } catch { return out; }
  if (!Array.isArray(parsed)) return out;

  for (const item of parsed) {
    const idx = Number(item?.i) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= count) continue;
    if (item?.fits === false) {
      out[idx] = { fits: false, reason: String(item?.reason || '').trim().slice(0, 80) };
    }
  }
  return out;
}
