/**
 * Which products a keyword's slot may take this run — the tiers of runCampaign, pure.
 *
 *   T1: on-spec + fresh (novel, meets rating/discount)     — the ideal
 *   T2: on-spec, recycled oldest-first                     — quality over novelty
 *   T3: relaxed filters, fresh                             — novelty over strictness
 *   T4: relaxed filters, recycled oldest-first             — last resort
 *
 * A recycled product must have gone out at least `minGapMs` ago. Before that floor the tiers
 * took the oldest post inside the 14-day cooldown, which for a keyword with a dozen on-spec
 * results was a product from three days earlier — the group saw the same items go round.
 * When nothing qualifies the keyword is dry for this run (tier 0), and its slot borrows from
 * another keyword.
 */
export function choosePool<T>(
  found: T[],
  opts: {
    qualified: (p: T) => boolean;
    fresh: (p: T) => boolean;
    /** When this product (or the same item under another id) last went out; 0 = never. */
    lastPostedMs: (p: T) => number;
    now: number;
    minGapMs: number;
  },
): { pool: T[]; tier: 0 | 1 | 2 | 3 | 4 } {
  const qualified = found.filter(opts.qualified);
  const recycle = (arr: T[]) => arr
    .filter((p) => opts.now - opts.lastPostedMs(p) >= opts.minGapMs)
    .sort((a, b) => opts.lastPostedMs(a) - opts.lastPostedMs(b));
  const t1 = qualified.filter(opts.fresh);
  if (t1.length) return { pool: t1, tier: 1 };
  const t2 = recycle(qualified);
  if (t2.length) return { pool: t2, tier: 2 };
  const t3 = found.filter(opts.fresh);
  if (t3.length) return { pool: t3, tier: 3 };
  const t4 = recycle(found);
  if (t4.length) return { pool: t4, tier: 4 };
  return { pool: [], tier: 0 };
}
