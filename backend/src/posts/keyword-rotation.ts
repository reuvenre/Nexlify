/**
 * Performance-weighted keyword rotation.
 *
 * The autopilot walked its keyword list with a blind cursor, so a keyword that had never
 * produced a single click got exactly the same airtime as one that sells — forever. On the
 * "טקטי בקליק" campaign that meant 38 keywords sharing the slots equally while 74% of posts
 * drew zero clicks.
 *
 * This biases the rotation instead of replacing it: proven keywords get extra slots, and
 * EVERY keyword keeps at least one. That matters for two reasons — a keyword with no history
 * is unproven rather than bad (it still needs a chance to be measured), and retiring a
 * keyword outright is the optimizer's job, where it is capped, visible and reversible. The
 * rotation only decides emphasis.
 */

/** What a keyword produced inside the scoring window. */
export interface KeywordPerformance {
  posts: number;
  clicks: number;
  revenue: number;
}

/** Slots a keyword may hold in one cycle. 1 = floor (nothing is ever silenced). */
const WEIGHT_DEAD = 1;
const WEIGHT_UNPROVEN = 1;
const WEIGHT_CLICKED = 2;
const WEIGHT_EARNING = 3;
/**
 * A keyword belonging to a bonus pool that HAS SOLD inside its window.
 *
 * Highest tier in the list, and it is the only place a keyword outranks a proven earner —
 * because it is one: the pool sold, and every sale in it pays the ordinary commission PLUS
 * the pool's bonus percentage. A pool proving itself is the strongest buy signal the
 * account produces, and it expires by itself when the pool's window closes.
 *
 * The tier is given to ALL of that pool's keywords, including ones that have not sold
 * individually — the pool is the thing that proved itself, and its categories are what the
 * bonus is paid on.
 */
const WEIGHT_BONUS_PROVEN = 4;

/** Posts a keyword needs before "no clicks" means anything. Matches the optimizer's bar. */
const MIN_POSTS_TO_JUDGE = 5;

/** How many slots this keyword earns in one cycle. */
export function keywordWeight(perf?: KeywordPerformance): number {
  if (!perf) return WEIGHT_UNPROVEN;
  if (perf.revenue > 0) return WEIGHT_EARNING;
  if (perf.clicks > 0) return WEIGHT_CLICKED;
  // A fair chance and nothing to show for it → floor, not silence.
  if (perf.posts >= MIN_POSTS_TO_JUDGE) return WEIGHT_DEAD;
  return WEIGHT_UNPROVEN;
}

/**
 * The rotation list the cursor walks: each keyword repeated by its weight, with the copies
 * SPREAD evenly across the cycle rather than sorted by score.
 *
 * Spreading matters in the channel: publishing a keyword's posts back-to-back reads as
 * repetition to subscribers and makes those posts compete with each other in search. So a
 * keyword holding 3 of 7 slots gets them at roughly even spacing instead of consecutively.
 * Each copy is placed at its fractional position through the cycle — copy j of weight w sits
 * at (j + ½)/w — and the list is the copies in position order, ties broken by the keyword's
 * original position so the result is deterministic.
 */
