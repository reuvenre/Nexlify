/**
 * The watchdog's per-key throttle, kept across restarts.
 *
 * Every anomaly the scanner finds is a CONDITION, not an event: stuck posts stay stuck,
 * a dead campaign stays dead, a regression answers its query for a week. The scan re-finds
 * all of them every 15 minutes, and the only thing standing between that and an issue every
 * quarter of an hour is this throttle — one report per key per six hours.
 *
 * It lived in a process field. A deploy therefore reset the throttle on EVERY key at once,
 * and the next tick re-raised every condition still true, six hours early. On a day with
 * three deploys that is three rounds of duplicate issues for faults nobody had fixed yet
 * because they were still being worked on. Watchdog #84 raised three campaigns whose
 * regressions had been reported and diagnosed twelve hours earlier for exactly this.
 *
 * So the throttle is stored (see watchdog-memory.store.ts) and folded back in at the top of
 * each tick, next to the partial and regression memories.
 */

/** One report per key per six hours — long enough that a persisting condition is not spam,
 *  short enough that a condition still true tomorrow is raised again. */
export const THROTTLE_MS = 6 * 60 * 60 * 1000;

/** Where the throttle lives between processes. */
export const THROTTLE_MEMORY_KEY = 'watchdog:throttle';

/** The memory, for storing. A plain object so it survives JSON in any backend. */
export function serializeThrottle(reported: ReadonlyMap<string, number>): Record<string, number> {
  return Object.fromEntries(reported);
}

/**
 * The memory, restored — pruned to the throttle window on the way in, so a restart cannot
 * resurrect a suppression the running process would already have released.
 *
 * Anything unreadable yields an EMPTY memory rather than a throw: the cost of forgetting is
 * a duplicate alert, the cost of throwing is a watchdog that stops watching.
 */
export function deserializeThrottle(raw: unknown, now: number): Map<string, number> {
  const out = new Map<string, number>();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, at] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof at === 'number' && Number.isFinite(at) && now - at <= THROTTLE_MS) out.set(key, at);
  }
  return out;
}

/**
 * Fold what other processes reported into this one's memory.
 *
 * Merge, never replace — a store that answers empty must leave the live memory alone, or the
 * memory resets at the top of every tick (the mistake watchdog #78 was made of).
 *
 * The LATEST timestamp wins here, the opposite of the partial memory. That one forgets a post
 * a fixed time after it was FIRST reported, so the earliest stamp is the honest one. This one
 * asks "how long until I may speak again?", and the most recent report is what that answer is
 * measured from — taking the earlier stamp would release the throttle early and let the
 * duplicate through, which is the whole failure this exists to prevent.
 */
export function mergeThrottle(own: Map<string, number>, restored: ReadonlyMap<string, number>): void {
  for (const [key, at] of restored) {
    const mine = own.get(key);
    if (mine === undefined || at > mine) own.set(key, at);
  }
}

/** Drop keys whose throttle has expired, so a long-lived process's memory stays bounded by
 *  the anomalies of one window rather than growing forever. */
export function forgetOldThrottles(reported: Map<string, number>, now: number): void {
  for (const [key, at] of reported) {
    if (now - at > THROTTLE_MS) reported.delete(key);
  }
}

/** Is this key still suppressed? The single place the window is compared, so the throttle
 *  cannot drift apart from the memory that stores it. */
export function throttled(reported: ReadonlyMap<string, number>, key: string, now: number): boolean {
  const last = reported.get(key);
  return last !== undefined && now - last < THROTTLE_MS;
}
