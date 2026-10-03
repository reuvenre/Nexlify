import { MIN_SEASONAL_POSTS_TO_JUDGE, seasonalSplitLine, seasonalSplits } from './seasonal-split';

/** Inside the Halloween window (US) and Tishrei (IL). */
const NOW = new Date('2026-10-03T09:00:00Z');
const row = (keyword: string, posts: number, clicks: number, over: Partial<{ campaignId: string; language: string }> = {}) => ({
  campaignId: over.campaignId ?? 'p', campaignName: 'Pinterest', language: over.language ?? 'en', keyword, posts, clicks,
});

describe('seasonal against ordinary, clicks per post', () => {
  it('splits a campaign by whether the keyword is in an open window for its language', () => {
    const [s] = seasonalSplits([
      row('Halloween Decorations', 4, 12), row('electric lunch box', 10, 10), row('car accessories', 6, 2),
    ], NOW);
    expect(s).toMatchObject({ seasonalPosts: 4, seasonalClicks: 12, ordinaryPosts: 16, ordinaryClicks: 12 });
  });

  it('leaves out a campaign with no seasonal post yet', () => {
    expect(seasonalSplits([row('electric lunch box', 10, 10)], NOW)).toEqual([]);
  });

  it('does not count a Hebrew holiday term as seasonal for an English campaign', () => {
    expect(seasonalSplits([row('מגשי הגשה ופלטות', 3, 3)], NOW)).toEqual([]);
  });

  it('withholds a verdict on too few seasonal posts', () => {
    const [s] = seasonalSplits([row('halloween decorations', MIN_SEASONAL_POSTS_TO_JUDGE - 1, 40), row('x', 20, 2)], NOW);
    expect(seasonalSplitLine(s)).toContain('מוקדם לשפוט');
  });

  it('names the leader once there is enough to judge', () => {
    const [lead] = seasonalSplits([row('halloween decorations', 6, 18), row('x', 24, 24)], NOW);
    expect(seasonalSplitLine(lead)).toContain('✅ עונתי מוביל');
    const [lag] = seasonalSplits([row('halloween decorations', 6, 3), row('x', 24, 24)], NOW);
    expect(seasonalSplitLine(lag)).toContain('רגיל מוביל');
    const [even] = seasonalSplits([row('halloween decorations', 6, 6), row('x', 24, 25)], NOW);
    expect(seasonalSplitLine(even)).toContain('דומה');
  });
});
