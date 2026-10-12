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
  /**
   * The target groups' core focus (group-focus.ts). Present → the STRICT question: only a
   * product clearly inside the focus fits. Absent or empty → the lenient guard below.
   */
  focus?: Array<{ name: string; focus: string }>;
}

export interface ProductFitItem {
  /** The product's key, for the focus rejection memory. */
  id?: string;
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

/**
 * The strict brief, for a group whose owner declared its core focus. The opposite bias of
 * the one above: a plausible-but-generic product is exactly what a focused group must not
 * get, so only a clear fit passes and doubt rejects.
 */
export const GROUP_FOCUS_SYSTEM =
  'You decide whether specific products belong in a shopping channel whose owner declared '
  + 'its CORE FOCUS.\n'
  + 'The focus is the owner\'s own definition of what the channel is about, and it is '
  + 'authoritative. Accept ONLY a product that clearly sits inside it: one a member would '
  + 'recognise at a glance as exactly what this channel is for.\n'
  + 'Reject a generic product that this audience could merely use: an ordinary flashlight, '
  + 'general camping or outdoor gear, a plain backpack, a household tool, clothing that is '
  + 'not specifically within the focus. Such a product passes only when the focus itself '
  + 'names it.\n'
  + 'The search keyword that found a product does not make it fit; judge the product.\n'
  + 'When unsure, reject.\n'
  + 'Output JSON only. No prose, no code fences.\n'
  + UNTRUSTED_DATA_RULE;

/** True when the context carries a declared focus, i.e. the strict question applies. */
export function isStrictFit(ctx: ProductFitContext): boolean {
  return !!ctx.focus?.some((f) => f.focus?.trim());
}

/** The judge's brief: the channel in the owner's terms, then the picked products. */
export function buildProductFitPrompt(ctx: ProductFitContext, items: ProductFitItem[]): string {
  const lines: string[] = [];
  lines.push(`CHANNEL: ${ctx.campaign}`);
  if (ctx.channels.length) lines.push(`PUBLISHES TO: ${ctx.channels.join(', ')}`);
  // The owner's own words, not a seller's — no fence, but one line each and capped.
  for (const f of (ctx.focus || []).filter((x) => x.focus?.trim())) {
    lines.push(`CORE FOCUS of "${f.name}": ${f.focus.replace(/\s+/g, ' ').trim().slice(0, 400)}`);
  }
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
    (isStrictFit(ctx)
      ? 'For each product decide whether it clearly sits inside the core focus. '
      : 'For each product decide whether it belongs in this channel for this audience. ')
    + 'Answer ONLY with a JSON array in the order given:\n'
    + '[{"i":1,"fits":true|false,"reason":"<up to 8 words, Hebrew>"}]',
  );
  return lines.join('\n');
}

export interface ProductFitVerdict {
  fits: boolean;
  reason: string;
  /** Outside the group's focus, let through under its outside-the-focus share (group-focus.ts). */
  offFocus?: boolean;
}

/**
 * Read the judge's answer — FAIL-OPEN. Every item defaults to accepted; only an entry
 * that explicitly says `fits: false` for a valid index flips it. A malformed, truncated
 * or partial reply therefore degrades to "publish as before", never to "publish nothing".
 *
 * `strict` (a focused group): once the reply IS a readable array, a product passes only on
 * an explicit `fits: true` — one the judge skipped was not shown to be inside the focus.
 * An unreadable reply still accepts everything: a broken judge must not silence the group.
 */
export function parseProductFitVerdicts(text: string, count: number, strict = false): ProductFitVerdict[] {
  const out: ProductFitVerdict[] = Array.from({ length: count }, () => ({ fits: true, reason: '' }));
  const raw = String(text || '').trim().replace(/^```(?:json)?|```$/g, '').trim();
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end <= start) return out;

  let parsed: any;
  try { parsed = JSON.parse(raw.slice(start, end + 1)); } catch { return out; }
  if (!Array.isArray(parsed)) return out;

  const answered = new Set<number>();
  for (const item of parsed) {
    const idx = Number(item?.i) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= count) continue;
    const reason = String(item?.reason || '').trim().slice(0, 80);
    if (strict) {
      answered.add(idx);
      out[idx] = item?.fits === true ? { fits: true, reason: '' } : { fits: false, reason };
    } else if (item?.fits === false) {
      out[idx] = { fits: false, reason };
    }
  }
  if (strict) {
    for (let i = 0; i < count; i++) {
      if (!answered.has(i)) out[i] = { fits: false, reason: 'השופט לא אישר' };
    }
  }
  return out;
}
