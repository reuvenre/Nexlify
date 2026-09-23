/**
 * A seasonal window open, a campaign asking for it, and nothing coming out.
 *
 * The owner turned the seasonal toggle on for his US Pinterest campaign, the Halloween and
 * Christmas windows opened, the campaign kept publishing — and not one holiday product
 * appeared. He found it by eye, weeks in, which is the watchdog's whole job.
 *
 * No existing check could see it. The campaign is active, publishing on schedule, at its
 * configured cadence, with no failures: every anomaly check in the scan is looking for
 * something BROKEN, and nothing here is broken. The campaign is simply not selling what the
 * season is buying, which is a business outcome that happens to have a technical cause.
 *
 * WHICH cause matters, because the obvious guess is wrong and acting on it costs quality.
 * The rating and discount filters are NOT it: the runner's tiered pool relaxes both on its
 * own whenever on-spec stock runs out (tiers 3–4 in runCampaign), so a keyword whose search
 * returned anything at all is never silenced by them. The first version of this alert said
 * otherwise, and the owner loosened his Pinterest quality bar on its advice for nothing.
 *
 * A seasonal slot only borrows when the SEARCH itself comes back empty — and the filters that
 * can make it empty are the ones sent to the API, which no tier relaxes: the campaign's
 * CATEGORY (a tactical category holds no Halloween decorations) and its PRICE RANGE.
 *
 * This is the narrowest statement of that failure: the owner ASKED for seasonal stock, the
 * campaign IS publishing, and none of what it published came from a seasonal keyword.
 *
 * Deliberately NOT flagged: a campaign whose seasonal toggle is off. That is a choice, not a
 * fault — the owner switched two campaigns off this week on purpose, and alerting on them
 * would be exactly the noise that teaches him to ignore the alerts.
 *
 * Also not flagged: a campaign whose product SOURCE cannot use seasonal keywords at all. The
 * calendar injects search terms, and only the AliExpress runner searches — FLYLINK rotates a
 * linked supplier catalog (no search API exists) and Amazon walks its own cursor. Their
 * seasonal toggle is decorative, so such a campaign can never satisfy this check and would
 * alert every six hours forever. The first live run of this check caught exactly that: a
 * FLYLINK campaign, toggle on, 36 posts, 0 seasonal — structurally impossible, not a fault.
 * (That the UI offers the toggle there at all is a separate problem, and the owner's call.)
 */

import { activeSeasonalEvents, seasonalKeywords, sourceSupportsSeasonal } from '../common/seasonal';

/** How far back the check looks. Long enough to cover a slow campaign's full rotation,
 *  short enough that a window is not half over before the alert lands. */
export const SEASONAL_GAP_DAYS = 3;

/**
 * How long this finding stays quiet after it goes out.
 *
 * The 6h default suits a fault someone fixes today. This one is resolved by a DECISION with
 * a date on it — relax a filter, or let the season pass — and a Christmas window is open for
 * three months. At six hours that is around 360 issues for one condition the owner already
 * knows about, which is how an alert channel becomes noise. Three days still reminds him
 * several times before a window closes, and each reminder carries the current numbers.
 */
export const SEASONAL_GAP_REPEAT_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Posts a campaign must have published in that window before zero means anything.
 *
 * A campaign that published twice and missed the seasonal slot is a rotation that has not
 * come round yet, not a fault. Six is comfortably more than one cycle for any real cadence.
 */
export const MIN_POSTS_TO_JUDGE = 6;

/** One active, seasonal-enabled campaign and what it actually published. */
export interface SeasonalCampaignRow {
  campaignId: string;
  campaignName: string;
  /** 'aliexpress' | 'flylink' | 'amazon' — only the first can act on seasonal keywords. */
  source: string;
  /** Decides WHICH events apply: US events reach English campaigns only. */
  language: string;
  /** Sent posts in the window. */
  recentPosts: number;
  /** Distinct lowercased keywords those posts came from. */
  keywords: string[];
  /** The filters sent TO the search API — the only ones no fallback tier relaxes, and so
   *  the only campaign settings that can make a seasonal search come back empty. */
  categoryId?: string | null;
  minPrice?: number | null;
  maxPrice?: number | null;
}

