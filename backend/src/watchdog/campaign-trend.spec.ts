import {
  CampaignWindowCounts, MIN_CLICKS_TO_REPORT, TREND_WINDOW_DAYS, campaignTrends, toTrend, trendLine,
} from './campaign-trend';

const counts = (over: Partial<CampaignWindowCounts> = {}): CampaignWindowCounts => ({
  campaignId: 'c1',
  campaignName: 'מוצרים כללי ALI4YOU',
  recentPosts: 247,
  recentClicks: 491,
  priorPosts: 183,
  priorClicks: 643,
  ...over,
});

describe('week-on-week campaign trend', () => {
  it('compares seven days against the seven before them', () => {
    expect(TREND_WINDOW_DAYS).toBe(7);
  });

  describe('turning counts into rates', () => {
    it('divides both windows by the same number of days', () => {
      const t = toTrend(counts({ recentClicks: 490, priorClicks: 700 }));
      expect(t.recentClicksPerDay).toBe(70);
      expect(t.priorClicksPerDay).toBe(100);
    });

    it('reports the change in clicks per day', () => {
      const t = toTrend(counts({ recentClicks: 490, priorClicks: 700 }));
      expect(t.changePercent).toBe(-30);
    });

    it('reports a rise as plainly as a fall', () => {
      const t = toTrend(counts({ recentClicks: 700, priorClicks: 490 }));
      expect(t.changePercent).toBe(43);
    });

    it('rounds rates to one decimal rather than printing sixteen', () => {
      const t = toTrend(counts({ recentClicks: 100, priorClicks: 100, recentPosts: 100, priorPosts: 100 }));
      expect(t.recentClicksPerDay).toBe(14.3);
      expect(t.recentPostsPerDay).toBe(14.3);
    });

    it('leaves the change unmeasured when the prior window earned nothing', () => {
      // "Up from zero" has no percentage; inventing one prints ∞% or a divide-by-zero.
      expect(toTrend(counts({ priorClicks: 0 })).changePercent).toBeNull();
    });

    it('reports a fall to zero as -100%, which is a real number', () => {
      expect(toTrend(counts({ recentClicks: 0, priorClicks: 700 })).changePercent).toBe(-100);
    });

    it('carries posts per day for both windows, so the cost is visible beside the earning', () => {
      const t = toTrend(counts({ recentPosts: 245, priorPosts: 182 }));
      expect(t.recentPostsPerDay).toBe(35);
      expect(t.priorPostsPerDay).toBe(26);
    });
  });

  describe('choosing which campaigns to print', () => {
    it('keeps a campaign with enough clicks in the recent window', () => {
      const out = campaignTrends([counts({ recentClicks: MIN_CLICKS_TO_REPORT, priorClicks: 0 })]);
      expect(out).toHaveLength(1);
    });

    it('keeps a campaign that only had clicks in the PRIOR window — going quiet is the news', () => {
      const out = campaignTrends([counts({ recentClicks: 0, priorClicks: 200 })]);
      expect(out).toHaveLength(1);
      expect(out[0].changePercent).toBe(-100);
    });

    it('drops a campaign too small for a percentage to mean anything', () => {
      expect(campaignTrends([counts({ recentClicks: 0, priorClicks: 1 })])).toHaveLength(0);
    });

    it('survives an empty or missing result set', () => {
      expect(campaignTrends([])).toEqual([]);
      expect(campaignTrends(null as any)).toEqual([]);
    });
  });

  describe('ordering', () => {
    it('puts the biggest mover first, not the biggest campaign', () => {
      const big = counts({ campaignId: 'big', campaignName: 'גדול', recentClicks: 2000, priorClicks: 2000 });
      const small = counts({ campaignId: 'small', campaignName: 'קטן', recentClicks: 20, priorClicks: 200 });
      expect(campaignTrends([big, small]).map((t) => t.campaignId)).toEqual(['small', 'big']);
    });

    it('ranks a fall and a rise of the same size together, by magnitude', () => {
      const fell = counts({ campaignId: 'fell', recentClicks: 50, priorClicks: 100 });
      const rose = counts({ campaignId: 'rose', recentClicks: 120, priorClicks: 100 });
      expect(campaignTrends([fell, rose]).map((t) => t.campaignId)).toEqual(['fell', 'rose']);
    });

    it('ranks a campaign with no prior clicks by its own rate', () => {
      const fresh = counts({ campaignId: 'fresh', recentClicks: 700, priorClicks: 0 });
      const steady = counts({ campaignId: 'steady', recentClicks: 105, priorClicks: 100 });
      expect(campaignTrends([fresh, steady])[0].campaignId).toBe('fresh');
    });
  });

  describe('the owner-facing line', () => {
    it('names the campaign, both click rates and the direction', () => {
      const line = trendLine(toTrend(counts({
        recentClicks: 490, priorClicks: 700, recentPosts: 245, priorPosts: 182,
      })));
      expect(line).toContain('"מוצרים כללי ALI4YOU"');
      expect(line).toContain('70 קליקים ביום מול 100');
      expect(line).toContain('ירידה 30%');
    });

    it('says עלייה when the number went up', () => {
      const line = trendLine(toTrend(counts({ recentClicks: 700, priorClicks: 490 })));
      expect(line).toContain('עלייה 43%');
    });

    it('prints both post rates when output moved — the change being tested', () => {
      const line = trendLine(toTrend(counts({ recentPosts: 182, priorPosts: 245 })));
      expect(line).toContain('26 פוסטים ביום מול 35');
    });

    it('prints one post rate when output held steady, so nothing invites a false cause', () => {
      const line = trendLine(toTrend(counts({ recentPosts: 245, priorPosts: 245 })));
      expect(line).toContain('35 פוסטים ביום');
      expect(line).not.toContain('מול 35 ');
    });

    it('omits a percentage that does not exist', () => {
      const line = trendLine(toTrend(counts({ recentClicks: 490, priorClicks: 0 })));
      expect(line).toContain('70 קליקים ביום');
      expect(line).not.toContain('%');
    });

    it('carries no markup — the digest is sent without parse_mode', () => {
      const line = trendLine(toTrend(counts()));
      expect(line).not.toMatch(/[*_`]|\[.*\]\(/);
    });
  });

  it('reads the seasonal-boost experiment the owner actually ran', () => {
    // Boost ON in the prior week, OFF in the recent one: fewer posts, and the question is
    // whether the clicks came back. This is the line that answers it.
    const line = trendLine(toTrend(counts({
      recentPosts: 182, recentClicks: 630, priorPosts: 245, priorClicks: 490,
    })));
    expect(line).toContain('90 קליקים ביום מול 70');
    expect(line).toContain('עלייה 29%');
    expect(line).toContain('26 פוסטים ביום מול 35');
  });
});