export function weightedRotation(
  keywords: string[], scores: Map<string, KeywordPerformance>, boosted?: Set<string>,
  provenBonus?: Set<string>,
): string[] {
  const unique = Array.from(new Set(keywords.map((k) => k?.trim()).filter(Boolean)));
  if (!unique.length) return [];

  // BOOSTED keywords are worth more than usual RIGHT NOW and only for a bounded time: a
  // live AliExpress bonus pool (worth more per sale than anything else this campaign could
  // publish) and a seasonal term inside its window (the shortest, highest-intent weeks of
  // the year). Both are unproven by history, so they get a proven keyword's emphasis
  // instead of an unproven one's floor — otherwise they sit one slot deep in a long cycle
  // and the owner sees no change for days, which is most of the window's life.
  // Bounded on purpose: a boost, never a takeover — a keyword that actually EARNS still
  // outranks it, and every other keyword keeps its slot.
  const boost = new Set(Array.from(boosted || []).map((k) => k.trim().toLowerCase()));
  // Pools that have actually SOLD inside their window get more than the entry boost: they
  // are proven AND they pay a premium on every further sale. Still bounded — 4 slots in a
  // cycle is emphasis, and every other keyword keeps its own.
  const proven = new Set(Array.from(provenBonus || []).map((k) => k.trim().toLowerCase()));

  const weights = unique.map((keyword) => {
    const lower = keyword.toLowerCase();
    return Math.max(
      keywordWeight(scores.get(keyword)),
      boost.has(lower) ? WEIGHT_CLICKED : 0,
      proven.has(lower) ? WEIGHT_BONUS_PROVEN : 0,
    );
  });
  const total = weights.reduce((n, w) => n + w, 0);

  // Fill the cycle slot by slot, each time giving it to whoever is furthest BEHIND the share
  // its weight entitles it to. Placing each copy at its own fraction of the cycle was the
  // obvious approach and it failed on real data: every single-slot keyword resolves to the
  // exact midpoint, so a heavy keyword's copies were pushed to the two ENDS of the cycle —
  // and since the cursor walks these cycles back to back, four copies at the end of one and
  // the start of the next publish consecutively, which is precisely what spreading exists to
  // prevent. Deficit-filling interleaves against the crowd of ones as well as against other
  // winners, and ties break by campaign position, so the result stays deterministic.
  const taken = new Array(unique.length).fill(0);
  const out: string[] = [];
  for (let slot = 0; slot < total; slot++) {
    let best = 0;
    let bestDeficit = -Infinity;
    for (let i = 0; i < unique.length; i++) {
      const deficit = ((slot + 1) * weights[i]) / total - taken[i];
      if (deficit > bestDeficit + 1e-9) { bestDeficit = deficit; best = i; }
    }
    taken[best] += 1;
    out.push(unique[best]);
  }
  return out;
}

/**
 * One seasonal slot in every this-many rotation positions while a window is open.
 *
 * Seasonal keywords used to ride weightedRotation as ordinary "boosted" keywords, weight 2 —
 * the same emphasis as a keyword that once drew a click. That is a fixed number of copies per
 * cycle, so their SHARE shrank as the campaign's keyword list grew: on a long list the three
 * holiday terms occupied 6 positions of ~200, and, carrying identical weights next to each
 * other, they landed together in two bursts per cycle. The cursor steps one position per run
 * on a campaign whose runs publish one post, so a burst came round every hundred-odd runs —
 * the seasonal ledger then read "52 runs, not one seasonal slot" on a campaign with the season
 * switched on (#99), and the US Pinterest board missed Halloween the same way.
 *
 * A fixed share does not depend on the list: one in five positions is the season, spread
 * evenly, whatever else the campaign sells. A boost, never a takeover — four in five stay the
 * campaign's own.
 */
export const SEASONAL_EVERY = 5;

/**
 * The rotation with the seasonal keywords woven in at a fixed share: after every
 * `every - 1` positions of the campaign's own rotation, the next seasonal keyword in turn.
 * A rotation shorter than that still gets one seasonal position, so a small campaign is not
 * left out of its season.
 */
export function interleaveSeasonal(rotation: string[], seasonal: string[], every = SEASONAL_EVERY): string[] {
  const season = Array.from(new Set((seasonal || []).map((k) => k?.trim()).filter(Boolean))) as string[];
  if (!season.length) return [...(rotation || [])];
  if (!rotation?.length) return season;
  const gap = Math.max(1, Math.floor(every) - 1);
  const out: string[] = [];
  let next = 0;
  rotation.forEach((kw, i) => {
    out.push(kw);
    if ((i + 1) % gap === 0) out.push(season[next++ % season.length]);
  });
  if (!next) out.push(season[0]);
  return out;
}
