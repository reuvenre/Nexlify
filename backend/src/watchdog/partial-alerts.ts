/**
 * Which "published partially" records are worth waking someone over.
 *
 * A partial publish is a discrete EVENT on one post: a channel failed at a moment in time.
 * The scan that finds them, though, is a rolling 6-hour window over `error_message`, so the
 * same failed post keeps answering the query for six hours after it happened — long after
 * it was reported, read and fixed.
 *
 * The platform-set throttle key does not hold that line. It is built from the platforms
 * present in the CURRENT window, so as companions age out the key changes underneath the
 * same post and every subset dodges the throttle afresh. Watchdog #68 → #69 → #70 were
 * three issues for two failures: `partial_publish:Instagram`, then
 * `partial_publish:Instagram,Telegram`, then `partial_publish:Telegram` — the last two
 * naming a post already fixed and closed.
 *
 * So the memory is kept per POST, not per key: a post is reported once, and never again.
 *
 * "Never again" has to outlive the PROCESS to mean anything. Held only in a field, the memory
 * died with every deploy, and the next tick re-reported every post still inside the 6h window
 * as though it were new — watchdog #74 re-raised two posts whose issues had been fixed and
 * closed that same hour, during an incident, which reads as "the fix didn't work". On a day
 * with deploys, in-process memory is no memory at all. Hence the cache round-trip below.
 */

/** How long a reported post id is remembered. Comfortably longer than the 6h scan window,
 *  so an id is forgotten only once it can no longer be found by the query at all. */
export const PARTIAL_MEMORY_MS = 24 * 60 * 60 * 1000;

/** Where the memory lives between processes. One key holding the whole map: it is bounded by
 *  one day of partial failures, so a single read beats a round trip per post id. */
export const PARTIALS_CACHE_KEY = 'watchdog:partials_reported';

/** The memory, for storing. A plain object so it survives JSON in any cache backend. */
export function serializePartials(reported: ReadonlyMap<string, number>): Record<string, number> {
  return Object.fromEntries(reported);
}

/**
 * Fold what OTHER processes reported into this one's memory.
 *
 * Merge, never replace. Assigning the restored map over the live one looked equivalent and is
 * not: the cache can answer empty at any moment — it times out at 1.2s by design, and where
 * no REDIS_URL is configured it is a per-process store that starts empty after every deploy.
 * An assignment there wipes the memory at the top of EVERY tick, which is strictly worse than
 * the plain field this was meant to improve on: that at least held for the life of a process.
 * Watchdog #78 re-raised three posts, all already reported and closed, for exactly this.
 *
 * The EARLIEST timestamp wins, so an id is forgotten a day after it was first reported rather
 * than having its clock reset by every merge that sees it.
 */
export function mergePartials(own: Map<string, number>, restored: ReadonlyMap<string, number>): void {
  for (const [id, at] of restored) {
    const mine = own.get(id);
    if (mine === undefined || at < mine) own.set(id, at);
  }
}

/**
 * The memory, restored — pruned to the window on the way in, so a restart cannot resurrect
 * ids the running process would already have forgotten.
 *
 * Anything unreadable (a dead cache, a shape from an older version) yields an EMPTY memory,
 * never a throw: the cost of forgetting is a duplicate alert, and the cost of throwing here
 * is a watchdog that stops watching.
 */
export function deserializePartials(raw: unknown, now: number): Map<string, number> {
  const out = new Map<string, number>();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, at] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof at === 'number' && Number.isFinite(at) && now - at <= PARTIAL_MEMORY_MS) out.set(id, at);
  }
  return out;
}

/** Drop ids that have aged past the scan window, so the memory of a long-lived process
 *  stays bounded by the traffic of one day rather than growing forever. */
export function forgetOldPartials(reported: Map<string, number>, now: number): void {
  for (const [id, at] of reported) {
    if (now - at > PARTIAL_MEMORY_MS) reported.delete(id);
  }
}

/**
 * The records nobody has been told about yet.
 *
 * Read-only on purpose: an id is remembered when the alert actually GOES OUT, not when it
 * is composed — an alert dropped by the key throttle must still be reportable later.
 */
export function unreportedPartials<T extends { id: string }>(
  partials: T[],
  reported: ReadonlyMap<string, number>,
): T[] {
  return partials.filter((p) => !reported.has(String(p.id)));
}