export interface SeasonalGap {
  campaignId: string;
  campaignName: string;
  /** Event names open for this campaign's language. */
  events: string[];
  /** The seasonal keywords it should have been publishing from. */
  expected: string[];
  recentPosts: number;
  categoryId: string | null;
  minPrice: number | null;
  maxPrice: number | null;
}

/**
 * The campaigns publishing straight past their own open season.
 *
 * A campaign is only judged when there is something to judge it against: the window must be
 * open FOR ITS LANGUAGE and must carry search keywords. A sale-season event like Black
 * Friday contributes none by design — it angles the copy and says nothing about what to
 * sell — so a campaign cannot fail to publish from it.
 */
export function seasonalGaps(rows: SeasonalCampaignRow[], now = new Date()): SeasonalGap[] {
  const out: SeasonalGap[] = [];
  for (const row of rows || []) {
    // A source that never searches keywords cannot publish from one. Judging it produces an
    // alert that no action can ever clear — the definition of noise.
    if (!sourceSupportsSeasonal(row.source)) continue;
    const language = row.language || 'he';
    const expected = seasonalKeywords(language, now);
    if (!expected.length) continue; // nothing this campaign could have published from
    if (row.recentPosts < MIN_POSTS_TO_JUDGE) continue; // too little to read anything into

    const published = new Set((row.keywords || []).map((k) => String(k || '').trim().toLowerCase()));
    const hit = expected.some((kw) => published.has(kw.trim().toLowerCase()));
    if (hit) continue; // the season is reaching the channel — nothing to say

    out.push({
      campaignId: row.campaignId,
      campaignName: row.campaignName,
      events: activeSeasonalEvents(language, now).map((ev) => ev.name),
      expected,
      recentPosts: row.recentPosts,
      categoryId: row.categoryId?.trim() || null,
      minPrice: Number(row.minPrice) > 0 ? Number(row.minPrice) : null,
      maxPrice: Number(row.maxPrice) > 0 ? Number(row.maxPrice) : null,
    });
  }
  return out;
}

/**
 * The campaign settings that could have emptied the search, in the owner's words — or null
 * when the campaign sets none of them.
 *
 * Null is a finding in its own right: with no category and no price range, nothing the
 * campaign configured can explain an empty seasonal search, and the next place to look is
 * the dry-keyword line in its run note ("החיפוש לא החזיר מוצרים כלל").
 *
 * Deliberately names NO rating or discount: those are relaxed automatically by the pool's
 * fallback tiers and cannot silence a keyword, and naming them sends the owner to lower his
 * quality bar for nothing — which is what the first version of this alert did.
 */
export function searchConstraints(gap: SeasonalGap): string | null {
  const parts: string[] = [];
  if (gap.categoryId) parts.push(`מוגבל לקטגוריה ${gap.categoryId}`);
  if (gap.minPrice !== null || gap.maxPrice !== null) {
    parts.push(`טווח מחיר ${gap.minPrice ?? 0}–${gap.maxPrice ?? '∞'}`);
  }
  return parts.length ? parts.join(' · ') : null;
}

/** One owner-facing line. Plain text — the Telegram DM is sent without parse_mode. */
export function seasonalGapLine(gap: SeasonalGap): string {
  const constraint = searchConstraints(gap);
  return `"${gap.campaignName}" · ${gap.events.join(', ')} · `
    + `${gap.recentPosts} פוסטים ב-${SEASONAL_GAP_DAYS} ימים, אף אחד מהם עונתי`
    + (constraint ? ` · ${constraint}` : '');
}
