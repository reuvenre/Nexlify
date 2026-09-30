import {
  collapsedKeywords, hoursChanged, postsPerRunDelta,
  MIN_POSTS_TO_JUDGE,
} from './manager-rules';

describe('postsPerRunDelta', () => {
  const perf = (posts: number, clicks: number) => ({ posts7d: posts, clicks7d: clicks });

  it('no verdict on thin data', () => {
    expect(postsPerRunDelta(2, 2, perf(MIN_POSTS_TO_JUDGE - 1, 100))).toBeNull();
  });

  it('raises by one when the audience clearly wants more', () => {
    const d = postsPerRunDelta(2, 2, perf(20, 70))!; // avg 3.5
    expect(d.next).toBe(3);
    expect(d.reason).toContain('3.5');
  });

  it('lowers by one when posts earn nothing', () => {
    expect(postsPerRunDelta(2, 2, perf(20, 5))!.next).toBe(1); // avg 0.25
  });

  it('never drifts more than ±1 from the OWNER baseline, whatever the numbers say', () => {
    // Owner set 2; manager already raised to 3 yesterday → today's raise is refused.
    expect(postsPerRunDelta(3, 2, perf(20, 100))).toBeNull();
    // Owner set 3; manager already lowered to 2 → refuse to go to 1.
    expect(postsPerRunDelta(2, 3, perf(20, 2))).toBeNull();
  });

  it('respects the hard bounds [1..5]', () => {
    expect(postsPerRunDelta(5, 5, perf(20, 100))).toBeNull();
    expect(postsPerRunDelta(1, 1, perf(20, 0))).toBeNull();
  });

  it('middling performance changes nothing', () => {
    expect(postsPerRunDelta(2, 2, perf(20, 30))).toBeNull(); // avg 1.5
  });
});

describe('collapsedKeywords', () => {
  it('flags a keyword that earned before and died, while the campaign still earns', () => {
    const out = collapsedKeywords(
      [
        { keyword: 'tactical bag', clicksBefore: 12, clicksRecent: 0 },
        { keyword: 'flashlight', clicksBefore: 9, clicksRecent: 4 },
        { keyword: 'obscure thing', clicksBefore: 2, clicksRecent: 0 }, // never earned → not a collapse
      ],
      15,
    );
    expect(out.map((k) => k.keyword)).toEqual(['tactical bag']);
  });

  it('does nothing when the WHOLE campaign is quiet — that is not a keyword problem', () => {
    expect(collapsedKeywords([{ keyword: 'x', clicksBefore: 20, clicksRecent: 0 }], 0)).toEqual([]);
  });
});

describe('hoursChanged', () => {
  it('order-insensitive comparison', () => {
    expect(hoursChanged([12, 20], [20, 12])).toBe(false);
    expect(hoursChanged([12, 20], [12, 21])).toBe(true);
    expect(hoursChanged(null, [12])).toBe(true);
    expect(hoursChanged(null, null)).toBe(false);
  });
});

describe('collapsedKeywords — no airtime is not a collapse', () => {
  it('does not pause a keyword that earned before but was not published in the last 48h', () => {
    expect(collapsedKeywords([{ keyword: 'מגשי הגשה ופלטות', clicksBefore: 15, clicksRecent: 0, postsRecent: 0 }], 10)).toEqual([]);
    expect(collapsedKeywords([{ keyword: 'x', clicksBefore: 15, clicksRecent: 0, postsRecent: 1 }], 10)).toEqual([]);
  });

  it('still pauses one that was published and drew nothing', () => {
    expect(collapsedKeywords([{ keyword: 'x', clicksBefore: 15, clicksRecent: 0, postsRecent: 3 }], 10).map((k) => k.keyword))
      .toEqual(['x']);
  });
});
