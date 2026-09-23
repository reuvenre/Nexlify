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
 * season is buying, which is a business outcome that happens to have a technical cause —
 * usually the campaign's own rating/discount/price filters rejecting every holiday product
 * the keyword returns, after which the slot silently borrows from another keyword.
 *
 * This is the narrowest statement of that failure: the owner ASKED for seasonal stock, the
 * campaign IS publishing, and none of what it published came from a seasonal keyword.
 *
 * Deliberately NOT flagged: a campaign whose seasonal toggle is off. That is a choice, not a
 * fault — the owner switched two campaigns off this week on purpose, and alerting on them
 * would be exactly the noise that teaches him to ignore the alerts.
 */

import { activeSeasonalEvents, seasonalKeywords } from '../common/seasonal';

/** How far back the check looks. Long enough to cover a slow campaign's full rotation,
 *  short enough that a window is not half over before the alert lands. */
export const SEASONAL_GAP_DAYS = 3;

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
  /** Decides WHICH events apply: US events reach English campaigns only. */
  language: string;
  /** Sent posts in the window. */
  recentPosts: number;
  /** Distinct lowercased keywords those posts came from. */
  keywords: string[];
}

export interface SeasonalGap {
  campaignId: string;
  campaignName: string;
  /** Event names open for this campaign's language. */
  events: string[];
  /** The seasonal keywords it should have been publishing from. */
  expected: string[];
  recentPosts: number;
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
    });
  }
  return out;
}

/** One owner-facing line. Plain text — the Telegram DM is sent without parse_mode. */
export function seasonalGapLine(gap: SeasonalGap): string {
  return `"${gap.campaignName}" · ${gap.events.join(', ')} · `
    + `${gap.recentPosts} פוסטים ב-${SEASONAL_GAP_DAYS} ימים, אף אחד מהם עונתי`;
}
