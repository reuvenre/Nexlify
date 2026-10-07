import { choosePool } from './pool-tiers';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 7);

type P = { id: string; rating: number; postedDaysAgo?: number };
const run = (found: P[]) => choosePool(found, {
  qualified: (p) => p.rating >= 4.5,
  fresh: (p) => p.postedDaysAgo === undefined,
  lastPostedMs: (p) => (p.postedDaysAgo === undefined ? 0 : NOW - p.postedDaysAgo * DAY),
  now: NOW,
  minGapMs: 7 * DAY,
});
const ids = (r: { pool: P[] }) => r.pool.map((p) => p.id);

describe('choosePool', () => {
  it('takes fresh on-spec products first', () => {
    const r = run([{ id: 'a', rating: 4.8, postedDaysAgo: 2 }, { id: 'b', rating: 4.9 }, { id: 'c', rating: 4.0 }]);
    expect(r.tier).toBe(1);
    expect(ids(r)).toEqual(['b']);
  });

  it('recycles on-spec products only once they are a week old, oldest first', () => {
    const r = run([
      { id: 'yesterday', rating: 4.8, postedDaysAgo: 1 },
      { id: 'ten-days', rating: 4.8, postedDaysAgo: 10 },
      { id: 'eight-days', rating: 4.8, postedDaysAgo: 8 },
    ]);
    expect(r.tier).toBe(2);
    expect(ids(r)).toEqual(['ten-days', 'eight-days']);
  });

  it('prefers a new lower-rated product to repeating one from three days ago', () => {
    // The repeat the owner kept seeing: every on-spec result went out this week.
    const r = run([{ id: 'three-days', rating: 4.8, postedDaysAgo: 3 }, { id: 'new', rating: 4.1 }]);
    expect(r.tier).toBe(3);
    expect(ids(r)).toEqual(['new']);
  });

  it('is dry, not a repeat, when everything went out this week', () => {
    const r = run([{ id: 'a', rating: 4.8, postedDaysAgo: 3 }, { id: 'b', rating: 4.0, postedDaysAgo: 1 }]);
    expect(r).toEqual({ pool: [], tier: 0 });
  });

  it('falls back to an old lower-rated product as the last resort', () => {
    const r = run([{ id: 'a', rating: 4.8, postedDaysAgo: 3 }, { id: 'b', rating: 4.0, postedDaysAgo: 9 }]);
    expect(r.tier).toBe(4);
    expect(ids(r)).toEqual(['b']);
  });

  it('an empty search is dry', () => {
    expect(run([]).tier).toBe(0);
  });
});
