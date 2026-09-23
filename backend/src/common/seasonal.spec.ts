import { seasonalCopyHints, seasonalKeywords, activeSeasonalEvents, sourceSupportsSeasonal } from './seasonal';

/**
 * Reported: "the holiday template takes over every product". During Tishrei a tactical belt
 * and army fatigues were written up as holiday-table items, because the season's copy line
 * was attached to every post the moment the window opened.
 *
 * The line between the two kinds of season is what fixes it, and the calendar data already
 * draws it: an event that contributes product-search keywords is about WHAT to sell (its
 * hint only fits a product it actually found), while an event with none is about WHEN
 * everything is sold (its hint fits anything on the shelf).
 */
describe('seasonalCopyHints', () => {
  const tishrei = new Date('2026-09-09T09:00:00Z');   // 25/8–10/10, audience il
  const blackFriday = new Date('2026-11-20T09:00:00Z'); // 15/11–2/12, audience global

  it('files a holiday as an OCCASION — the line only some products may carry', () => {
    const { occasion, saleSeason } = seasonalCopyHints('he', tishrei);
    expect(occasion).toContain('חגי תשרי');
    // Tishrei says nothing about prices, so there is no all-products line to give out.
    expect(saleSeason).toBeNull();
  });

  it('files a sale week as a SALE SEASON — the line every product may carry', () => {
    // Black Friday overlaps Hanukkah, and the two lines have different audiences: every
    // product may be called a season price, only a gift product may be called a gift. The
    // caller hands each one out separately, which is the whole point of splitting them.
    const { occasion, saleSeason } = seasonalCopyHints('he', blackFriday);
    expect(saleSeason).toContain('בלאק פריידיי');
    expect(occasion).toContain('חנוכה');
  });

  it('a sale week with NO holiday beside it hands out nothing product-specific', () => {
    // 11.11: the only thing true that week is the price.
    const { occasion, saleSeason } = seasonalCopyHints('he', new Date('2026-11-05T09:00:00Z'));
    expect(saleSeason).toContain('11.11');
    expect(occasion).toBeNull();
  });

  it('the split matches the keywords, so no event is both or neither', () => {
    // The invariant behind the rule: for every active event with a hint, whether it sells
    // something decides which bucket it lands in. If that ever stops holding, an occasion
    // could leak onto every post again — which is the bug.
    for (const now of [tishrei, blackFriday, new Date('2026-07-01T09:00:00Z')]) {
      for (const lang of ['he', 'en']) {
        const events = activeSeasonalEvents(lang, now).filter((ev) => (lang === 'en' ? ev.hint_en : ev.hint_he));
        const hints = seasonalCopyHints(lang, now);
        const anyOccasion = events.some((ev) => (lang === 'en' ? ev.keywords_en : ev.keywords_he).length > 0);
        const anySale = events.some((ev) => (lang === 'en' ? ev.keywords_en : ev.keywords_he).length === 0);
        expect(!!hints.occasion).toBe(anyOccasion);
        expect(!!hints.saleSeason).toBe(anySale);
      }
    }
  });

  it('says nothing at all when no window is open', () => {
    // Mid-January: back-to-school is over, Valentine's has not opened.
    const quiet = new Date('2026-01-05T09:00:00Z');
    expect(seasonalCopyHints('he', quiet)).toEqual({ occasion: null, saleSeason: null });
  });

  it('keeps the occasion keywords in step with the occasion line', () => {
    // The hint is only allowed on posts these keywords found, so a hint with no keywords to
    // ride on would be a line nothing could ever carry.
    expect(seasonalKeywords('he', tishrei).length).toBeGreaterThan(0);
  });
});

describe('which product sources the calendar can reach', () => {
  it('reaches AliExpress — the only runner that searches keywords', () => {
    expect(sourceSupportsSeasonal('aliexpress')).toBe(true);
  });

  it.each([
    ['flylink', 'rotates a linked catalog; no search API exists'],
    ['amazon', 'walks its own cursor and never sees the calendar'],
  ])('does not reach %s — %s', (source) => {
    expect(sourceSupportsSeasonal(source)).toBe(false);
  });

  it.each([['null', null], ['undefined', undefined], ['empty', '']])(
    'treats %s as AliExpress, matching the column default', (_label, source) => {
      expect(sourceSupportsSeasonal(source as any)).toBe(true);
    },
  );

  it('does not reach a source it has never heard of', () => {
    // Safer default for a source added later: it gets no seasonal behaviour until someone
    // writes one, rather than silently claiming a calendar it cannot act on.
    expect(sourceSupportsSeasonal('temu')).toBe(false);
  });
});
