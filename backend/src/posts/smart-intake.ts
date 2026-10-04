/**
 * Smart link intake — the judge's contract, as pure functions.
 *
 * The flow it serves: the owner pastes an AliExpress product URL; the system resolves the
 * product, and ONE model call answers two questions at once — which of the owner's
 * campaigns this product belongs to (by audience), and what search keyword represents it
 * (so the campaign can find more like it in future runs). The service then files the
 * keyword into the chosen campaign's rotation and schedules a post through that
 * campaign's own routing (groups, platforms, language, currency).
 *
 * Parsing is FAIL-CLOSED into the safe default: an unreadable answer assigns NO campaign
 * (the post still publishes, to the default channel) rather than guessing an audience —
 * a wrong assignment posts a product to a real group of real people.
 */

import { UNTRUSTED_DATA_RULE, fenceUntrusted } from '../common/untrusted';

export interface IntakeCampaignProfile {
  name: string;
  /** The live rotation — the strongest statement of what this campaign sells. */
  keywords: string[];
  /** Target group names — the audience in the owner's own words. */
  channels: string[];
}

export interface IntakeVerdict {
  /** Index into the campaigns array, or -1 = none of them fits. */
  campaign: number;
  /** Concise English search keyword (AliExpress is indexed in English). */
  keyword: string;
  /** Short Hebrew justification, surfaced to the owner. */
  reason: string;
}

export const SMART_INTAKE_SYSTEM =
  'You match a product to the best-fitting campaign and produce a search keyword. '
  + 'Judge fit by AUDIENCE: would this campaign\'s groups expect this product? '
  + 'The keyword must be a concise English product-category phrase (2-4 words, like '
  + '"jewelry organizer" or "camping lantern") that an AliExpress search would use to find '
  + 'more products like this one — never the product\'s marketing title. '
  + 'Answer ONLY strict JSON: {"campaign": <index or -1>, "keyword": "...", "reason": "<short Hebrew>"} '
  + 'Use campaign -1 when no campaign\'s audience fits.\n'
  + UNTRUSTED_DATA_RULE;

export function buildSmartIntakePrompt(
  product: { title: string; category?: string },
  campaigns: IntakeCampaignProfile[],
): string {
  const lines = campaigns.map((c, i) =>
    `${i}. "${c.name}" — keywords: ${c.keywords.slice(0, 12).join(', ') || '(none)'}`
    + (c.channels.length ? ` — groups: ${c.channels.join(', ')}` : ''));
  return [
    // The seller's words, fenced: a title must not be able to pick its own campaign or
    // write the keyword that goes into the owner's rotation.
    `Product: ${fenceUntrusted(product.title, 200)}`,
    product.category ? `Category: ${fenceUntrusted(product.category, 80)}` : '',
    '',
    'Campaigns:',
    ...lines,
  ].filter(Boolean).join('\n');
}

/** The model's answer → a verdict, or null when the answer is unusable (fail closed). */
export function parseIntakeVerdict(text: string, campaignCount: number): IntakeVerdict | null {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  let obj: any;
  try { obj = JSON.parse(m[0]); } catch { return null; }
  const keyword = String(obj?.keyword || '').trim().toLowerCase();
  if (!keyword || keyword.length > 60) return null;
  let campaign = Number(obj?.campaign);
  if (!Number.isInteger(campaign) || campaign < -1 || campaign >= campaignCount) campaign = -1;
  return { campaign, keyword, reason: String(obj?.reason || '').slice(0, 200) };
}

/**
 * Fallback keyword when there is no model to ask: the title's first words, cleaned of the
 * marketing noise AliExpress titles open with. Crude on purpose — it only has to be a
 * usable search phrase, and the owner sees it before anything else happens with it.
 */
export function fallbackKeyword(title: string): string {
  return String(title || '')
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !/^\d+$/.test(w))
    .slice(0, 3)
    .join(' ')
    .toLowerCase();
}
