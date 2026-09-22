/**
 * Week-on-week clicks per campaign, for the morning digest.
 *
 * The watchdog already detects a COLLAPSE — a 40%+ fall in clicks per post against three
 * weeks of history — and opens an issue about it. That is an alarm, and an alarm is the wrong
 * instrument for a question like "we changed a setting yesterday, is it working?". It only
 * speaks when something is badly wrong, it compares against a baseline three times longer
 * than the change is old, and it says nothing at all when a change HELPS.
 *
 * So there was no way to read the result of a deliberate change. The owner turned the
 * seasonal post boost off on two campaigns to find out whether the extra post per run was
 * earning its place, and nothing in the system would have told him either way: the daily
 * digest counted posts sent, never clicks per campaign.
 *
 * This is that instrument. Seven days against the seven before them — short enough that a
 * change made this week is legible by next week, and symmetric, so a rise is reported as
 * plainly as a fall.
 *
 * Clicks are normalised PER DAY, not per post, and posts per day are printed beside them.
 * Per-post rates are what the regression check uses, and they cannot answer this question:
 * publishing less lifts clicks-per-post by arithmetic alone, so a boost that was pure dilution
 * and a boost that was actively costing clicks look identical in that unit. Clicks per day is
 * the number the business actually earns, and posts per day next to it shows what was spent
 * to earn it.
 */

/** Days in each of the two windows. */
export const TREND_WINDOW_DAYS = 7;

/**
 * Clicks a campaign needs in one of the two windows before it earns a line.
 *
 * Low on purpose — this is a report, not an alert, and the cost of an extra line is an extra
 * line. It exists only to keep a campaign that drew one click from claiming "down 100%".
 */
export const MIN_CLICKS_TO_REPORT = 5;

/** Raw counts for one campaign across both windows. */
export interface CampaignWindowCounts {
  campaignId: string;
  campaignName: string;
  /** The last TREND_WINDOW_DAYS days. */
  recentPosts: number;
  recentClicks: number;
  /** The TREND_WINDOW_DAYS days before those. */
  priorPosts: number;
  priorClicks: number;
}

export interface CampaignTrend extends CampaignWindowCounts {
  recentClicksPerDay: number;
  priorClicksPerDay: number;
  recentPostsPerDay: number;
  priorPostsPerDay: number;
  /** Change in clicks per day, in percent. Positive is a rise. Null when the prior window
   *  earned nothing — "up from zero" has no percentage, and inventing one reads as ∞%. */
  changePercent: number | null;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Counts → rates, for every campaign, with no filtering or ordering applied yet. */
export function toTrend(counts: CampaignWindowCounts): CampaignTrend {
  const recentClicksPerDay = counts.recentClicks / TREND_WINDOW_DAYS;
  const priorClicksPerDay = counts.priorClicks / TREND_WINDOW_DAYS;
  return {
    ...counts,
    recentClicksPerDay: round1(recentClicksPerDay),
    priorClicksPerDay: round1(priorClicksPerDay),
    recentPostsPerDay: round1(counts.recentPosts / TREND_WINDOW_DAYS),
    priorPostsPerDay: round1(counts.priorPosts / TREND_WINDOW_DAYS),
    changePercent: counts.priorClicks > 0
      ? Math.round(((recentClicksPerDay - priorClicksPerDay) / priorClicksPerDay) * 100)
      : null,
  };
}

/**
 * The campaigns worth printing, biggest MOVER first.
 *
 * Ordered by the size of the change rather than by the size of the campaign, because the
 * digest's job here is to show what CHANGED. Sorting by volume would bury a small campaign
 * that halved under a large one that did exactly what it did last week.
 *
 * A campaign with no prior clicks sorts by its own recent rate — there is no change to
 * measure, but "new campaign drawing 40 a day" is still the most interesting line on the page.
 */
export function campaignTrends(rows: CampaignWindowCounts[]): CampaignTrend[] {
  return (rows || [])
    .filter((r) => r.recentClicks >= MIN_CLICKS_TO_REPORT || r.priorClicks >= MIN_CLICKS_TO_REPORT)
    .map(toTrend)
    .sort((a, b) => Math.abs(b.changePercent ?? b.recentClicksPerDay)
      - Math.abs(a.changePercent ?? a.recentClicksPerDay));
}

/**
 * One owner-facing line. Plain text: the digest is sent without parse_mode, so any markup
 * would arrive as literal asterisks.
 *
 * Posts per day is printed only when it MOVED. When output held steady the sentence is about
 * the audience, and repeating an unchanged number invites the reader to hunt for a cause in
 * the one place there isn't one.
 */
export function trendLine(t: CampaignTrend): string {
  const clicks = t.changePercent === null
    ? `${t.recentClicksPerDay} קליקים ביום`
    : `${t.recentClicksPerDay} קליקים ביום מול ${t.priorClicksPerDay}`
      + ` (${t.changePercent >= 0 ? 'עלייה' : 'ירידה'} ${Math.abs(t.changePercent)}%)`;
  const posts = t.recentPostsPerDay === t.priorPostsPerDay
    ? `${t.recentPostsPerDay} פוסטים ביום`
    : `${t.recentPostsPerDay} פוסטים ביום מול ${t.priorPostsPerDay}`;
  return `• "${t.campaignName}" · ${clicks} · ${posts}`;
}
