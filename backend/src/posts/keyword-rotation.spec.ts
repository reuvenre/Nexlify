import { KeywordPerformance, SEASONAL_EVERY, interleaveSeasonal, keywordWeight, weightedRotation } from './keyword-rotation';

const perf = (posts: number, clicks: number, revenue = 0): KeywordPerformance =>
  ({ posts, clicks, revenue });

describe('keywordWeight', () => {
  it('gives an earning keyword the most slots', () => {
    expect(keywordWeight(perf(8, 20, 45.5))).toBe(3);
  });

  it('gives a clicked keyword more than a dead one', () => {
    expect(keywordWeight(perf(8, 6))).toBe(2);
    expect(keywordWeight(perf(8, 0))).toBe(1);
  });

  it('treats a keyword with no history as unproven, not dead', () => {
    // "holographic sight" had never produced a post; it needs a chance to BE measured.
    expect(keywordWeight(undefined)).toBe(1);
    expect(keywordWeight(perf(0, 0))).toBe(1);
  });

  it('does not judge a keyword before it had a fair chance', () => {
    // 2 posts and no clicks is not evidence — same weight as never tried.
    expect(keywordWeight(perf(2, 0))).toBe(keywordWeight(undefined));
  });
});

describe('weightedRotation', () => {
  const KW = ['dead', 'clicked', 'earning', 'fresh'];
  const scores = new Map<string, KeywordPerformance>([
    ['dead', perf(9, 0)],
    ['clicked', perf(9, 5)],
    ['earning', perf(9, 12, 30)],
    // 'fresh' deliberately absent → unproven
  ]);

  it('never silences a keyword — every one still appears', () => {
    const rotation = weightedRotation(KW, scores);
    for (const kw of KW) expect(rotation).toContain(kw);
  });

  it('gives the winners a bigger share of the cycle', () => {
    const rotation = weightedRotation(KW, scores);
    const count = (kw: string) => rotation.filter((k) => k === kw).length;
    expect(count('earning')).toBe(3);
    expect(count('clicked')).toBe(2);
    expect(count('dead')).toBe(1);
    expect(count('fresh')).toBe(1);
  });

  it('spreads a winner\'s slots instead of grouping them back-to-back', () => {
    // Consecutive posts from one keyword read as repetition in the channel and compete
    // with each other in search, so the extra slots must be spread across the cycle.
    const rotation = weightedRotation(KW, scores);
    for (let i = 1; i < rotation.length; i++) {
      expect(rotation[i]).not.toBe(rotation[i - 1]);
    }
  });

  it('places copies at even spacing, deterministically', () => {
    expect(weightedRotation(KW, scores)).toEqual([
      'earning',            // 1/6 through the cycle
      'clicked',            // 1/4
      'dead', 'earning', 'fresh', // all at the midpoint, ordered by their campaign position
      'clicked',            // 3/4
      'earning',            // 5/6
    ]);
  });

  it('still spreads with many keywords, as a real campaign has', () => {
    // The production campaign carries 38 keywords; a couple of winners among them must not
    // end up adjacent just because the list is long.
    const many = Array.from({ length: 20 }, (_, i) => `kw${i}`);
    const s = new Map<string, KeywordPerformance>([
      ['kw3', perf(9, 10, 20)],
      ['kw11', perf(9, 4)],
    ]);
    const rotation = weightedRotation(many, s);
    expect(rotation.filter((k) => k === 'kw3')).toHaveLength(3);
    expect(rotation.filter((k) => k === 'kw11')).toHaveLength(2);
    for (let i = 1; i < rotation.length; i++) {
      expect(rotation[i]).not.toBe(rotation[i - 1]);
    }
  });

  it('is a plain round-robin when nothing has been measured yet', () => {
    expect(weightedRotation(KW, new Map())).toEqual(KW);
  });

  it('de-duplicates and drops blanks from the campaign list', () => {
    expect(weightedRotation(['a', 'a', ' ', '', 'b'], new Map())).toEqual(['a', 'b']);
  });

  it('returns empty for an empty keyword list', () => {
    expect(weightedRotation([], new Map())).toEqual([]);
  });
});

