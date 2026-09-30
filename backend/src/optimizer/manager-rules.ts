/**
 * The daily manager's decision rules — deterministic, bounded, testable.
 *
 * The manager reviews the account once a day like a human marketing manager and takes
 * SMALL actions from an owner-approved list. Deliberately rule-based rather than
 * AI-decided: a bounded numeric adjustment needs a reproducible reason ("avg 3.2
 * clicks/post over 7 days"), not a vibe — every action is reported with that reason,
 * logged, and reversible.
 *
 * The owner approved exactly three action kinds (07/08):
 *   1. Golden-hours refresh for smart-timing groups (report + cache invalidation).
 *   2. posts_per_run ±1 — never drifting more than ±1 from the owner's OWN value.
 *   3. A 24h pause for a keyword that collapsed.
 */

// ── posts_per_run ±1 ──────────────────────────────────────────────────────────

export interface CampaignPerf {
  /** Posts sent in the last 7 days and the clicks they earned. */
  posts7d: number;
  clicks7d: number;
}

/** A campaign must have sent at least this many posts before its average means anything. */
export const MIN_POSTS_TO_JUDGE = 10;
/** Averages that trigger a change: earning well → one more post; earning nothing → one less. */
export const RAISE_AT_CLICKS_PER_POST = 3;
export const LOWER_AT_CLICKS_PER_POST = 0.5;
/** Hard bounds — the manager never leaves this range regardless of drift math. */
export const MIN_POSTS_PER_RUN = 1;
export const MAX_POSTS_PER_RUN = 5;

/**
 * The manager's posts_per_run decision: +1, -1 or 0 (no change).
 *
 * `ownerBaseline` is the value the OWNER last set (reconstructed from the action log by
 * the caller): the result never drifts more than ±1 from it, so a week of daily +1s can
 * never carry a campaign far from what its owner chose.
 */
export function postsPerRunDelta(
  current: number, ownerBaseline: number, perf: CampaignPerf,
): { next: number; reason: string } | null {
  if (perf.posts7d < MIN_POSTS_TO_JUDGE) return null;
  const avg = perf.clicks7d / perf.posts7d;

  if (avg >= RAISE_AT_CLICKS_PER_POST) {
    const next = current + 1;
    if (next > MAX_POSTS_PER_RUN || next > ownerBaseline + 1) return null;
    return { next, reason: `ממוצע ${avg.toFixed(1)} קליקים לפוסט ב-7 ימים — הקהל רוצה עוד` };
  }
  if (avg <= LOWER_AT_CLICKS_PER_POST) {
    const next = current - 1;
    if (next < MIN_POSTS_PER_RUN || next < ownerBaseline - 1) return null;
    return { next, reason: `ממוצע ${avg.toFixed(1)} קליקים לפוסט ב-7 ימים — פחות פוסטים, יותר פגיעות` };
  }
  return null;
}

// ── 24h keyword pause ─────────────────────────────────────────────────────────

export interface KeywordPulse {
  keyword: string;
  /** Clicks in the 7 days BEFORE the last 48h — the "it used to work" evidence. */
  clicksBefore: number;
  /** Clicks in the last 48h. */
  clicksRecent: number;
  /** Posts SENT from this keyword in the last 48h. Undefined = not measured. */
  postsRecent?: number;
}

/** A keyword must have earned this much before its silence is a collapse, not noise. */
export const MIN_PRIOR_CLICKS_FOR_COLLAPSE = 8;

/**
 * Posts a keyword must have had in the last 48h before its zero clicks mean anything.
 *
 * Zero clicks from zero posts is not a collapse — it is a keyword that was not published. And
 * the pause is exactly what stops it being published, so without this the rule fed itself: a
 * keyword starved of airtime for two days (a pacing skip, a rotation that had not come round,
 * a pause from yesterday) read as collapsed, was paused for 24h, came out of the pause still
 * with no recent posts, and was paused again. The seasonal keywords fit that description
 * precisely — they earned around the holidays, then went quiet between runs — and a campaign
 * with its season switched on stopped publishing the season altogether.
 */
export const MIN_RECENT_POSTS_FOR_COLLAPSE = 2;

/**
 * Keywords that COLLAPSED: real clicks before, zero in the last 48h — while the campaign
 * as a whole still earns (campaignRecentClicks > 0, so it's the keyword, not the channel).
 * Each gets a 24h pause: fully reversible, and often exactly the breather a burnt-out
 * search term needs.
 */
export function collapsedKeywords(pulses: KeywordPulse[], campaignRecentClicks: number): KeywordPulse[] {
  if (campaignRecentClicks <= 0) return []; // the whole campaign is quiet → not a keyword problem
  return (pulses || []).filter(
    (p) => p.clicksBefore >= MIN_PRIOR_CLICKS_FOR_COLLAPSE && p.clicksRecent === 0
      && (p.postsRecent === undefined || p.postsRecent >= MIN_RECENT_POSTS_FOR_COLLAPSE),
  );
}

// ── Golden-hours refresh ──────────────────────────────────────────────────────

/** Did the learned golden hours actually change? (Order-insensitive.) */
export function hoursChanged(prev: number[] | null, next: number[] | null): boolean {
  const a = [...(prev || [])].sort((x, y) => x - y).join(',');
  const b = [...(next || [])].sort((x, y) => x - y).join(',');
  return a !== b;
}
