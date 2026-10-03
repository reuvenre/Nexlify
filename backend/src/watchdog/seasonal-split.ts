/**
 * Clicks per post from SEASONAL keywords against the campaign's ordinary ones, for the
 * morning digest.
 *
 * The owner's decision on the season's share of the rotation (SEASONAL_EVERY — one in five)
 * waits on exactly this number: if holiday posts draw more clicks per post than the
 * campaign's own, the share goes up. Nothing else measures it — the week-on-week trend is
 * per campaign, and a better seasonal fifth is invisible inside it.
 *
 * Per post, not per day: the two groups are published in a fixed 1:4 ratio, so totals would
 * just restate the ratio. The seasonal set is today's open windows for the campaign's
 * language; a post from a window that already closed counts as ordinary, which only makes
 * the comparison more conservative.
 */
import { seasonalKeywords } from '../common/seasonal';

export const SEASONAL_SPLIT_DAYS = 7;
/** Seasonal posts needed before the line offers a verdict — fewer is a coin toss. */
export const MIN_SEASONAL_POSTS_TO_JUDGE = 5;
/** How far apart clicks-per-post must be before one side "leads". */
export const LEAD_RATIO = 1.2;

export interface KeywordClicksRow {
  campaignId: string;
  campaignName: string;
  language: string;
  keyword: string;
  posts: number;
  clicks: number;
}

export interface SeasonalSplit {
  campaignId: string;
  campaignName: string;
  seasonalPosts: number;
  seasonalClicks: number;
  ordinaryPosts: number;
  ordinaryClicks: number;
}

export function seasonalSplits(rows: KeywordClicksRow[], now = new Date()): SeasonalSplit[] {
  const byCampaign = new Map<string, SeasonalSplit>();
  const seasonFor = new Map<string, Set<string>>();
  for (const r of rows || []) {
    const lang = r.language || 'he';
    if (!seasonFor.has(lang)) {
      seasonFor.set(lang, new Set(seasonalKeywords(lang, now).map((k) => k.trim().toLowerCase())));
    }
    const s = byCampaign.get(r.campaignId) ?? {
      campaignId: r.campaignId, campaignName: r.campaignName,
      seasonalPosts: 0, seasonalClicks: 0, ordinaryPosts: 0, ordinaryClicks: 0,
    };
    const seasonal = seasonFor.get(lang)!.has(String(r.keyword || '').trim().toLowerCase());
    const posts = Number(r.posts) || 0;
    const clicks = Number(r.clicks) || 0;
    if (seasonal) { s.seasonalPosts += posts; s.seasonalClicks += clicks; }
    else { s.ordinaryPosts += posts; s.ordinaryClicks += clicks; }
    byCampaign.set(r.campaignId, s);
  }
  return Array.from(byCampaign.values())
    .filter((s) => s.seasonalPosts > 0)
    .sort((a, b) => b.seasonalPosts - a.seasonalPosts);
}

const perPost = (clicks: number, posts: number) => (posts ? clicks / posts : 0);

export function seasonalSplitLine(s: SeasonalSplit): string {
  const sp = perPost(s.seasonalClicks, s.seasonalPosts);
  const op = perPost(s.ordinaryClicks, s.ordinaryPosts);
  const head = `• "${s.campaignName}": עונתי ${sp.toFixed(1)} קליקים/פוסט (${s.seasonalPosts} פוסטים)`
    + ` · רגיל ${op.toFixed(1)} (${s.ordinaryPosts})`;
  if (s.seasonalPosts < MIN_SEASONAL_POSTS_TO_JUDGE) return `${head} — מוקדם לשפוט`;
  if (op === 0 && sp === 0) return `${head} — אין קליקים לשני הצדדים עדיין`;
  if (sp >= op * LEAD_RATIO) return `${head} — ✅ עונתי מוביל`;
  if (op >= sp * LEAD_RATIO) return `${head} — רגיל מוביל`;
  return `${head} — דומה`;
}