describe('weightedRotation — bonus-pool boost', () => {
  const perf = new Map<string, KeywordPerformance>();

  it('gives a live bonus keyword a proven keyword\'s emphasis, not an unproven floor', () => {
    // Without the boost a freshly added pool holds 1 slot in a long cycle and the owner
    // sees nothing change for days — most of a monthly pool's life.
    const plain = weightedRotation(['a', 'b', 'storage box'], perf);
    const boosted = weightedRotation(['a', 'b', 'storage box'], perf, new Set(['storage box']));
    expect(plain.filter((k) => k === 'storage box')).toHaveLength(1);
    expect(boosted.filter((k) => k === 'storage box')).toHaveLength(2);
    // A boost, not a takeover: every other keyword keeps its slot.
    expect(boosted.filter((k) => k === 'a')).toHaveLength(1);
    expect(boosted.filter((k) => k === 'b')).toHaveLength(1);
  });

  it('never demotes a keyword that actually earns', () => {
    const earning = new Map<string, KeywordPerformance>([
      ['storage box', { posts: 9, clicks: 30, revenue: 120 }],
    ]);
    const out = weightedRotation(['a', 'storage box'], earning, new Set(['storage box']));
    expect(out.filter((k) => k === 'storage box')).toHaveLength(3);
  });

  it('matches case-insensitively, like the rest of the keyword handling', () => {
    const out = weightedRotation(['Storage Box'], perf, new Set(['storage box']));
    expect(out).toHaveLength(2);
  });

  describe('a bonus pool that has already sold', () => {
    const pool = new Set(['storage box', 'kitchen organizer']);

    it('gets more product slots than any other keyword — it earns AND pays a bonus', () => {
      const out = weightedRotation(
        ['a', 'b', 'storage box'], perf, pool, new Set(['storage box']),
      );
      expect(out.filter((k) => k === 'storage box')).toHaveLength(4);
      // Still a rotation, not a monopoly: everything else keeps its own slot.
      expect(out.filter((k) => k === 'a')).toHaveLength(1);
      expect(out.filter((k) => k === 'b')).toHaveLength(1);
    });

    it('outranks a keyword that earns on its own', () => {
      const earning = new Map<string, KeywordPerformance>([
        ['solo earner', { posts: 9, clicks: 30, revenue: 120 }],
      ]);
      const out = weightedRotation(
        ['solo earner', 'storage box'], earning, pool, new Set(['storage box']),
      );
      expect(out.filter((k) => k === 'storage box')).toHaveLength(4);
      expect(out.filter((k) => k === 'solo earner')).toHaveLength(3);
    });

    it('lifts a pool keyword that has not sold individually — the POOL is what proved itself', () => {
      const out = weightedRotation(
        ['kitchen organizer', 'a'], perf, pool, new Set(['kitchen organizer']),
      );
      expect(out.filter((k) => k === 'kitchen organizer')).toHaveLength(4);
    });

    it('breaks the extra slots up instead of publishing them back-to-back', () => {
      // Four posts of one keyword in a row reads as repetition in the channel. With four
      // slots out of six some adjacency is arithmetic, so the property that matters is
      // that the run is broken — not that every copy is isolated.
      const out = weightedRotation(
        ['a', 'b', 'storage box'], perf, pool, new Set(['storage box']),
      );
      const longestRun = out.reduce((best, k, i) => {
        if (k !== 'storage box') return best;
        let n = 1;
        while (out[i - n] === 'storage box') n++;
        return Math.max(best, n);
      }, 0);
      expect(longestRun).toBeLessThan(4);
    });

    it('interleaves properly once the cycle is long enough to allow it', () => {
      // A real campaign has many keywords, and there the four copies do spread out.
      const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'storage box'];
      const out = weightedRotation(many, perf, pool, new Set(['storage box']));
      const positions = out.map((k, i) => (k === 'storage box' ? i : -1)).filter((i) => i >= 0);
      const gaps = positions.slice(1).map((p, i) => p - positions[i]);
      expect(Math.min(...gaps)).toBeGreaterThan(1);
    });
  });
});

describe('the season as a fixed share of the rotation', () => {
  const own = Array.from({ length: 200 }, (_, i) => `kw${i}`);
  const season = ['מגשי הגשה ופלטות', 'מפות שולחן לאירוח', 'שרשראות תאורה לסוכה'];

  it('gives the season one position in every SEASONAL_EVERY, however long the list', () => {
    const out = interleaveSeasonal(own, season);
    const seasonal = out.filter((k) => season.includes(k)).length;
    expect(seasonal / out.length).toBeCloseTo(1 / SEASONAL_EVERY, 2);
  });

  it('spreads it: never more than SEASONAL_EVERY - 1 own keywords in a row', () => {
    const out = interleaveSeasonal(own, season);
    let run = 0;
    for (const k of out) {
      run = season.includes(k) ? 0 : run + 1;
      expect(run).toBeLessThanOrEqual(SEASONAL_EVERY - 1);
    }
  });

  it('takes every seasonal keyword in turn', () => {
    const out = interleaveSeasonal(own.slice(0, 12), season);
    expect(out.filter((k) => season.includes(k))).toEqual(season);
  });

  it('reaches a seasonal slot within a handful of one-step runs from anywhere — the #99 failure', () => {
    // 3 slots a run, the cursor stepping one position per run (two slots given back).
    const rot = interleaveSeasonal(own, season);
    for (let start = 0; start < rot.length; start += 7) {
      let hit = false;
      for (let run = 0; run < SEASONAL_EVERY && !hit; run++) {
        hit = [0, 1, 2].some((i) => season.includes(rot[(start + run + i) % rot.length]));
      }
      expect(hit).toBe(true);
    }
  });

  it('still gives a tiny campaign its season', () => {
    expect(interleaveSeasonal(['a', 'b'], season)).toEqual(['a', 'b', season[0]]);
  });

  it('leaves the rotation alone with no season open', () => {
    expect(interleaveSeasonal(own.slice(0, 5), [])).toEqual(own.slice(0, 5));
  });

  it('is the season alone when the campaign has nothing else', () => {
    expect(interleaveSeasonal([], season)).toEqual(season);
  });
});
