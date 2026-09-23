import {
  MIN_POSTS_TO_JUDGE, SEASONAL_GAP_DAYS, SeasonalCampaignRow, seasonalGapLine, seasonalGaps,
} from './seasonal-gap';

/** Inside the Halloween (15/09–31/10) and Christmas (20/09–18/12) windows. */
const IN_US_SEASON = new Date('2026-09-23T09:00:00Z');
/** No window open for either audience. */
const OUT_OF_SEASON = new Date('2026-05-20T09:00:00Z');

const row = (over: Partial<SeasonalCampaignRow> = {}): SeasonalCampaignRow => ({
  campaignId: 'c1',
  campaignName: 'Pinterest US',
  source: 'aliexpress',
  language: 'en',
  recentPosts: 12,
  keywords: ['tactical flashlight', 'camping gear'],
  ...over,
});

describe('a season open and nothing publishing into it', () => {
  it('looks back three days', () => {
    expect(SEASONAL_GAP_DAYS).toBe(3);
  });

  describe('the fault it exists to catch', () => {
    it('flags a publishing campaign that used none of its seasonal keywords', () => {
      const [gap] = seasonalGaps([row()], IN_US_SEASON);
      expect(gap.campaignId).toBe('c1');
      expect(gap.recentPosts).toBe(12);
    });

    it('names the open events and the keywords it should have used', () => {
      const [gap] = seasonalGaps([row()], IN_US_SEASON);
      expect(gap.events.join(' ')).toContain('האלווין');
      expect(gap.expected).toContain('halloween decorations');
    });

    it('flags each affected campaign separately', () => {
      const gaps = seasonalGaps(
        [row(), row({ campaignId: 'c2', campaignName: 'Pinterest Gifts' })], IN_US_SEASON,
      );
      expect(gaps.map((g) => g.campaignId)).toEqual(['c1', 'c2']);
    });
  });

  describe('staying quiet when there is nothing to report', () => {
    it('says nothing when the season IS reaching the channel', () => {
      expect(seasonalGaps(
        [row({ keywords: ['tactical flashlight', 'halloween decorations'] })], IN_US_SEASON,
      )).toEqual([]);
    });

    it('matches the keyword regardless of case or padding', () => {
      expect(seasonalGaps(
        [row({ keywords: ['  Halloween Decorations '] })], IN_US_SEASON,
      )).toEqual([]);
    });

    it('says nothing out of season — there is no window to miss', () => {
      expect(seasonalGaps([row()], OUT_OF_SEASON)).toEqual([]);
    });

    it('judges a Hebrew campaign against ITS OWN season, not the US one', () => {
      // Late September is Tishrei for an Israeli audience. The campaign is not let off
      // because Halloween does not apply to it — it is held to the window that does.
      const [gap] = seasonalGaps([row({ language: 'he' })], IN_US_SEASON);
      expect(gap.events.join(' ')).toContain('תשרי');
      expect(gap.expected.join(' ')).not.toContain('halloween');
    });

    it('says nothing when the only open event for this language sells nothing', () => {
      // Early November: Christmas is open for the US, but a Hebrew campaign's only active
      // event is the 11.11 sale season, which carries no search keywords by design — it
      // angles the copy and never says what to stock, so there is nothing to have missed.
      const NOV = new Date('2026-11-05T09:00:00Z');
      expect(seasonalGaps([row({ language: 'he' })], NOV)).toEqual([]);
    });

    it('waits until the campaign has published enough for zero to mean something', () => {
      expect(seasonalGaps([row({ recentPosts: MIN_POSTS_TO_JUDGE - 1 })], IN_US_SEASON)).toEqual([]);
      expect(seasonalGaps([row({ recentPosts: MIN_POSTS_TO_JUDGE })], IN_US_SEASON)).toHaveLength(1);
    });

    it.each([
      ['flylink', 'rotates a linked catalog — no keyword search exists'],
      ['amazon', 'walks its own cursor and never sees the calendar'],
    ])('says nothing for a %s campaign — %s', (source) => {
      // Caught on this check's first live run: a FLYLINK campaign, toggle on, 36 posts,
      // 0 seasonal. Structurally impossible to satisfy, so the alert could never be cleared.
      expect(seasonalGaps([row({ source, recentPosts: 36 })], IN_US_SEASON)).toEqual([]);
    });

    it('still judges a campaign whose source is unset — the default is AliExpress', () => {
      expect(seasonalGaps([row({ source: '' })], IN_US_SEASON)).toHaveLength(1);
    });

    it('survives an empty or missing result set', () => {
      expect(seasonalGaps([], IN_US_SEASON)).toEqual([]);
      expect(seasonalGaps(null as any, IN_US_SEASON)).toEqual([]);
    });

    it('survives a campaign with no recorded keywords at all', () => {
      // Older posts predate per-post keyword attribution — absent, not evidence of a hit.
      expect(seasonalGaps([row({ keywords: [] })], IN_US_SEASON)).toHaveLength(1);
      expect(seasonalGaps([row({ keywords: null as any })], IN_US_SEASON)).toHaveLength(1);
    });
  });

  describe('the owner-facing line', () => {
    it('names the campaign, the season and the evidence', () => {
      const line = seasonalGapLine(seasonalGaps([row()], IN_US_SEASON)[0]);
      expect(line).toContain('"Pinterest US"');
      expect(line).toContain('האלווין');
      expect(line).toContain('12 פוסטים ב-3 ימים, אף אחד מהם עונתי');
    });

    it('carries no markup — the DM is sent without parse_mode', () => {
      const line = seasonalGapLine(seasonalGaps([row()], IN_US_SEASON)[0]);
      expect(line).not.toMatch(/[*_`]|\[.*\]\(/);
    });
  });
});
