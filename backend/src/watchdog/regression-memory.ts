/**
 * Which CTR regressions are worth waking someone over AGAIN.
 *
 * A regression is not an event, it is a CONDITION — and the query behind it is a 7-day
 * rolling window, so a campaign that fell on Tuesday keeps answering that query, with the
 * same numbers, every 15 minutes until Tuesday leaves the window. Against a 6h key throttle
 * that is up to 28 issues for one finding.
 *
 * Watchdog #80 → #81 is the proof: the same campaign, six hours apart, 592 clicks then 593.
 * One click of new information, a fresh issue, and a diagnosis that had already been written
 * and closed. This is the partial-publish lesson (see partial-alerts.ts) on a slower metric:
 * a rolling window needs a memory matched to the window, not to the tick.
 *
 * But a condition differs from an event in one way that matters: it can get WORSE, and a
 * deterioration is news even while the original is still remembered. So the memory holds the
 * DEPTH of the drop it reported, and a drop that deepens materially speaks again.
 */

import { CtrRegression } from './regression';

/**
 * How long a reported regression stays remembered.
 *
 * Matched to the recent window, because that is exactly how long the same drop keeps being
 * detectable. Forgetting sooner re-reports a finding the owner has already read; forgetting
 * later would hide a fresh fall that happens to land on the same campaign.
 */
export const REGRESSION_MEMORY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How much deeper a remembered drop must get to be worth saying again, in percentage POINTS.
 *
 * 40% → 44% is the same finding measured a day later; 40% → 60% is the floor falling further
 * and the owner should hear it. Generous on purpose: the cost of a duplicate alert is an
 * owner who stops reading alerts, which is what the regression check exists to avoid.
 */
export const RENOTIFY_DEEPER_BY = 15;

/** What was reported for one campaign, and when. */
export interface ReportedDrop {
  at: number;
  /** dropPercent as reported, so a deepening fall can be recognised. */
  drop: number;
}

/** Where the memory lives between processes — a deploy must not reset it (watchdog #78). */
export const REGRESSIONS_MEMORY_KEY = 'watchdog:regressions_reported';

/** Drop campaigns whose regression has aged out of the window, so the memory stays bounded
 *  by the campaigns of one week rather than growing forever. */
export function forgetOldRegressions(reported: Map<string, ReportedDrop>, now: number): void {
  for (const [id, seen] of reported) {
    if (now - seen.at > REGRESSION_MEMORY_MS) reported.delete(id);
  }
}

/**
 * The regressions nobody has been told about yet — or whose floor has fallen further since.
 *
 * Read-only, for the same reason unreportedPartials is: an alert can still be dropped by the
 * key throttle after being composed, and a campaign marked here that never actually reached
 * the owner would be silenced for a week having never been reported at all.
 */
export function unreportedRegressions(
  regressions: CtrRegression[],
  reported: ReadonlyMap<string, ReportedDrop>,
): CtrRegression[] {
  return (regressions || []).filter((r) => {
    const seen = reported.get(String(r.campaignId));
    if (!seen) return true;
    return r.dropPercent - seen.drop >= RENOTIFY_DEEPER_BY;
  });
}

/** Remember what actually went out. Called when the alert is SENT, never when it is built. */
export function rememberRegressions(
  regressions: CtrRegression[],
  reported: Map<string, ReportedDrop>,
  now: number,
): void {
  for (const r of regressions || []) {
    reported.set(String(r.campaignId), { at: now, drop: Number(r.dropPercent) || 0 });
  }
}

/** The memory, for storing. A plain object so it survives JSON in any cache backend. */
export function serializeRegressions(
  reported: ReadonlyMap<string, ReportedDrop>,
): Record<string, ReportedDrop> {
  return Object.fromEntries(reported);
}

/**
 * The memory, restored — pruned to the window on the way in, so a restart cannot resurrect a
 * campaign the running process would already have forgotten.
 *
 * Anything unreadable yields an EMPTY memory rather than throwing: the cost of forgetting is
 * a duplicate alert, and the cost of throwing here is a watchdog that stops watching.
 */
export function deserializeRegressions(raw: unknown, now: number): Map<string, ReportedDrop> {
  const out = new Map<string, ReportedDrop>();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, seen] of Object.entries(raw as Record<string, unknown>)) {
    const at = Number((seen as any)?.at);
    const drop = Number((seen as any)?.drop);
    if (!Number.isFinite(at) || !Number.isFinite(drop)) continue;
    if (now - at > REGRESSION_MEMORY_MS) continue;
    out.set(id, { at, drop });
  }
  return out;
}

/**
 * Fold what other processes reported into this one's memory — merge, never replace.
 *
 * The same rule mergePartials documents: the cache answers empty whenever it cannot be
 * reached in time, and assigning that over the live memory would clear it at the top of every
 * tick. The EARLIEST sighting wins, so a merge cannot reset the forget clock; between two
 * sightings of the same age the DEEPER drop is kept, so a merge can never silence a
 * deterioration this process has not yet reported.
 */
export function mergeRegressions(
  own: Map<string, ReportedDrop>,
  restored: ReadonlyMap<string, ReportedDrop>,
): void {
  for (const [id, seen] of restored) {
    const mine = own.get(id);
    if (!mine) { own.set(id, seen); continue; }
    own.set(id, { at: Math.min(mine.at, seen.at), drop: Math.max(mine.drop, seen.drop) });
  }
}
